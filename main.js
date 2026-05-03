'use strict';

/* Created with @iobroker/create-adapter v2.2.1 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const schedule = require('node-schedule');
const SunCalc = require('suncalc');

// Load your modules here, e.g.:
const sendMessageText = require('./lib/sendMessageText.js');                        // sendMessageText
const valveControl = require('./lib/valveControl.js').valveControl;                 // Steuerung der einzelnen Ventile
const controlVoltage = require('./lib/valveControl.js').controlVoltage;             // state der Steuerspannung
const currentPumpUse = require('./lib/valveControl.js').currentPumpUse;             // state der Pumpen
const threadList = require('./lib/valveControl.js').threadList;                     // Auflistung aller aktiver Sprenger-Kreise
const pressureReliefValve = require('./lib/valveControl.js').pressureReliefValve;   // state des Druckentlastungsventil
const myConfig = require('./lib/myConfig.js');                                      // myConfig → Speichern und abrufen von Konfigurationsdaten der Ventile
const evaporation = require('./lib/evaporation.js');                                // Berechnung der Verdunstung, Ermittlung der täglichen Höchsttemperatur, Speicherung der aktuellen Werte von Temperatur, Luftfeuchtigkeit, Helligkeit, Windgeschwindigkeit und Regenmenge
const tools = require('./lib/tools.js').tools;                                      // tools => laden von Hilfsfunktionen

/**
 * The adapter instance
 */
let adapter;

let publicHolidayStr;               // ext. Adapter → Deutsche Feiertage
let publicHolidayTomorrowStr;
let weatherForecastTodayPfadStr;    // Pfad zur Regenvorhersage in mm (Regenvorhersage - DasWetter.com)
let weatherForecastTodayNum = 0;    // heutige Regenvorhersage in mm
let weatherForecastTomorrowNum = 0; // morgige Regenvorhersage in mm
let addStartTimeSwitch = false;     // Externer Schalter für Zusatzbewässerung
let irrigationRestriction = false;  // Schalter für Bewässerungseinschränkung

let startTimeStr;
let sunriseStr;
let sunsetStr;
let goldenHourEnd;
let holidayStr;                     // switch => sprinklecontrol.*.control.Holiday (Holiday == true)=>Wochenendprogramm
let autoOnOffStr;                   
let kw;                             // akt. KW der Woche
let timer, timerSleep;
let today;  // heutige Tag 0:So;1:Mo...6:Sa

/* memo */
let ObjSprinkle = {};


/**
 * Starts the adapter instance
 * 
 * @param {Partial<utils.AdapterOptions>} [options]
 */
function startAdapter(options) {
    // Create the adapter and define its methods
    return adapter = utils.adapter(Object.assign({}, options, {
        name: 'sprinklecontrol',

        // The ready callback is called when databases are connected and adapter received configuration.
        // start here!
        ready: main, // Main method defined below for readability

        // is called when adapter shuts down - callback has to be called under any circumstances!
        unload: (callback) => {
            try {
                adapter.log.info('cleaned everything up...');
                clearTimeout(timer);
                clearTimeout(timerSleep);
                /*Startzeiten der Timer löschen*/
                schedule.cancelJob('calcPosTimer');
                schedule.cancelJob('sprinkleStartTime');
                schedule.cancelJob('sprinkleSecondStartTime');
                schedule.cancelJob('irrigationRestrictionOn');
                schedule.cancelJob('irrigationRestrictionOff');
                schedule.cancelJob('sprinkleAddStartTime');
                /* alle Ventile und Aktoren deaktivieren */
                valveControl.clearEntireList();
                callback();
            } catch (e) {
                callback();
            }
        },

        // is called if a subscribed state changes
        stateChange: async (id, state) => {
            try {
                adapter.log.debug(`stateChange: ${id} (${state ? state.val : 'null'}) ack: ${state ? state.ack : 'null'}`);
                // The state was changed → Der Zustand wurde geändert
                if(state){
                    // Change in outside temperature → Änderung der Außentemperatur
                    if (id === adapter.config.sensorOutsideTemperature) {	/*Temperatur*/
                        if (!Number.isNaN(Number.parseFloat(state.val))) {
                            // @ts-ignore
                            evaporation.setCurTemperature(parseFloat(state.val), state.ts);
                        } else {
                            adapter.log.warn(`sensorOutsideTemperature => Wrong value: ${state.val}, Type: ${typeof state.val}`);
                        }
                    }
                    // LuftFeuchtigkeit
                    if (id === adapter.config.sensorOutsideHumidity) {
                        if (!Number.isNaN(Number.parseFloat(state.val))) {
                            evaporation.setCurHumidity(parseFloat(state.val), state.lc);
                        } else {
                            adapter.log.warn(`sensorOutsideHumidity => Wrong value: ${state.val}, Type: ${typeof state.val}`);
                        }
                    }
                    // Helligkeit
                    if (id === adapter.config.sensorBrightness) {
                        if (!Number.isNaN(Number.parseFloat(state.val))) {
                            evaporation.setCurIllumination(parseFloat(state.val), state.lc);
                        } else {
                            adapter.log.warn(`sensorBrightness => Wrong value: ${state.val}, Type: ${typeof state.val}`);
                        }
                    }
                    // Windgeschwindigkeit
                    if (id === adapter.config.sensorWindSpeed) {
                        if (!Number.isNaN(Number.parseFloat(state.val))) {
                            evaporation.setCurWindSpeed(parseFloat(state.val), state.lc);
                        } else {
                            adapter.log.warn(`sensorWindSpeed => Wrong value: ${state.val}, Type: ${typeof state.val}`);
                        }
                    }
                    // Regencontainer
                    // If the amount of rain is over 20 mm, the 'lastRainCounter' is overwritten and no calculation is carried out. =>
                    //	* Wenn die Regenmenge mehr als 20 mm beträgt, wird der 'lastRainCounter' überschrieben und es wird keine Berechnung durchgeführt.
                    if (id === adapter.config.sensorRainfall) {
                        if (!Number.isNaN(Number.parseFloat(state.val))) {
                            evaporation.setCurAmountOfRain(parseFloat(state.val));
                        } else {
                            adapter.log.warn(`sensorRainfall => Wrong value: ${state.val}, Type: ${typeof state.val}`);
                        }
                    }
                    // Feiertagskalender
                    if (adapter.config.publicHolidays === true) {
                        if (id === `${adapter.config.publicHolInstance}.heute.boolean`) {
                            publicHolidayStr = state.val;
                            startTimeSprinkle();
                        }
                        if (id === `${adapter.config.publicHolInstance}.morgen.boolean`) {
                            publicHolidayTomorrowStr = state.val;
                            startTimeSprinkle();
                        }
                    }
                    // Wettervorhersage
                    if (adapter.config.weatherForecastService !== 'noWeatherData') {
                        if (id === weatherForecastTodayPfadStr) {
                            if (typeof state.val == 'string') {
                                weatherForecastTodayNum = parseFloat(state.val);
                            } else if (typeof state.val == 'number') {
                                weatherForecastTodayNum = state.val;
                            } else {
                                weatherForecastTodayNum = 0;
                                adapter.log.info(`StateChange => Wettervorhersage state.val ( ${ state.val }; ${ typeof state.val } ) kann nicht als Number verarbeitet werden`);
                            }
                            adapter.setState('info.rainToday', {
                                val: weatherForecastTodayNum,
                                ack: true
                            });
                        }
                        if (id === `${adapter.config.weatherForInstance}.location_1.ForecastDaily.Day_2.Rain`) {
                            weatherForecastTomorrowNum = parseFloat(state.val);
                            adapter.setState('info.rainTomorrow', {
                                val: weatherForecastTomorrowNum,
                                ack: true
                            });
                        }
                    }
                    // Füllstand der Zisterne bei Statusänderung
                    if (adapter?.config?.actualValueLevel && (id === adapter.config.actualValueLevel)) {
                        valveControl.setFillLevelCistern(parseFloat(state?.val) || 0);
                        //fillLevelCistern = state.val || 0;
                    }
                    // Rückmeldungen mit ack === False
                    if(state.ack === false){
                        // wenn (Holiday == true) ist, soll das Wochenendprogramm gefahren werden.
                        if (id === `${adapter.namespace}.control.Holiday`) {
                            holidayStr = state.val;
                            adapter.setState(id, {
                                val: state.val,
                                ack: true
                            });
                            startTimeSprinkle();
                        }
                        // wenn (addStartTimeSwitch == true) wird die zusätzliche Bewässerung aktiviert
                        if (id === `${adapter.namespace}.control.addStartTimeSwitch`) {
                            addStartTimeSwitch = state.val;
                            adapter.setState(id, {
                                val: state.val,
                                ack: true
                            });
                        }
                        // wenn (autoOnOff == false) so werden alle Sprenger nicht mehr automatisch gestartet.
                        if (id === `${adapter.namespace}.control.autoOnOff`) {
                            autoOnOffStr = state.val;
                            adapter.log.info(`startAdapter: control.autoOnOff: ${state.val}`);
                            adapter.setState(id, {
                                val: state.val,
                                ack: true
                            });
                            if (state.val === false) {
                                valveControl.clearEntireList();
                            }
                            startTimeSprinkle();
                            secondStartTimeSprinkle();
                        }
                        // wenn (autoStart == true) so die automatische Bewässerung von Hand gestartet
                        if (id === `${adapter.namespace}.control.autoStart`) {
                            adapter.setState(id, {
                                val: false,
                                ack: true
                            });
                            if (state.val === true) {
                                // auto Start;
                                startOfIrrigation("autoStart");
                            }
                        }
                        // wenn (...sprinkleName.runningTime sich ändert) so wird der aktuelle Sprenger [sprinkleName]
                        //    bei == 0 gestoppt, > 1 gestartet || Zeit abgeändert
                        if (myConfig.config && state.val !== '00:00') {
                            const found = myConfig.config.find((d) => d.objectID === id);
                            if (found) {
                                if (id === myConfig.config[found.sprinkleID].objectID) {
                                    if (!isNaN(state.val)) {
                                        valveControl.addList(
                                            [{
                                                auto: false,  // Handbetrieb
                                                sprinkleID: found.sprinkleID,
                                                wateringTime: (state.val <= 0) ? state.val : Math.round(60 * state.val)
                                            }]);
                                        adapter.setState(id, {
                                            val: state.val,
                                            ack: true
                                        });
                                    }
                                }
                            }
                        }
                        // wenn in der config unter methodControlSM!== 'analog' oder 'bistable' eingegeben wurde, dann Bodenfeuchte-Sensor auslesen
                        if (myConfig.config) {

                            // @ts-ignore
                            function filterByID(obj){
                                return (((obj.methodControlSM === 'analog') || (obj.methodControlSM === 'bistable')) && (obj.triggerSM === id));
                            }
                            const filter = myConfig.config.filter(filterByID);
                            if (filter) {
                                for (const fil of filter) {
                                    if (id === myConfig.config[fil.sprinkleID].triggerSM){
                                        // analog
                                        if (fil.methodControlSM === 'analog') {
                                            myConfig.setSoilMoistPct(fil.sprinkleID, state.val);
                                        } else if (fil.methodControlSM === 'bistable') {   // bistable
                                            myConfig.setSoilMoistBool(fil.sprinkleID, state.val);
                                        }
                                    }
                                }
                            }
                        }

                        const idSplit = id.split('.', 5);
                        const _found = myConfig.config.find((d) => d.objectName === idSplit[3]);
                        if (_found) {
                            // wenn (...sprinkleName.autoOn == false[off])  so wird der aktuelle Sprenger [sprinkleName]
                            //   bei false nicht automatisch gestartet
                            if (idSplit[4] === 'autoOn' && id === myConfig.config[_found.sprinkleID].autoOnID) {
                                myConfig.config[_found.sprinkleID].autoOn = state.val;
                                adapter.setState(id, {     // Bestätigung
                                    val: state.val,
                                    ack: true
                                });
                                adapter.log.info(`set ${_found.objectName}.autoOn = ${state.val}, id: ${id}`);
                                if (state.val === false) {
                                    valveControl.addList(
                                        [{
                                            auto: false,
                                            sprinkleID: _found.sprinkleID,
                                            wateringTime: 0
                                        }]
                                    );
                                    adapter.setState(`sprinkle.${_found.objectName}.sprinklerState`, {
                                        val: 'off',
                                        ack: true
                                    });
                                } else if (_found.methodControlSM === 'fixDay') {
                                    await curNextFixDay(myConfig.config[_found.sprinkleID].sprinkleID, false).catch((e) => {
                                        adapter.log.warn(`main.autoOn: (${myConfig.config[_found.sprinkleID].sprinkleID}, false) ${e}`);
                                    });
                                }
                            }

                            //  extBreak → Pause für den Spränger bis 0:05
                            if (idSplit[4] === `extBreak`) {
                                _found.extBreak = state.val;    // speichern unter myConfig.config.*.extBreak
                                const _extBreak = await valveControl.extBreak(_found.sprinkleID, state.val).catch((e) => {
                                    adapter.log.warn(`main.extBreak: ${e}`);
                                });
                                if (_extBreak?.name) adapter.log.info(`_extBreak: ${_extBreak.name}, ${_extBreak.val ? 'on' : 'off'}`);
                                if (_extBreak?.val === false) {
                                    /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost), < 6 > Cistern empty, <<< 7 >>> extBreak */
                                    adapter.setState(`sprinkle.${_found.objectName}.sprinklerState`, {
                                        val: state.val ? 'extBreak' : 'off',
                                        ack: true
                                    });
                                }
                                adapter.setState(id, {     // Bestätigung
                                    val: state.val,
                                    ack: true
                                });
                            }
                            //  postponeByOneDay → um einen Tag verschieben bei fixDay (twoNd & threeRd)
                            if (idSplit[4] === `postponeByOneDay`) {
                                myConfig.postponeByOneDay(_found.sprinkleID).catch((e) => {
                                    adapter.log.warn(`.postponeByOneDay: ${e}`);
                                });
                                adapter.setState(id, {     // Bestätigung
                                    val: false,
                                    ack: true
                                });
                            }
                        }
                    // (state.ack === true)
                    }else if (state.ack === true) {
                        // Bestätigung für das Schalten der Ventile
                        if (myConfig.config) {
                            //adapter.log.info(`vor found: ${id} (${state.val}) => ack === ${state.ack}`);
                            const found = myConfig.config.find((d) => d.control.idACK === id);
                            //adapter.log.info(`nach found: ${id} => ${JSON.stringify(found)}`);
                            if (found && (id === myConfig.config[found.sprinkleID].control.idACK)) {
                                found.state = state;
                            }
                        }
                        if (threadList) {
                            const found = threadList.find((d) => d.control.idACK === id);
                            if (found !== undefined && typeof found.controller.ackTrue === 'function') {
                                found.controller.ackTrue(state);
                            }
                        }
                        // Druckentlastungsventil
                        if (id === pressureReliefValve.control.idACK && typeof pressureReliefValve.controller.ackTrue === 'function') {
                            pressureReliefValve.controller.ackTrue(state);
                        }
                        // 24V Steuerspannung
                        if (id === controlVoltage.control.idACK && typeof controlVoltage.controller.ackTrue === 'function') {
                            controlVoltage.controller.ackTrue(state);
                        }
                        // Pumpe (aktuell verwendete Pumpe)
                        if (id === currentPumpUse.control.idACK && typeof currentPumpUse.controller.ackTrue === 'function') {
                            currentPumpUse.controller.ackTrue(state);
                        }
                        // The state was deleted
                        adapter.log.debug(`state ${id} deleted`);
                    }
                }
            } catch (e) {
                adapter.log.error(`stateChange: ${e}`);
            }    
        },

        // Wenn Sie Nachrichten in Ihrem Adapter akzeptieren müssen, entkommentieren Sie den folgenden Block.
        // /**
        // * Über das Nachrichtenfeld wurde eine Nachricht an diese Instanz gesendet. Wird von E-Mail, Pushover, Text2Speech usw. verwendet.
        // * Für die Verwendung dieser Methode muss die Eigenschaft „common.messagebox“ in io-package.json auf true gesetzt sein
        //  */
        message: (obj) => {
            if (obj) {
                switch (obj.command) {
                    case 'getTelegramUser':
                        adapter.getForeignState(`${adapter.config.telegramInstance}.communicate.users`, (err, state) => {
                            // @ts-ignore
                            err && adapter.log.error(err);
                            if (state && state.val) {
                                try {
                                    adapter.log.debug(`getTelegramUser:${state.val}`);
                                    // @ts-ignore
                                    adapter.sendTo(obj.from, obj.command, JSON.parse(state.val), obj.callback);
                                } catch (err) {
                                    err && adapter.log.error(err);
                                    adapter.log.error('Cannot parse stored user IDs from Telegram!');
                                }
                            }
                        });
                        break;
                }
            }
        }
    }));
}

// +++++++++++++++++ Get longitude an latitude from system config ++++++++++++++++++++
/**Längen- / Breitengrad vom System abrufen, falls nicht festgelegt oder ungültig
 * wird nicht geändert, wenn bereits ein gültiger Wert vorhanden ist,
 * daher können wir bei Bedarf andere Einstellungen als das System verwenden
 */
async function GetSystemData() {
    if (typeof adapter.config.longitude === 'undefined' || adapter.config.longitude === null || adapter.config.longitude.length === 0 || isNaN(+adapter.config.longitude)
        || typeof adapter.config.latitude === 'undefined' || adapter.config.latitude === null || adapter.config.latitude.length === 0 || isNaN(+adapter.config.latitude)) {

        try {
            const obj = await adapter.getForeignObjectAsync('system.config', 'state');

            if (obj?.common?.longitude && obj?.common?.latitude) {
                adapter.config.longitude = obj.common.longitude.toString();
                adapter.config.latitude = obj.common.latitude.toString();

                adapter.log.debug(`longitude: ${adapter.config.longitude} | latitude: ${adapter.config.latitude}`);
            } else {
                adapter.log.error('system settings cannot be called up. Please check configuration!');
            }
        } catch (err) {
            adapter.log.warn('system settings cannot be called up. Please check configuration!');
        }
    }
}

/**
 * Schreiben des nächsten Starts in '.actualSoilMoisture'
 * oder Rückgabe des DayName für den nächsten Start
 * - sprinkleID - Number of Array[0...]
 * - returnOn - true = Rückgabe des Wochentags; false = Schreiben in State /.actualSoilMoisture
 * - nextStart ['Sun','Mon','Tue','Wed','Thur','Fri','Sat']
 *
 * @param sprinkleID
 * @param returnOn
 */
async function curNextFixDay (sprinkleID, returnOn) {
    const weekDayArray = myConfig.config[sprinkleID].fixDay.startFixDay;
    const objPfad = `sprinkle.${myConfig.config[sprinkleID].objectName}`;
    const weekday = ['Sun','Mon','Tue','Wed','Thur','Fri','Sat'];
    let found = false;
    let curDay = tools.formatTime().day;
    const d = new Date();
    const curTime = `${zweiStellen(d.getHours())}:${zweiStellen(d.getMinutes())}`;

    function zweiStellen (s) {
        while (s.toString().length < 2) {
                s = `0${s}`;
            }
        return s;
    }
    if (curTime >= startTimeStr) {
        curDay++;
    }

    for ( let i=0; i<7; i++ ) {
        if (curDay > 6) {
            curDay = curDay - 7;
        }
        if (weekDayArray[curDay] === true) {
            found = true;
            if (returnOn) {
                return weekday[curDay];
            } else {
                adapter.setState(`${objPfad}.actualSoilMoisture`, {
                    val: curDay,
                    ack: true
                });
            }
            break;
        }
        curDay++;
    }
    if (returnOn && found === false) {
        return 'off';
    }
}

/**
 * Neuen Start-Tag für Dreitage- und Zweitage-modus setzen
 * 
 * @param {number} indexNr
 * @param {boolean} threeRd - Dreitage-modus Ja/Nein
 *     true → Dreitage-modus (treeRD)
 *     false → Zweitage-modus (twoNd)
 */
async function setNewDay (indexNr, threeRd) {
    const today = tools.formatTime().day;
    const nextStartDay = ((today + 1) > 6 ? 0 : (today + 1));
    const objectName = myConfig.config[indexNr].objectName;
    const _actualSoilMoisture = await adapter.getStateAsync(
        `sprinkle.${objectName}.actualSoilMoisture`
    ).catch((e) => adapter.log.warn(`${objectName}.actualSoilMoisture fixDay setState ${e}`));
    if (_actualSoilMoisture && (typeof _actualSoilMoisture.val === 'number')) {
        if ((_actualSoilMoisture.val >= 0) && (_actualSoilMoisture.val <= 6)) {
            if ((threeRd)
                && (_actualSoilMoisture.val === (((today + 3) > 6) ? 2 : (today + 3)))
                || (_actualSoilMoisture.val === (((today + 2) > 6) ? 1 : (today + 2)))
                || (_actualSoilMoisture.val === (((today + 1) > 6) ? 0 : (today + 1)))
                || (_actualSoilMoisture.val === today)) {
                myConfig.config[indexNr].fixDay.startFixDay[_actualSoilMoisture.val] = true;
            } else {
                myConfig.config[indexNr].fixDay.startFixDay[nextStartDay] = true;
            }
        } else {
            myConfig.config[indexNr].fixDay.startFixDay[nextStartDay] = true;
        }
        curNextFixDay(myConfig.config[indexNr].sprinkleID, false);
    }
}

/**
 * result Rain
 * - (aktuelle Wettervorhersage - Schwellwert der Regenberücksichtigung) wenn Sensor sich im Freien befindet
 * - (> 0) es regnet - Abbruch -
 * - (≤ 0) Start der Bewässerung
 * 
 * @param {boolean} inGreenhouse - Sensor befindet sich im Gewächshaus
 * @returns {number} - resultierende Regenmenge
 */
function resRain (inGreenhouse) {
    return +((adapter.config.weatherForecastService !== 'noWeatherData' && !inGreenhouse) ? (((+ weatherForecastTodayNum) - parseFloat(adapter.config.thresholdRain)).toFixed(1)) : 0);
}

/**
 * Sets the status (of “instanceObjects” from io-package.json) to a defined value at startup
 * → Setzt den Status (von "instanceObjects" aus io-package.json) beim Start auf einen definierten Wert
 */
async function checkStates() {
    try {
        /**
         * return the saved objects under sprinkle.*
         * rückgabe der gespeicherten Objekte unter sprinkle.*
         */
        const _list = await adapter.getForeignObjectsAsync(`${adapter.namespace}.sprinkle.*`, 'channel');
        if (_list) {
            ObjSprinkle = _list;
        }

        /*   control.Holiday   */
        const _holiday = await adapter.getStateAsync('control.Holiday');
        if (!(_holiday?.val)) {
            adapter.setStateAsync('control.Holiday', {
                val: false, 
                ack: true
            });
        }

        /*   control.autoOnOff   */
        const _autoOnOff = await adapter.getStateAsync('control.autoOnOff');
        if (_autoOnOff?.val && typeof _autoOnOff.val === 'boolean') {
            autoOnOffStr = _autoOnOff.val;
        } else {
            autoOnOffStr = true;
            adapter.setStateAsync('control.autoOnOff', {
                val: autoOnOffStr,
                ack: true
            });
        }

        /*   evaporation.ETpToday   */
        const _ETpToday = await adapter.getStateAsync('evaporation.ETpToday');
        if (_ETpToday?.val) {
            evaporation.setETpTodayNum(+_ETpToday.val);
        } else {
            evaporation.setETpTodayNum(0);
            adapter.setStateAsync('evaporation.ETpToday', {
                val: 0,
                ack: true
            });
        }

        /*   evaporation.ETpYesterday   */
        const _ETpYesterday = await adapter.getStateAsync('evaporation.ETpYesterday');
        if (_ETpYesterday?.val && typeof _ETpYesterday.val !== 'number') {
            adapter.setStateAsync('evaporation.ETpYesterday', {
                val: 0,
                ack: true
            });
        }

        /*   evaporation.dailyHighTemp   */
        const _dailyHighTemp = await adapter.getStateAsync('evaporation.dailyHighTemp');
        if (_dailyHighTemp?.val) {
            evaporation.setCurTemperatureMax(+_dailyHighTemp.val);
        } else {
            evaporation.setCurTemperatureMax(0);
            adapter.setStateAsync('evaporation.dailyHighTemp', {
                val: 0,
                ack: true
            });
        }

        /*   akt. kW ermitteln für history last week   */
        const _formatTime = tools.formatTime();
        kw = _formatTime.kW;
        today = _formatTime.day;
    } catch (e) {
        adapter.log.error(`Error checkStates: ${e}`);
    }
}

/**
 * aktuelle States checken nach dem Start (2000 ms) wenn alle Sprenger-Kreise angelegt wurden
 */
async function checkActualStates () {

    try {
        /*     switch Holiday     */
        const _holiday = await adapter.getStateAsync('control.Holiday');
        if (_holiday?.val && typeof _holiday.val === 'boolean') {
            holidayStr = _holiday.val;
        }

        /*     switch autoOnOff     */
        const _autoOnOff = await adapter.getStateAsync('control.autoOnOff');
        if (_autoOnOff?.val && typeof _autoOnOff.val === 'boolean') {
            autoOnOffStr = _autoOnOff.val;
        }

        /*  wenn (addStartTimeSwitch == true) wird die zusätzliche Bewässerung aktiviert    */
        if (adapter.config.selectAddStartTime === 'withExternalSignal') {
            await adapter.subscribeStatesAsync('control.addStartTimeSwitch');
            const _addStartTimeSwitch = await adapter.getStateAsync('control.addStartTimeSwitch');
            if (_addStartTimeSwitch?.val && typeof _addStartTimeSwitch.val === 'boolean') {
                addStartTimeSwitch = _addStartTimeSwitch.val;
            }
        }

        /*     Feiertage     */
        if (adapter.config.publicHolidays === true && (adapter.config.publicHolInstance !== undefined || adapter.config.publicHolInstance !== '')) {
            /*     Feiertag Heute     */
            const _publicHolInstanceHeute = await adapter.getForeignStateAsync(
                `${adapter.config.publicHolInstance}.heute.boolean`
            );//.catch((e) => adapter.log.warn(`publicHolInstanceHeute: ${e}`));
            if (_publicHolInstanceHeute?.val) {
                publicHolidayStr = _publicHolInstanceHeute.val;
            }
            /*     Feiertag MORGEN     */
            const _publicHolInstanceMorgen = await adapter.getForeignStateAsync(
                `${adapter.config.publicHolInstance}.morgen.boolean`
            );//.catch((e) => adapter.log.warn(`publicHolInstanceMorgen: ${e}`));
            if (_publicHolInstanceMorgen?.val) {
                publicHolidayTomorrowStr = _publicHolInstanceMorgen.val;
            }
        }

        if (adapter.config.weatherForecastService !== 'noWeatherData' && (weatherForecastTodayPfadStr !== undefined || weatherForecastTodayPfadStr !== '')) {
            /*     Niederschlagsmenge HEUTE in mm     */
            const _weatherForInstanceToday = await adapter.getForeignStateAsync(
                weatherForecastTodayPfadStr
            ).catch((e) => adapter.log.warn(`weatherForInstanceToday(Pfad:${weatherForecastTodayPfadStr}): ${e}`));
            if (_weatherForInstanceToday?.val) {
                if (typeof _weatherForInstanceToday.val == 'string') {
                    weatherForecastTodayNum = parseFloat(_weatherForInstanceToday.val);
                } else if (typeof _weatherForInstanceToday.val == 'number') {
                    weatherForecastTodayNum = _weatherForInstanceToday.val;
                } else {
                    weatherForecastTodayNum = 0;
                    adapter.log.info(`checkActualStates => Wettervorhersage state.val ( ${_weatherForInstanceToday.val}); ${typeof _weatherForInstanceToday.val} kann nicht als Number verarbeitet werden`);
                }
                await adapter.setStateAsync('info.rainToday', {
                    val: weatherForecastTodayNum,
                    ack: true
                });
            }
            if (adapter.config.weatherForInstance.length > 10) {
                /*     Niederschlagsmenge MORGEN in mm     */
                const _weatherForInstance = await adapter.getForeignStateAsync(
                    `${adapter.config.weatherForInstance}.location_1.ForecastDaily.Day_2.Rain`
                );//.catch((e) => adapter.log.warn(`weatherForInstance: ${e}`));
                if (_weatherForInstance?.val) {
                    weatherForecastTomorrowNum = + _weatherForInstance.val;
                    await adapter.setStateAsync('info.rainTomorrow', {
                        val: weatherForecastTomorrowNum,
                        ack: true
                    });
                }
            }
        }

        // wenn (...sprinkleName.autoOn == false[off])  so wird der aktuelle Sprenger [sprinkleName]
        //   bei false nicht automatisch gestartet
        /*     Abfrage von ...sprinkleName.autoOn     */
        const result = myConfig.config;
        if (result) {
            for (const res of result) {
                let _sprinklerState = 'off';
                const _extBreak = await adapter.getForeignStateAsync(res.extBreakID);
                if (_extBreak && typeof _extBreak.val === 'boolean') {
                    res.extBreak = _extBreak.val;
                    if (_extBreak.val === true) {
                        adapter.log.info(`get ${res.objectName}.extBreak = ${res.extBreak}`);
                    }
                    _sprinklerState = 'extBreak';
                }
                const _autoOn = await adapter.getForeignStateAsync(
                    res.autoOnID
                );//.catch((e) => adapter.log.warn(`autoOn: ${e}`));
                if (_autoOn && typeof _autoOn.val === 'boolean') {
                    res.autoOn = _autoOn.val;
                    if (_autoOn.val === false) {
                        adapter.log.info(`get ${res.objectName}.autoOn = ${res.autoOn}`);
                    }
                    _sprinklerState = 'off';
                }
                await adapter.setStateAsync(`sprinkle.${res.objectName}.sprinklerState`, {
                    val: _sprinklerState,
                    ack: true
                });
            }
        }

        /*     Füllstand der Zisterne in % holen     */
        if (adapter.config.actualValueLevel){
            const _actualValueLevel = await adapter.getForeignStateAsync(
                adapter.config.actualValueLevel
            );//.catch((e) => adapter.log.warn(`actualValueLevel: ${e}`));
            if (_actualValueLevel?.val) {
                valveControl.setFillLevelCistern(_actualValueLevel.val);
            }
        }

    } catch (e) {
        adapter.log.warn(`sprinkleControl cannot check actual States ... Please check your sprinkleControl states: ${e}`);
    }
}


/**
 * at 0:05 start of StartTimeSprinkle
 * => um 0:05 start von StartTimeSprinkle
 * (..., '(s )m h d m wd')
 */
// @ts-ignore
 
const calcPos = schedule.scheduleJob('calcPosTimer', '5 0 * * *', function() {
    // Berechnungen mittels SunCalc
    sunPos();
    const _curTime = tools.formatTime();
    today = _curTime.day;

    // History Daten aktualisieren, wenn eine neue Woche beginnt
    adapter.log.debug(`calcPos 0:05 old-KW: ${kw} new-KW: ${_curTime.kW} if: ${(kw !== _curTime.kW)}`);
    if (kw !== _curTime.kW) {
        const result = myConfig.config;
        if (result) {
            for(const i in result) {
                // eslint-disable-next-line no-prototype-builtins
                if (result.hasOwnProperty(i)) {
                    const objectName = result[i].objectName;
                    // @ts-ignore
                    adapter.getState(`sprinkle.${ objectName }.history.curCalWeekConsumed`, (err, state) => {
                        if (state) {
                            adapter.setState(`sprinkle.${ objectName }.history.lastCalWeekConsumed`, { val: state.val, ack: true });
                            adapter.setState(`sprinkle.${ objectName }.history.curCalWeekConsumed`, { val: 0, ack: true });
                        }
                    });
                    // @ts-ignore
                    adapter.getState(`sprinkle.${ objectName }.history.curCalWeekRunningTime`, (err, state) => {
                        if (state) {
                            adapter.setState(`sprinkle.${ objectName }.history.lastCalWeekRunningTime`, { val: state.val, ack: true });
                            adapter.setState(`sprinkle.${ objectName }.history.curCalWeekRunningTime`, { val: '00:00', ack: true });
                        }
                    });
                }

            }
        }
        kw = _curTime.kW;
    }

    // ETpToday, ETpYesterday, curTemperatureMax in evaporation aktualisieren da ein neuer Tag
    evaporation.setNewDay();

    // Startzeit Festlegen → verzögert wegen Daten von SunCalc
    setTimeout(() => {
        startTimeSprinkle();
        secondStartTimeSprinkle();
        if (adapter.config.enableTimeBasedRestriction === true) {
            irrigationRestrictionOn();
            irrigationRestrictionOff();
        }
        addStartTimeSprinkle();
    },1000);

});

// Berechnung mittels sunCalc
function sunPos() {
    let times;

    try{
    // get today's sunlight times → Holen Sie sich die heutige Sonnenlichtzeit
        times = SunCalc.getTimes(new Date(), +adapter.config.latitude, +adapter.config.longitude);
        adapter.log.debug('calculate astrodata ...');
    } catch (e) {
        adapter.log.error('cannot calculate astrodata ... please check your config for latitude und longitude!!');
    }

    if (times) {
        // format sunrise time from the Date object → Formatieren Sie die Sonnenaufgangszeit aus dem Date-Objekt
        sunriseStr = `${  (`0${ times.sunrise.getHours() }`).slice(-2)  }:${  (`0${ times.sunrise.getMinutes() }`).slice(-2)  }`;

        // format golden hour end time from the Date object → Formatiere golden hour end time aus dem Date-Objekt
        goldenHourEnd = `${(`0${  times.goldenHourEnd.getHours()}`).slice(-2)  }:${  (`0${  times.goldenHourEnd.getMinutes()}`).slice(-2)}`;

        // format sunset time from the Date object → formatieren Sie die Sonnenuntergangszeit aus dem Date-Objekt
        sunsetStr = sunsetStr = `${(`0${  times.sunset.getHours()}`).slice(-2)  }:${  (`0${  times.sunset.getMinutes()}`).slice(-2)}`;
    }
}

function irrigationRestrictionOn() {
    schedule.cancelJob('irrigationRestrictionOn');
    if (adapter.config.enableTimeBasedRestriction === true) {
        const startOfInterruptionSplit = adapter.config.startOfInterruption.split(':');
        const scheduleStartOfInterruption = schedule.scheduleJob('irrigationRestrictionOn', `${ startOfInterruptionSplit[1] } ${ startOfInterruptionSplit[0] } * * *`, function() {
            irrigationRestriction = true;
            valveControl.timeBasedRestriction(true);
            adapter.log.info(`Time-based irrigation restriction is enabled! (${adapter.config.startOfInterruption} - ${adapter.config.endOfInterruption})`);
        });
    }
}

function irrigationRestrictionOff() {
    schedule.cancelJob('irrigationRestrictionOff');
    const endOfInterruptionSplit = adapter.config.endOfInterruption.split(':');
    const scheduleEndOfInterruption = schedule.scheduleJob('irrigationRestrictionOff', `${ endOfInterruptionSplit[1] } ${ endOfInterruptionSplit[0] } * * *`, function() {
        irrigationRestriction = false;
        valveControl.timeBasedRestriction(false);
        adapter.log.info('Time-based irrigation restrictions have been disabled!');
    });
}

function addStartTimeSprinkle() {
    schedule.cancelJob('sprinkleAddStartTime');
    if (adapter.config.selectAddStartTime === 'greaterETpCurrent' 
        || adapter.config.selectAddStartTime === 'greaterDailyMaxTemp' 
        || adapter.config.selectAddStartTime === 'withExternalSignal'
        ) {
        const addStartTimeSplit = adapter.config.addWateringStartTime.split(':');
        // @ts-ignore
         
        const scheduleAddStartTime = schedule.scheduleJob('sprinkleAddStartTime', `${ addStartTimeSplit[1] } ${ addStartTimeSplit[0] } * * *`, function() {
            // if (autoOnOff == false) => keine auto Start
            if (!autoOnOffStr) {
                sendMessageText.sendMessage('Irrigation not possible!\n (autoOnOff == false)');
                schedule.cancelJob('sprinkleAddStartTime');
                return;
            }
            // Zisterne leer → Abbruch
            if(valveControl.getIntBreakCisternPump()) {
                adapter.log.warn('Additional irrigation is not possible! The cistern is empty.');
                sendMessageText.sendMessage('Additional irrigation is not possible!\n The cistern is empty.');
                schedule.cancelJob('sprinkleAddStartTime');
                return;
            }
            // @ts-ignore
            if (((adapter.config.selectAddStartTime === 'greaterETpCurrent') && (adapter.config.triggerAddStartTimeETpCur < evaporation.getETpTodayNum()))
                || ((adapter.config.selectAddStartTime === 'greaterDailyMaxTemp') && (adapter.config.triggerAddStartTimeTempMax < evaporation.getCurTemperatureMax()))
                || ((adapter.config.selectAddStartTime === 'withExternalSignal') && addStartTimeSwitch)
            ) {
                let messageText = '';

                // Filter enabled
                const result = myConfig.config.filter((d) => d.enabled === true);
                if (result) {
                    /**
                     * Array zum flüchtigen Sammeln von Bewässerungsaufgaben
                     */
                    const memAddList = [];

                    for(const res of result) {
                        if (res.autoOn                                  // Ventil aktiv
                            && (res.addWateringTime > 0)                // zusätzliche Bewässerung aktiv time > 0
                            && (resRain(res.inGreenhouse) <= 0)) {      // keine Regenvorhersage

                            switch (res.methodControlSM) {
                                case 'bistable': {
                                    if (res.bistable.bool) {
                                        messageText += `<b>${res.objectName}</b> (${res.bistable.bool})\n`
                                                    +  `   ${res.extBreak ? 'extBreak ||' : 'START =>'} ${tools.addTime(Math.round(60 * res.addWateringTime), '')}\n`;
                                        memAddList.push({
                                            auto: false,
                                            sprinkleID: res.sprinkleID,
                                            wateringTime: Math.round(60 * res.addWateringTime)
                                        });
                                    }
                                    break;
                                }
                                case 'fixDay': {
                                    messageText += `<b>${res.objectName}</b>\n`
                                                +  `   ${res.extBreak ? 'extBreak ||' : 'START =>'} ${tools.addTime(Math.round(60 * res.addWateringTime), '')}\n`;
                                    memAddList.push({
                                        auto: false,
                                        sprinkleID: res.sprinkleID,
                                        wateringTime: Math.round(60 * res.addWateringTime)
                                    });
                                    break;
                                }
                                case 'calculation': {
                                    messageText += `<b>${res.objectName}</b> ${res.calculation.pct}% (${res.calculation.pctTriggerIrrigation}%)\n`
                                                    + `   ${res.extBreak ? 'extBreak ||' : 'START =>'} ${tools.addTime(Math.round(60 * res.addWateringTime), '')}\n`;
                                    memAddList.push({
                                        auto: false,
                                        sprinkleID: res.sprinkleID,
                                        wateringTime: Math.round(60 * res.addWateringTime)
                                    });
                                    break;
                                }
                                case 'analog': {
                                    if (res.analog.pct < res.analog.pctAddTriggersIrrigation) {
                                        messageText += `<b>${res.objectName}</b> ${res.analog.pct} %(${res.analog.pctAddTriggersIrrigation}%)\n`
                                                    +  `   ${res.extBreak ? 'extBreak ||' : 'START =>'} ${tools.addTime(Math.round(60 * res.addWateringTime), '')}\n`;
                                        memAddList.push({
                                            auto: false,
                                            sprinkleID: res.sprinkleID,
                                            wateringTime: Math.round(60 * res.addWateringTime)
                                        });
                                    }
                                    break;
                                }
                            }
                        } else {
                            adapter.log.debug(`${res.objectName}: autoOn (${res.autoOn}) && addWateringTime (${60 * res.addWateringTime} > 0) && resRain (${resRain(res.inGreenhouse)}) <= 0, if(${res.autoOn && (60 * res.addWateringTime > 0) && (resRain(res.inGreenhouse) <= 0)})`);
                        }
                    }
                    valveControl.addList(memAddList);
                }
                if(!sendMessageText.onlySendError() && messageText.length > 0){
                    sendMessageText.sendMessage(messageText);
                }
            } else {
                // @ts-ignore
                adapter.log.debug(`greaterETpCurrent: ${(adapter.config.selectAddStartTime === 'greaterETpCurrent')} & ${(adapter.config.triggerAddStartTimeETpCur < evaporation.getETpTodayNum())}, withExternalSignal; ${(adapter.config.selectAddStartTime === 'withExternalSignal')} & ${addStartTimeSwitch}`);
            }
            setTimeout(()=>{
                schedule.cancelJob('sprinkleAddStartTime');
            }, 200);
        });
    }
}

// Determination of the irrigation time => Bestimmung der Bewässerungszeit
function startTimeSprinkle() {
    let startTimeSplit = [];
    let infoMessage;

    schedule.cancelJob('sprinkleStartTime');

    // if (autoOnOff == false) => keine auto Start
    if (!autoOnOffStr) {
        adapter.log.info(`Sprinkle: autoOnOff === Aus ( ${autoOnOffStr} )`);
        adapter.setState('info.nextAutoStart', {
            val: 'autoOnOff = off(0)',
            ack: true
        });
        return;
    }

    /**
     * next start time (automatic)
     * → Berechnung des nächsten Starts (Automatik)
     *
     * @returns {string}
     */
    function nextStartTime () {
        let newStartTime = adapter.config.weekLiving;
        let run = 0;
        const curTime = new Date();
        const myHours = checkTime(curTime.getHours());
        const myMinutes = checkTime(curTime.getMinutes());
        let myWeekday = curTime.getDay();
        const myWeekdayStr = ['So','Mo','Di','Mi','Do','Fr','Sa'];
        const myTime = `${myHours}:${myMinutes}`;

        /**
         * aus 0...9 wird String 00...09
         *
         * @param {string|number} i
         * @returns {string}
         */
        function checkTime(i) {
            return (+i < 10) ? `0${  i}` : i.toString();
        }

        do {
            myWeekday += run;
            run++;
            if (myWeekday>6){
                myWeekday=0;
            }
            // Start time variant according to configuration => Startzeitvariante gemäß Konfiguration
            switch(adapter.config.wateringStartTime) {
                case 'livingTime' :				/*Startauswahl = festen Zeit*/
                    infoMessage = 'Start zur festen Zeit ';
                    newStartTime = adapter.config.weekLiving;
                    break;
                case 'livingSunrise' :			/*Startauswahl = Sonnenaufgang*/
                    infoMessage = 'Start mit Sonnenaufgang ';
                    // format sunrise time from the Date object
                    newStartTime = tools.addTime(sunriseStr, parseInt(adapter.config.timeShift));
                    break;
                case 'livingGoldenHourEnd' :	/*Startauswahl = Ende der Golden Hour*/
                    infoMessage = 'Start zum Ende der Golden Hour ';
                    // format goldenHourEnd time from the Date object
                    newStartTime = goldenHourEnd;
                    break;
                case 'livingSunset' :           /*Startauswahl = Sonnenuntergang*/
                    infoMessage = 'Start mit Sonnenuntergang ';
                    // format sunset time from the Date object
                    newStartTime = tools.addTime(sunsetStr, parseInt(adapter.config.timeShift));
                    break;
            }
            // Start am Wochenende →, wenn andere Zeiten verwendet werden soll
            if((adapter.config.publicWeekend) && ((myWeekday === 6) || (myWeekday === 0))){
                infoMessage = 'Start am Wochenende ';
                newStartTime = adapter.config.weekEndLiving;
            }
            // Start an Feiertagen →, wenn Zeiten des Wochenendes verwendet werden soll
            if((adapter.config.publicHolidays) && (adapter.config.publicWeekend)
                && (((publicHolidayStr === true) && (run === 1))            // heute Feiertag && erster Durchlauf
                || ((publicHolidayTomorrowStr === true) && (run === 2))     // morgen Feiertag && zweiter Durchlauf
                || (holidayStr === true))) {                                // Urlaub
                infoMessage = 'Start am Feiertag ';
                newStartTime = adapter.config.weekEndLiving;
            }
        } while ((newStartTime <= myTime) && (run === 1));

        const newStartTimeLong = `${ myWeekdayStr[myWeekday] } ${ newStartTime }`;
        /*     next Auto-Start     */
        // @ts-ignore
        adapter.getState('info.nextAutoStart', (err, state) =>{
            if (state) {
                if (state.val !== newStartTimeLong) {
                    adapter.setState('info.nextAutoStart', {
                        val: newStartTimeLong,
                        ack: true
                    });
                    // next Start Message
                    if(!sendMessageText.onlySendError){
                        sendMessageText.sendMessage(`${ infoMessage }(${ myWeekdayStr[myWeekday] }) um ${ newStartTime }`);
                    }
                    adapter.log.info(`${infoMessage} (${myWeekdayStr[myWeekday]}) um ${newStartTime}`);
                }
            }
        });
        return newStartTime;
    }
    //
    startTimeStr = nextStartTime();
    startTimeSplit = startTimeStr.split(':');

    // @ts-ignore
     
    const scheduleStartTime = schedule.scheduleJob('sprinkleStartTime', `${ startTimeSplit[1] } ${ startTimeSplit[0] } * * *`, function() {
        startOfIrrigation("firstStartTime");
        setTimeout (() => {
            setTimeout(()=>{
                nextStartTime();
            }, 800);
            schedule.cancelJob('sprinkleStartTime');
        }, 200);
    });
}

const startOfIrrigation = async (selectStartTime) => {
    let messageText = '';

    try {
        // Zisterne leer → Abbruch
        if(valveControl.getIntBreakCisternPump()) {
            adapter.log.warn('Additional irrigation is not possible! The cistern is empty.');
            sendMessageText.sendMessage('Irrigation not possible!\n The cistern is empty.');
            schedule.cancelJob('sprinkleAddStartTime');
        }
        // Filter enabled
        const result = myConfig.config.filter((d) => (d.enabled === true && (d.startTimeSelection === selectStartTime || selectStartTime === "autoStart")));
        if (result) {
        /**
         * Array zum flüchtigen Sammeln von Bewässerungsaufgaben
         */
            const memAddList = [];

            for(const res of result) {
                messageText += `<b>${ res.objectName }</b>`;
                switch (res.methodControlSM) {
                    case 'bistable':
                        messageText += ` (${res.bistable.bool})\n`;
                        break;
                    case 'analog':
                        messageText += ` ${res.analog.pct}% (${res.analog.pctTriggerIrrigation}%`;
                        break;
                    case 'fixDay':
                        messageText += ` (${await curNextFixDay(res.sprinkleID, true)})\n`;
                        break;
                    case 'calculation':
                        messageText += ` ${res.calculation.pct}% (${res.calculation.pctTriggerIrrigation}%)\n`;
                        break;
                }

                // Test Bodenfeuchte
                if (res.autoOn) {
                    switch (res.methodControlSM) {
                        // -- bistable  --  Bodenfeuchte-Sensor mit 2-Punkt-Regler true und false -- //
                        case 'bistable':
                            if(res.bistable.bool) {
                            /* Wenn in der Config Regenvorhersage aktiviert: Startvorgang abbrechen, wenn der Regen den eingegebenen Schwellwert überschreitet. */
                                if (resRain(res.inGreenhouse) <= 0) {
                                    const curWateringTime = Math.round(60 * res.wateringTime * evaporation.timeExtension(res.wateringAdd));
                                    memAddList.push({
                                        auto: true,
                                        sprinkleID: res.sprinkleID,
                                        wateringTime: curWateringTime
                                    });
                                    messageText += `   ${res.extBreak ? 'extBreak ||' : 'START =>'} ${tools.addTime(curWateringTime, '')}\n`;
                                } else if (adapter.config.weatherForecastService !== 'noWeatherData') {
                                /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                    messageText += `   <i>Start verschoben, da heute ${weatherForecastTodayNum}mm Niederschlag</i> \n`;
                                    adapter.log.info(`${res.objectName}: Start verschoben, da Regenvorhersage für Heute ${weatherForecastTodayNum} mm [ ${resRain(res.inGreenhouse)} > 0 ]`);
                                }
                            }
                            break;
                        // --- analog  --  Bodenfeuchte-Sensor im Wertebereich von 0 bis 100% --- //
                        //  --                 Prozentuale Bodenfeuchte zu gering             --  //
                        case 'analog':
                            if(res.analog.pct <= res.analog.pctTriggerIrrigation) {
                            /* Wenn in der Config Regenvorhersage aktiviert: Startvorgang abbrechen, wenn der Regen den eingegebenen Schwellwert überschreitet. */
                                if (resRain(res.inGreenhouse) <= 0) {
                                    let countdown = res.wateringTime * (100 - res.analog.pct) / (100 - res.analog.pctTriggerIrrigation); // in min
                                    // Begrenzung der Bewässerungszeit auf dem in der Config eingestellten Überschreitung (in Prozent)
                                    if (countdown > (res.wateringTime * res.wateringAdd / 100)) {
                                        countdown = res.wateringTime * res.wateringAdd / 100;
                                    }
                                    memAddList.push({
                                        auto: true,
                                        sprinkleID: res.sprinkleID,
                                        wateringTime: Math.round(60* countdown)
                                    });
                                    messageText += `   ${res.extBreak ? 'extBreak ||' : 'START =>'} ${tools.addTime(Math.round(60*countdown), '')}\n}`;
                                } else if (adapter.config.weatherForecastService !== 'noWeatherData') {
                                /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                    messageText += `   <i>Start verschoben, da heute ${weatherForecastTodayNum}mm Niederschlag</i> \n`;
                                    adapter.log.info(`${res.objectName}: Start verschoben, da Regenvorhersage für Heute ${weatherForecastTodayNum}mm [ ${resRain(res.inGreenhouse)} > 0 ]`);
                                }
                            }
                            break;
                        // --- fixDay  --  Start an festen Tagen ohne Sensoren  --- //
                        //  --              Bewässerungstag erreicht                //
                        case 'fixDay':
                        /* Wenn in der Config Regenvorhersage aktiviert: Startvorgang abbrechen, wenn der Regen den eingegebenen Schwellwert überschreitet. */
                            if (resRain(res.inGreenhouse) <= 0) {
                            // Bewässerungstag erreicht
                                if (res.fixDay.startFixDay[today]) {
                                    const curWateringTime = Math.round(60 * res.wateringTime * evaporation.timeExtension(res.wateringAdd));
                                    memAddList.push({
                                        auto: true,
                                        sprinkleID: res.sprinkleID,
                                        wateringTime: curWateringTime
                                    });
                                    messageText += `   ${res.extBreak ? 'extBreak ||' : 'START =>'} ${tools.addTime(curWateringTime, '')}\n`;
                                    if (res.fixDay.startDay === 'threeRd'){          // Next Start in 3 Tagen
                                        res.fixDay.startFixDay[today] = false;
                                        res.fixDay.startFixDay[(+ today + 3 > 6) ? (+ today-4) : (+ today+3)] = true;
                                    }else if (res.fixDay.startDay === 'twoNd') {     // Next Start in 2 Tagen
                                        res.fixDay.startFixDay[today] = false;
                                        res.fixDay.startFixDay[(+ today + 2 > 6) ? (+ today-5) : (+ today+2)] = true;
                                    }
                                }
                            } else if (adapter.config.weatherForecastService !== 'noWeatherData'){
                                messageText += `   <i>Start verschoben, da heute ${weatherForecastTodayNum}mm Niederschlag</i> \n`;
                                adapter.log.info(`${res.objectName}: Start verschoben, da Regenvorhersage für Heute ${weatherForecastTodayNum} mm [ ${resRain(res.inGreenhouse)} > 0 ]`);
                                if ((res.fixDay.startDay === 'threeRd') || (res.fixDay.startDay === 'twoNd')) {
                                    let startDay = -1;
                                    res.fixDay.startFixDay.forEach((item, index) => {
                                        if (item) {
                                            startDay = index;
                                        }
                                    });
                                    if (startDay !== -1) {
                                        res.fixDay.startFixDay[startDay] = false;
                                        res.fixDay.startFixDay[(+ startDay + 1 > 6) ? (+ startDay-6) : (+ startDay+1)] = true;
                                    } else {
                                        adapter.log.warn(`${res.objectName}: no start day found`);
                                    }
                                }
                            }
                            await curNextFixDay(res.sprinkleID, false);
                            break;
                        // ---   calculation  --  Berechnung der Bodenfeuchte  --- //
                        //  --             Bodenfeuchte zu gering              --  //
                        case 'calculation':
                            if (res.calculation.val <= res.calculation.triggersIrrigation) {
                            /* Wenn in der Config Regenvorhersage aktiviert: Startvorgang abbrechen, wenn es heute ausreichend regnen sollte. */
                                const resMoisture = (adapter.config.weatherForecastService !== 'noWeatherData')?((+ res.calculation.val) + (+ weatherForecastTodayNum) - parseFloat(adapter.config.thresholdRain)):(res.calculation.val);   // aktualisierte Bodenfeuchte mit Regenvorhersage
                                if ((resMoisture <= res.calculation.triggersIrrigation) || res.inGreenhouse) {   // Kontrolle ob Regenvorhersage ausreicht || Bewässerung inGreenhouse
                                    let countdown = res.wateringTime * (res.calculation.maxIrrigation - res.calculation.val) / (res.calculation.maxIrrigation - res.calculation.triggersIrrigation); // in min
                                    // Begrenzung der Bewässerungszeit auf dem in der Config eingestellten Überschreitung (in Prozent)
                                    if (countdown > (res.wateringTime * res.wateringAdd / 100)) {
                                        countdown = res.wateringTime * res.wateringAdd / 100;
                                    }
                                    memAddList.push({
                                        auto: true,
                                        sprinkleID: res.sprinkleID,
                                        wateringTime: Math.round(60*countdown)
                                    });
                                    messageText += `   ${res.extBreak ? 'extBreak ||' : 'START =>'} ${tools.addTime(Math.round(60*countdown), '')}\n`;
                                } else if (adapter.config.weatherForecastService !== 'noWeatherData') {
                                /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                    messageText += `   <i>Start verschoben, da heute ${weatherForecastTodayNum}mm Niederschlag</i> \n`;
                                    adapter.log.info(`${res.objectName}: Start verschoben, da Regenvorhersage für Heute ${weatherForecastTodayNum} mm [ ${res.calculation.val.toFixed(1)} (${resMoisture.toFixed(1)}) <= ${res.calculation.triggersIrrigation} ]`);
                                }
                            }
                            break;
                    }
                } else {
                    messageText += `   <i>Ventil auf Handbetrieb</i> \n`;
                }
            }
            valveControl.addList(memAddList);
        }
        if(!sendMessageText.onlySendError()){
            sendMessageText.sendMessage(messageText);
        }

    } catch (error) {
        adapter.log.error(`startOfIrrigation ERROR: ${error}`);
    }
};

// Determination of the second irrigation time => Bestimmung der 2. Bewässerungszeit
function secondStartTimeSprinkle() {
    schedule.cancelJob('sprinkleSecondStartTime');

        // if (autoOnOff == false) => keine auto Start
    if (!autoOnOffStr) {
        adapter.log.info(`Sprinkle: autoOnOff === Aus ( ${autoOnOffStr} )`);
        adapter.setState('info.nextAutoStart', {
            val: 'autoOnOff = off(0)',
            ack: true
        });
        return;
    }

    const secondStartTimeSplit = adapter.config.secondStartTime.split(':');
    // @ts-ignore
    const scheduleSecondStartTime = schedule.scheduleJob('sprinkleSecondStartTime', `${ secondStartTimeSplit[1] } ${ secondStartTimeSplit[0] } * * *`, function() {
        startOfIrrigation("secondStartTime");
        setTimeout(()=>{
            schedule.cancelJob('sprinkleSecondStartTime');
        }, 200);
    });
}

//
async function createSprinklers() {
    /*  Creates an Object .control.addStartTimeSwitch, when additional watering has been activated via an external signal
     * - Erzeugt ein Object .control.addStartTimeSwitch, wenn die Zusatzbewässerung über ein externes Signal aktiviert wurde
     */
    const _addStartTimeSwitch = await adapter.findForeignObjectAsync(`${adapter.namespace}.control.addStartTimeSwitch`, 'boolean').catch((e) => adapter.log.warn(`.control.addStartTimeSwitch ${e}`));
    if (_addStartTimeSwitch.id !== `${adapter.namespace}.control.addStartTimeSwitch` && adapter.config.selectAddStartTime === 'withExternalSignal') {
        adapter.setObjectNotExistsAsync(`${adapter.namespace}.control.addStartTimeSwitch`, {
            type: 'state',
            common: {
                role: 'switch',
                name:  'additional irrigation enabled',
                type:  'boolean',
                read:  true,
                write: true,
                def: false
            },
            native: {}
        }).catch((e) => adapter.log.warn(`.control.addStartTimeSwitch ${e}`));
    // @ts-ignore
    } else if (_addStartTimeSwitch.id === `${adapter.namespace}.control.addStartTimeSwitch`) {
        if (adapter.config.selectAddStartTime !== 'withExternalSignal') {
            adapter.delObjectAsync(`${adapter.namespace}.control.addStartTimeSwitch`).catch((e) => adapter.log.warn(`.control.addStartTimeSwitch ${e}`));
            addStartTimeSwitch = false;
        } else {
            /*   */
            const _state = await adapter.getStateAsync(`${adapter.namespace}.control.addStartTimeSwitch`).catch((e) => adapter.log.warn(`.control.addStartTimeSwitch ${e}`));
            if (_state && typeof _state.val === 'boolean') {
                addStartTimeSwitch = _state.val;
            }
        }
    }


    /**
     * Bereitstellen des Objekts .actualSoilMoisture für die einzelnen Bewässerungsverfahren
     *
     * @param {string} methodControlSM
     * @param {string} objectName
     * @returns {Promise<{nameMetConSM: string; objMetConSM: {type: string, common: {role: string, name: string, type: string, min?: number, max?: number, states?: {}, unit?: string, read: boolean, write: boolean, def?: number | string | boolean}, native: {}}}>}
     */
    const fillMetConSM = async (methodControlSM, objectName) => {
        //adapter.log.debug(JSON.stringify(res));
        switch (methodControlSM) {
            case 'calculation': {
                return {
                    nameMetConSM: `${objectName} => Calculated soil moisture in %`,
                    objMetConSM: {
                        type: 'state',
                        common: {
                            role: 'state',
                            name: `${objectName} => Calculated soil moisture in %`,
                            desc:  {
                                en: "Calculated soil moisture in %",
                                de: "Berechnete Bodenfeuchte in %",
                                ru: "Рассчитанная влажность почвы в %",
                                pt: "Umidade do solo calculada em %",
                                nl: "Berekenend bodemvochtigheid in %",
                                fr: "Humidité du sol calculée en %",
                                it: "Umidità del suolo calcolata in %",
                                es: "Humedad del suelo calculada en %",
                                pl: "Obliczana wilgotność gleby w %",
                                uk: "Рассчитанная влажность почвы в %",
                                'zh-cn': "计算土壤湿度（%）"
                            },
                            type: 'number',
                            min: 0,
                            max: 150,
                            unit: '%',
                            read: true,
                            write: false,
                            def: 50
                        },
                        native: {},
                    }
                };
            }
            case 'bistable': {
                return {
                    nameMetConSM: `${objectName} => bistable soil moisture sensor`,
                    objMetConSM: {
                        type: 'state',
                        common: {
                            role: 'state',
                            name: `${objectName} => bistable soil moisture sensor`,
                            desc:  {
                                en: "bistable soil moisture sensor",
                                de: "bistabiler Bodenfeuchtesensor",
                                ru: "бистабильный датчик влажности почвы",
                                pt: "sensor de umidade do solo biescalar",
                                nl: "bistabiele bodemvochtigheidssensor",
                                fr: "capteur d'humidité du sol bistable",
                                it: "sensore di umidità del suolo bistabile",
                                es: "sensor de humedad del suelo biescalar",
                                pl: "bistabilny czujnik wilgotności gleby",
                                uk: "бістабільний датчик вологості грунту",
                                'zh-cn': "双稳态土壤湿度传感器"
                            },
                            type: 'boolean',
                            read: true,
                            write: false,
                            def: false
                        },
                        native: {},
                    }
                };
            }
            case 'analog': {
                return {
                    nameMetConSM: `${objectName} => analog soil moisture sensor in %`,
                    objMetConSM: {
                        type: 'state',
                        common: {
                            role: 'state',
                            name: `${objectName} => analog soil moisture sensor in %`,
                            desc:  {
                                en: "analog soil moisture sensor in %",
                                de: "analoger Bodenfeuchtesensor in %",
                                ru: "аналоговый датчик влажности почвы в %",
                                pt: "sensor de umidade do solo analógico em %",
                                nl: "analoge bodemvochtigheidssensor in %",
                                fr: "capteur d'humidité du sol analogique en %",
                                it: "sensore di umidità del suolo analogico in %",
                                es: "sensor de humedad del suelo analógico en %",
                                pl: "analogowy czujnik wilgotności gleby w %",
                                uk: "аналоговый датчик влажности почвы в %",
                                'zh-cn': "模拟土壤湿度传感器（%）"
                            },
                            type: 'number',
                            min: 0,
                            max: 150,
                            unit: '%',
                            read: true,
                            write: false,
                            def: 50
                        },
                        native: {},
                    }
                };
            }
            case 'fixDay': {
                return {
                    nameMetConSM: `${objectName} => start on a fixed day`,
                    objMetConSM: {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${objectName} => start on a fixed day`,
                            desc:  {
                                en: "start on a fixed day",
                                de: "Start an einem festgelegten Tag", 
                                ru: "Начало в назначенный день.", 
                                pt: "Iniciar em um dia fixo", 
                                nl: "Start op een vaste dag.", 
                                fr: "Démarrer à une date fixe !", 
                                it: "Inizia in un giorno fisso", 
                                es: "¡Comienza en un día fijo!", 
                                pl: "Start w ustalonym dniu", 
                                uk: "початок у визначений день", 
                                'zh-cn': "从固定日期开始"
                            },
                            type:  'number',
                            min: 0,
                            max: 7,
                            states: {0:'Sun', 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thur', 5:'Fri', 6:'Sat', 7:'off'},
                            read:  true,
                            write: false,
                            def: 7
                        },
                        native: {},
                    }
                };
            }
            default: {
                adapter.log.warn(`sprinkleControl cannot created ... Please select an irrigation type in the configuration. ${objectName}`);
                return {
                    nameMetConSM: `${objectName} => Emergency program! start on a fixed day`,
                    objMetConSM: {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${objectName} => Emergency program! start on a fixed day`,
                            desc:  {
                                en: "Emergency program! start on a fixed day",
                                de: "Notfallprogramm! Start an einem festgelegten Tag",
                                ru: "Экстренная программа! Начало в назначенный день.",
                                pt: "Programa de emergência! Início em dia fixo",
                                nl: "Noodprogramma! Start op een vaste dag.",
                                fr: "Programme d'urgence ! Début à une date fixe",
                                it: "Programma di emergenza! Inizia in un giorno fisso",
                                es: "¡Programa de emergencia! Comienza en un día fijo",
                                pl: "Program awaryjny! Start w ustalonym dniu",
                                uk: "Екстрена програма! початок у визначений день",
                                'zh-cn': "紧急预案！从固定日期开始"
                            },
                            type:  'number',
                            min: 0,
                            max: 7,
                            states: {0:'Sun', 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thur', 5:'Fri', 6:'Sat', 7:'off'},
                            read:  true,
                            write: false,
                            def: 7
                        },
                        native: {},
                    }
                };
            }
        }
    };


    const result = adapter.config.events;
    if (result) {
        for(const res of result) {
            try {
                if (res.enabled !== true) {
                    continue;
                }
                /*     Name des Bewässerungskreises     */
                const objectName = (res.sprinkleName !== '') ? res.sprinkleName.replace(/[.;, ]/g, '_') : res.name.replace(/[.;, ]/g, '_');
                const objPfad = `sprinkle.${ objectName }`;
                const j = myConfig.config.findIndex((d) => d.objectName === objectName);
                if (objectName && objectName !== ''){
                    // Create bzw. update .actualSoilMoisture
                    const _fillMetConSM = await fillMetConSM(res.methodControlSM, objectName);

                    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
                    // +++++                                     Objekte  erstellen                                     +++++ //
                    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //

                    // Create Object for sprinkle. (ID)
                    await adapter.setObjectNotExistsAsync(`sprinkle.${ objectName }`, {
                        type: 'channel',
                        common: {
                            name: res.sprinkleName,
                            statusStates: {
                                onlineId: `valveOn`
                            },
                            native: {},
                        }
                    });
                    // Create Object for .history
                    await adapter.setObjectNotExistsAsync(`sprinkle.${ objectName }.history`, {
                        type: 'channel',
                        common: {
                            name: `${ res.sprinkleName } => History`
                        },
                        native: {},
                    });
                    
                    // Create Object for .history.curCalWeekConsumed
                    // Sprinkler consumption of the current calendar week => History - Sprinkler-Verbrauch der aktuellen Kalenderwoche (783 Liter)
                    const _curCalWeekConsumedNotExist = adapter.setObjectNotExistsAsync(`${ objPfad }.history.curCalWeekConsumed`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => History - Sprinkler consumption of the current calendar week`,
                            desc:  {
                                en: "Sprinkler consumption of the current calendar week",
                                de: "Sprinkler-Verbrauch der aktuellen Kalenderwoche",
                                ru: "Расход полива текущей календарной недели",
                                pt: "Consumo de aspersão da semana calendárica atual",
                                nl: "Verbruik van spuiting van de huidige kalenderweek",
                                fr: "Consommation d'arrosage de la semaine calendrier actuelle",
                                it: "Consumo di irrigazione della settimana calendario corrente",
                                es: "Consumo de riego de la semana calendario actual",
                                pl: "Zużycie nawadniania w bieżącym tygodniu kalendarzowym",
                                uk: "Витрата поливу поточної календарної тижня",
                                'zh-cn': "当前日历周的喷灌消耗量"
                            },
                            type:  'number',
                            unit:  'Liter',
                            read:  true,
                            write: false,
                            def:   0
                        },
                        native: {},
                    });
                    // Create Object for .history.curCalWeekRunningTime
                    // Sprinkler running time of the current calendar week => History - Sprinkler-Laufzeit der aktuellen Kalenderwoche (783 Liter)
                    const _curCalWeekRunningTimeNotExist = adapter.setObjectNotExistsAsync(`${ objPfad }.history.curCalWeekRunningTime`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => History - Sprinkler running time of the current calendar week`,
                            desc:  {
                                en: "Sprinkler running time of the current calendar week",
                                de: "Sprinkler-Laufzeit der aktuellen Kalenderwoche",
                                ru: "Время работы спринклера текущей календарной недели",
                                pt: "Tempo de execução do aspersor da semana calendárica atual",
                                nl: "Draaitijd van de sprinkler van de huidige kalenderweek",
                                fr: "Temps de fonctionnement de l'arroseur de la semaine calendrier actuelle",
                                it: "Tempo di funzionamento dell'irrigatore della settimana calendario corrente",
                                es: "Tiempo de funcionamiento del aspersor de la semana calendario actual",
                                pl: "Czas pracy zraszacza w bieżącym tygodniu kalendarzowym",
                                uk: "Время работы спринклера текущей календарной недели",
                                'zh-cn': "当前日历周的喷灌运行时间"
                            },
                            type:  'string',
                            read:  true,
                            write: false,
                            def:   '00:00'
                        },
                        native: {},
                    });
                    // Create Object for .history.lastCalWeekConsumed
                    // Sprinkler consumption of the last calendar week => History - Sprinkler-Verbrauch der letzten Kalenderwoche (783 Liter)
                    const _lastCalWeekConsumedNotExist = adapter.setObjectNotExistsAsync(`${ objPfad }.history.lastCalWeekConsumed`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => History - Sprinkler consumption of the last calendar week`,
                            desc:  {
                                en: "Sprinkler consumption of the last calendar week",
                                de: "Sprinkler-Verbrauch der letzten Kalenderwoche",
                                ru: "Расход полива последней календарной недели",
                                pt: "Consumo de aspersão da última semana calendárica",
                                nl: "Verbruik van spuiting van de laatste kalenderweek",
                                fr: "Consommation d'arrosage de la dernière semaine calendrier",
                                it: "Consumo di irrigazione dell'ultima settimana calendario",
                                es: "Consumo de riego de la última semana calendario",
                                pl: "Zużycie nawadniania w ostatnim tygodniu kalendarzowym",
                                uk: "Витрата поливу последней календарной недели",
                                'zh-cn': "上一个日历周的喷灌消耗量"
                            },
                            type:  'number',
                            unit:  'Liter',
                            read:  true,
                            write: false,
                            def:   0
                        },
                        native: {},
                    });
                    // Create Object for .history.lastCalWeekRunningTime
                    // Sprinkler running time of the last calendar week => History - Sprinkler-Laufzeit der letzten Kalenderwoche (783 Liter)
                    const _lastCalWeekRunningTimeNotExist = adapter.setObjectNotExistsAsync(`${ objPfad }.history.lastCalWeekRunningTime`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => History - Sprinkler running time of the last calendar week`,
                            desc:  {
                                en: "Sprinkler running time of the last calendar week",
                                de: "Sprinkler-Laufzeit der letzten Kalenderwoche",
                                ru: "Время работы спринклера последней календарной недели",
                                pt: "Tempo de execução do aspersor da última semana calendárica",
                                nl: "Draaitijd van de sprinkler van de laatste kalenderweek",
                                fr: "Temps de fonctionnement de l'arroseur de la dernière semaine calendrier",
                                it: "Tempo di funzionamento dell'irrigatore dell'ultima settimana calendario",
                                es: "Tiempo de funcionamiento del aspersor de la última semana calendario",
                                pl: "Czas pracy zraszacza w ostatnim tygodniu kalendarzowym",
                                uk: "Время работы спринклера последней календарной недели",
                                'zh-cn': "上一个日历周的喷灌运行时间"
                            },
                            type:  'string',
                            read:  true,
                            write: false,
                            def:   '00:00'
                        },
                        native: {},
                    });
                    // Create Object for .history.lastConsumed
                    // Last consumed of sprinkler => History - Letzte Verbrauchsmenge des Ventils (783 Liter)
                    const _lastConsumedNotExist = adapter.setObjectNotExistsAsync(`${ objPfad }.history.lastConsumed`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => History - Last consumed of sprinkler`,
                            desc:  {
                                en: "Last consumed of sprinkler",
                                de: "Letzte Verbrauchsmenge des Ventils",
                                ru: "Последнее потребление спринклера",
                                pt: "Último consumo do aspersor",
                                nl: "Laatste verbruik van de sprinkler",
                                fr: "Dernier consommé de l'arroseur",
                                it: "Ultimo consumo dell'irrigatore",
                                es: "Último consumo del aspersor",
                                pl: "Ostatnie zużycie zraszacza",
                                uk: "Останній витрата спринклера",
                                'zh-cn': "喷灌器的最后消耗量"
                            },
                            type:  'number',
                            unit:  'Liter',
                            read:  true,
                            write: false,
                            def:   0
                        },
                        native: {},
                    });
                    // Create Object for .history.lastOn
                    // Last On of sprinkler => History - Letzter Start des Ventils (30.03 06:30)
                    const _lastOnNotExist = adapter.setObjectNotExistsAsync(`${ objPfad }.history.lastOn`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => History - Last On of sprinkler`,
                            desc:  {
                                en: "Last On of sprinkler",
                                de: "Letzter Start des Ventils",
                                ru: "Последний запуск спринклера",
                                pt: "Última Ativação do aspersor",
                                nl: "Laatste start van de sprinkler",
                                fr: "Dernier démarrage de l'arroseur",
                                it: "Ultimo avvio dell'irrigatore",
                                es: "Último encendido del aspersor",
                                pl: "Ostatnie włączenie zraszacza",
                                uk: "Останній запуск спринклера",
                                'zh-cn': "喷灌器的最后启动时间"
                            },
                            type:  'string',
                            read:  true,
                            write: false,
                            def:   '-'
                        },
                        native: {},
                    });
                    // Create Object for .history.lastRunningTime
                    // Last running time of sprinkler => History - Letzte Laufzeit des Ventils (0 sek, 47:00 min, 1:03:45 )
                    const _lastRunningTimeNotExist = adapter.setObjectNotExistsAsync(`${ objPfad }.history.lastRunningTime`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => History - Last running time`,
                            desc:  {
                                en: "Last running time of sprinkler",
                                de: "Letzte Laufzeit des Ventils",
                                ru: "Последнее время работы спринклера",
                                pt: "Último tempo de funcionamento do aspersor",
                                nl: "Laatste draaitijd van de sprinkler",
                                fr: "Dernier temps de fonctionnement de l'arroseur",
                                it: "Ultimo tempo di funzionamento dell'irrigatore",
                                es: "Último tiempo de funcionamiento del aspersor",
                                pl: "Ostatni czas pracy zraszacza",
                                uk: "Останній час роботи спринклера",
                                'zh-cn': "喷灌器的最后运行时间"
                            },
                            type:  'string',
                            read:  true,
                            write: false,
                            def:   '00:00'
                        },
                        native: {},
                    });
                    // Create Object for .autoOn
                    const _autoOnNotExist = adapter.setObjectNotExistsAsync(`${ objPfad }.autoOn`, {
                        type: 'state',
                        common: {
                            role:  'Switch',
                            name:  `${ objectName } => Switch automatic mode on / off`,
                            desc:  {
                                en: "Switch automatic mode on / off",
                                de: "Automatikmodus ein / aus schalten",
                                ru: "Включить / отключить автоматический режим",
                                pt: "Alternar modo automático ligado / desligado",
                                nl: "Automatische modus aan / uit schakelen",
                                fr: "Basculer le mode automatique activé / désactivé",
                                it: "Attiva/disattiva modalità automatica",
                                es: "Cambiar modo automático encendido / apagado",
                                pl: "Przełącz tryb automatyczny włączony / wyłączony",
                                uk: "Увімкнути / вимкнути автоматичний режим",
                                'zh-cn': "切换自动模式开启/关闭"
                            },
                            type:  'boolean',
                            states: {
                                false: 'off',
                                true: 'on'
                            },
                            read:  true,
                            write: true,
                            def:   true
                        },
                        native: {},
                    }).catch((e) => adapter.log.warn(`setObjectNotExistsAsync ${objectName}.autoOn ${e}`));
                    // Create Object for .break
                    const _extBreakNotExist = adapter.setObjectNotExistsAsync(`${ objPfad }.extBreak`, {
                        type: 'state',
                        common: {
                            role:  'Switch',
                            name:  `${ objectName } => Switch extBreak mode on / off`,
                            desc:  {
                                en: "Switch external break mode on / off",
                                de: "Externer Brechmodus ein / aus schalten",
                                ru: "Включить / отключить внешний режим прерывания",
                                pt: "Alternar modo de interrupção externa ligado / desligado",
                                nl: "Externe onderbrekingsmodus aan / uit schakelen",
                                fr: "Basculer le mode de coupure externe activé / désactivé",
                                it: "Attiva/disattiva modalità di interruzione esterna",
                                es: "Cambiar modo de interrupción externa encendido / apagado",
                                pl: "Przełącz tryb zewnętrznego przerwania włączony / wyłączony",
                                uk: "Увімкнути / вимкнути зовнішній режим переривання",
                                'zh-cn': "切换外部中断模式开启/关闭"
                            },
                            type:  'boolean',
                            states: {
                                false: 'off',
                                true: 'on'
                            },
                            read:  true,
                            write: true,
                            def:   false
                        },
                        native: {},
                    }).catch((e) => adapter.log.warn(`setObjectNotExistsAsync ${objectName}.extBreak ${e}`));
                    // Create Object for .actualSoilMoisture
                    const _actualSoilMoistureFind = await adapter.findForeignObjectAsync(`${ adapter.namespace }.${ objPfad }.actualSoilMoisture`, `${ _fillMetConSM.objMetConSM.common.type }`);
                    if (_fillMetConSM && _actualSoilMoistureFind
                        && _actualSoilMoistureFind.id !== `${ adapter.namespace }.${ objPfad }.actualSoilMoisture`
                        || _actualSoilMoistureFind.name !== _fillMetConSM.nameMetConSM) {
                        await adapter.setObjectAsync(
                            `${ objPfad }.actualSoilMoisture`,
                            //@ts-ignore
                            _fillMetConSM.objMetConSM
                        ).catch((e) => adapter.log.warn(`.actualSoilMoisture: ${e}`));
                        if (_fillMetConSM.objMetConSM.common.def) {
                            await adapter.setStateAsync(`${ objPfad }.actualSoilMoisture`, {
                                val: _fillMetConSM.objMetConSM.common.def,
                                ack: true
                            }).catch((e) => adapter.log.warn(`.actualSoilMoisture: ${e}`));
                        }
                        adapter.log.info(`sprinkleControl [sprinkle.${objectName}.actualSoilMoisture] was updated`);
                    }

                    // postponeByOneDay → um einen Tag verschieben bei fixDay (twoNd & threeRd)
                    const _postponeByOneDay = await adapter.findForeignObjectAsync(`${adapter.namespace}.${objPfad}.postponeByOneDay`, `boolean`);
                    if (_postponeByOneDay.id !== `${adapter.namespace}.${objPfad}.postponeByOneDay`
                        && res.methodControlSM === 'fixDay'
                        && (res.startDay === 'twoNd'
                        || res.startDay === 'threeRd')) {
                        await adapter.setObjectNotExistsAsync(`${ objPfad }.postponeByOneDay`, {
                            type: 'state',
                            common: {
                                role: 'button',
                                name: `${ objectName }Postpone start by one day`,
                                desc:  {
                                    en: "Postpone start by one day",
                                    de: "Start um einen Tag verschieben",
                                    ru: "Отложить запуск на один день",
                                    pt: "Adiar o início por um dia",
                                    nl: "Start met een dag vertraging",
                                    fr: "Reporter le démarrage d'un jour",
                                    it: "Ritarda l'avvio di un giorno",
                                    es: "Retrasar el inicio por un día",
                                    pl: "Opóźnij start o jeden dzień",
                                    uk: "Відкласти запуск на один день",
                                    'zh-cn': "推迟一天开始"
                                },
                                type: 'boolean',
                                read: true,
                                write: true,
                                def: false
                            },
                            native: {
                                UNIT: '',
                                TAB_ORDER: 0,
                                OPERATIONS: 6,
                                FLAGS: 1,
                                TYPE: 'ACTION',
                                MIN: false,
                                MAX: true,
                                DEFAULT: false
                            }
                        });
                        adapter.subscribeStates(`${adapter.namespace}.${objPfad}.postponeByOneDay`);
                    } else if (res.methodControlSM === 'fixDay'
                        && (res.startDay === 'twoNd'
                        || res.startDay === 'threeRd')) {
                        adapter.subscribeStates(`${adapter.namespace}.${objPfad}.postponeByOneDay`);
                    } else {
                        await adapter.delObjectAsync(`${adapter.namespace}.${objPfad}.postponeByOneDay`);                  // "sprinklecontrol.0.sprinkle.???.actualSoilMoisture"
                    }

                    // Create Object for .countdown => Countdown des Ventils
                    const _countdownNotExist = await adapter.setObjectNotExistsAsync(`${ objPfad }.countdown`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => countdown of sprinkler`,
                            desc:  {
                                en: "Countdown of sprinkler",
                                de: "Countdown des Ventils",
                                ru: "Отсчет времени до запуска",
                                pt: "Contagem regressiva do aspersor",
                                nl: "Aftellen van sprinkler",
                                fr: "Compte à rebours du pulvérisateur",
                                it: "Conto alla rovescia dell'aspersore",
                                es: "Cuenta regresiva del rociador",
                                pl: "Odliczanie czasu do włączenia",
                                uk: "Зворотній відлік до запуску",
                                'zh-cn': "喷头倒计时"
                            },
                            type:  'string',
                            read:  true,
                            write: false,
                            def:   '-'
                        },
                        native: {},
                    });
                    // Create Object for .runningTime => Laufzeit des Ventils
                    const _runningTimeNotExist = await adapter.setObjectNotExistsAsync(`${ objPfad }.runningTime`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => running time of sprinkler`,
                            desc:  {
                                en: "Running time of sprinkler",
                                de: "Laufzeit des Ventils",
                                ru: "Время работы спринклера",
                                pt: "Tempo de funcionamento do aspersor",
                                nl: "Draaitijd van de sprinkler",
                                fr: "Temps de fonctionnement de l'arroseur",
                                it: "Tempo di funzionamento dell'irrigatore",
                                es: "Tiempo de funcionamiento del aspersor",
                                pl: "Czas pracy zraszacza",
                                uk: "Время работы спринклера",
                                'zh-cn': "喷头运行时间"
                            },
                            type:  'string',
                            read:  true,
                            write: true,
                            def:   '-'
                        },
                        native: {},
                    });
                    // Create Object for .sprinklerState => Zustand des Ventils im Thread
                    // <<< 1  = warten >>> (0:off; 1:wait; 2:on; 3:break; 4:Boost(on); 5:off(Boost); 6:Cistern empty; 7:extBreak)
                    // Create .sprinklerState
                    const _sprinklerStateNotExists = await adapter.setObjectNotExistsAsync(`${ objPfad }.sprinklerState`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => actual state of sprinkler`,
                            desc:  {
                                en: "Actual state of sprinkler",
                                de: "Aktueller Zustand des Ventils",
                                ru: "Текущее состояние спринклера",
                                pt: "Estado atual do aspersor",
                                nl: "Huidige staat van de sprinkler",
                                fr: "État actuel du pulvérisateur",
                                it: "Stato attuale dell'aspersore",
                                es: "Estado actual del rociador",
                                pl: "Aktualny stan zraszacza",
                                uk: "Поточний стан спринклера",
                                'zh-cn': "喷头当前状态"
                            },
                            type:  'string',
                            read:  true,
                            write: false,
                            def:   'off'
                        },
                        native: {},
                    });
                    // Create Object for .valveOn => Zustand des Ventils (on/off)
                    const _valveOnNotExist = await adapter.setObjectNotExistsAsync(`${ objPfad }.valveOn`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => actual valve state on/off`,
                            desc:  {
                                en: "Actual valve state on/off",
                                de: "Aktueller Ventilzustand an/aus",
                                ru: "Текущее состояние клапана вкл/выкл",
                                pt: "Estado atual da válvula ligado/desligado",
                                nl: "Huidige staat van de klep aan/uit",
                                fr: "État actuel de la vanne ouverte/fermée",
                                it: "Stato attuale della valvola acceso/spento",
                                es: "Estado actual de la válvula encendida/apagada",
                                pl: "Aktualny stan zaworu włączony/wyłączony",
                                uk: "Поточний стан клапана увімкнено/вимкнено",
                                'zh-cn': "阀门当前开/关状态"
                            },
                            type:  'boolean',
                            read:  true,
                            write: false,
                            def:   false
                        },
                        native: {},
                    });

                    // Create Object for triggerPoint → Schaltpunkt der Bodenfeuchte
                    const _triggerPointNotExist = await adapter.setObjectNotExistsAsync(`${ objPfad }.triggerPoint`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${ objectName } => Trigger point of sprinkler`,
                            desc:  {
                                en: "Trigger point of sprinkler",
                                de: "Schaltpunkt des Ventils",
                                ru: "Точка срабатывания спринклера",
                                pt: "Ponto de acionamento do aspersor",
                                nl: "Triggerpunt van de sprinkler",
                                fr: "Point déclenchement du pulvérisateur",
                                it: "Punto di attivazione dell'aspersore",
                                es: "Punto de activación del rociador",
                                pl: "Punkt wyzwalania zraszacza",
                                uk: "Точка срабатывания спринклера",
                                'zh-cn': "喷头触发点"
                            },
                            type:  'string',
                            read:  true,
                            write: false,
                            def:   '-'
                        },
                        native: {},
                    });
                    // Object created
                    await Promise.all([
                        _curCalWeekConsumedNotExist,
                        _curCalWeekRunningTimeNotExist,
                        _lastCalWeekConsumedNotExist,
                        _lastCalWeekRunningTimeNotExist,
                        _lastConsumedNotExist,
                        _lastOnNotExist,
                        _lastRunningTimeNotExist,
                        _autoOnNotExist,
                        _extBreakNotExist,
                        _countdownNotExist,
                        _runningTimeNotExist,
                        _sprinklerStateNotExists,
                        _valveOnNotExist,
                        _triggerPointNotExist
                    ]);

                    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
                    // +++++                        zustände der States auf Startposition                       +++++ //
                    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
                    //
                    adapter.log.debug(`_countdownNotExist: ${_countdownNotExist}`);
                    if(_countdownNotExist == undefined){
                        const _countdown = await adapter.getStateAsync(`${objPfad}.countdown`).catch((e) => adapter.log.warn(`${objectName}.countdown ${e}`));
                        if (_countdown?.val !== '0') {
                            adapter.setStateAsync(`${objPfad}.countdown`, {
                                val: '0',
                                ack: true
                            }).catch((e) => adapter.log.warn(e));
                        }
                    }
                    //
                    if (_runningTimeNotExist == undefined) {
                        const _runningTime = await adapter.getStateAsync(`${objPfad}.runningTime`).catch((e) => adapter.log.warn(`${objectName}.runningTime ${e}`));
                        if (_runningTime?.val !== '00:00') {
                            adapter.setStateAsync(`${objPfad}.runningTime`, {
                                val: '00:00',
                                ack: true
                            }).catch((e) => adapter.log.warn(e));
                        }
                    }
                    //
                    if (_sprinklerStateNotExists == undefined){
                        const _sprinklerState = await adapter.getStateAsync(`${objPfad}.sprinklerState`).catch((e) => adapter.log.warn(`${objectName}.sprinklerState ${e}`));
                        if (_sprinklerState?.val !== 'off') {
                            await adapter.setStateAsync(`${objPfad}.sprinklerState`, {
                                val: 'off', 
                                ack: true
                                }).catch((e) => adapter.log.warn(`${objectName}.sprinklerState ${e}`));
                        }
                    }
                    // Festlegen des Schaltpunktes für den nächsten Start
                    switch (myConfig.config[j].methodControlSM) {
                        case 'bistable': {
                            // Sensor soil moisture => Sensor Bodenfeuchte
                            const _triggerSMBistabile = await adapter.getForeignStateAsync(myConfig.config[j].triggerSM).catch((e) => adapter.log.warn(`${objectName}.triggerSMBistabile ${e}`));
                            if (_triggerSMBistabile && typeof _triggerSMBistabile.val === 'boolean') {
                                myConfig.setSoilMoistBool(myConfig.config[j].sprinkleID, _triggerSMBistabile.val);
                            } else {
                                myConfig.setSoilMoistBool(myConfig.config[j].sprinkleID, true);
                                adapter.log.warn(`The bistable sensor ${myConfig.config[j].triggerSM} in ${objectName} does not deliver correct values!`);
                            }

                            adapter.setStateAsync(`${ objPfad }.triggerPoint`, {
                                val: '-',
                                ack: true                                
                            }).catch((e) => adapter.log.warn(`${objectName}.triggerPoint ${e}`));
                            break;
                        }
                        case 'analog': {
                            // Sensor soil moisture => Sensor Bodenfeuchte
                            const _triggerSMAnalog = await adapter.getForeignStateAsync(myConfig.config[j].triggerSM).catch((e) => adapter.log.warn(`${objectName}.triggerSMAnalog ${e}`));
                            if (_triggerSMAnalog && (typeof _triggerSMAnalog.val === 'number' || typeof _triggerSMAnalog.val === 'string')) {
                                myConfig.setSoilMoistPct(myConfig.config[j].sprinkleID, _triggerSMAnalog.val);
                            } else {
                                await adapter.setStateAsync(`${ objPfad }.actualSoilMoisture`, {
                                    val: 50,
                                    ack: true
                                });
                                adapter.log.warn(`The analoge sensor ${myConfig.config[j].triggerSM} in ${objectName} does not deliver correct values!`);
                            }
                            adapter.setStateAsync(`${ objPfad }.triggerPoint`, {
                                val: `${myConfig.config[j].analog.pctTriggerIrrigation}`,
                                ack: true
                            }).catch((e) => adapter.log.warn(`${objectName}.triggerPoint setState ${e}`));
                            break;
                        }
                        case 'fixDay': {

                            if (myConfig.config[j].fixDay.startDay === 'threeRd') {
                                await setNewDay(j, true);
                            } else if (myConfig.config[j].fixDay.startDay === 'twoNd') {
                                await setNewDay(j, false);
                            } else if (myConfig.config[j].fixDay.startDay === 'fixDay') {
                                curNextFixDay(myConfig.config[j].sprinkleID, false);
                            }

                            adapter.setStateAsync(`${ objPfad }.triggerPoint`, {
                                val: '-',
                                ack: true
                            }).catch((e) => adapter.log.warn(`${objectName}.triggerPoint fixDay setState ${e}`));
                            break;
                        }
                        case 'calculation': {

                            const _actualSoilMoisture = await adapter.getStateAsync(`${ objPfad }.actualSoilMoisture`).catch((e) => adapter.log.warn(e));
                            if (_actualSoilMoisture && _actualSoilMoisture.val) {
                                if (typeof _actualSoilMoisture.val === 'number' && _actualSoilMoisture.val !== 0) {
                                    // num Wert der Bodenfeuchte berechnen und in der config speichern, wenn Wert zwischen 0 und max liegt
                                    if ((0 < _actualSoilMoisture.val) && (_actualSoilMoisture.val <= (myConfig.config[j]).calculation.maxRain*100/myConfig.config[j].calculation.maxIrrigation)) {
                                        myConfig.config[j].calculation.val = _actualSoilMoisture.val * myConfig.config[j].calculation.maxIrrigation / 100;
                                        myConfig.config[j].calculation.pct = _actualSoilMoisture.val;
                                    } else {
                                        // Wert aus config übernehmen
                                        adapter.setStateAsync(`${objPfad}.actualSoilMoisture`, {
                                            val: myConfig.config[j].calculation.pct,
                                            ack: true
                                        }).catch((e) => adapter.log.warn(e));
                                    }
                                } else {
                                    adapter.setStateAsync(`${ objPfad }.actualSoilMoisture`, {
                                        val: myConfig.config[j].calculation.pct,
                                        ack: true
                                    }).catch((e) => adapter.log.warn(e));
                                }
                            }

                            adapter.setStateAsync(`${ objPfad }.triggerPoint`, {
                                val: `${myConfig.config[j].calculation.pctTriggerIrrigation}`,
                                ack: true
                            }).catch((e) => adapter.log.warn(e));
                            break;
                        }
                    }
                } else {
                    adapter.log.warn('sprinkleControl cannot created ... Please check in your config the sprinkle Name');
                }
            } catch (e) {
                adapter.log.warn(`sprinkleControl cannot created. Please check your sprinkleControl config: ${JSON.stringify(e)}, ${e}`);
            }
        }
        await delOldSprinklers(result);
    }
}

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
// +++++                                        Objekte löschen                                         +++++ //
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
async function delOldSprinklers(result) {

    for(const i in ObjSprinkle) {

        const resID = ObjSprinkle[i]._id;
        const objectID = resID.split('.');
        const resultID = objectID[3];

        const resultName = result.map(({ sprinkleName }) => ({ sprinkleName }));
        const fullRes = [];

        for(const i in resultName) {
            // eslint-disable-next-line no-prototype-builtins
            if (resultName.hasOwnProperty(i)) {
                const res = resultName[i].sprinkleName.replace(/[.;, ]/g, '_');
                fullRes.push(res);
            }
        }

        if (fullRes.indexOf(resultID) === -1) {
            try {
                // object deleted
                /**
                 * del when exist Object Async
                 *
                 * @param id - the id of the object
                 * @param type - common.type of the state
                 * @returns {Promise<void>}
                 */
                const delWhenExistObjectAsync = async (id, type) => {
                    const _find = await adapter.findForeignObjectAsync(`${id}`, `${type}`);
                    if (_find && _find.id === `${id}`) {
                        await adapter.delObjectAsync(`${id}`).catch((e) => adapter.log.warn(e));  // "sprinklecontrol.0.sprinkle.???.postponeByOneDay"
                    }
                };

                await Promise.all([
                    adapter.delObjectAsync(`${resID}.history.curCalWeekConsumed`),          //  "sprinklecontrol.0.sprinkle.???.history.curCalWeekConsumed"
                    adapter.delObjectAsync(`${resID}.history.curCalWeekRunningTime`),       //  "sprinklecontrol.0.sprinkle.???.history.curCalWeekRunningTime"
                    adapter.delObjectAsync(`${resID}.history.lastCalWeekConsumed`),         //  "sprinklecontrol.0.sprinkle.???.history.lastCalWeekConsumed"
                    adapter.delObjectAsync(`${resID}.history.lastCalWeekRunningTime`),      //  "sprinklecontrol.0.sprinkle.???.history.lastCalWeekRunningTime"
                    adapter.delObjectAsync(`${resID}.history.lastConsumed`),                //  "sprinklecontrol.0.sprinkle.???.history.lastConsumed"
                    adapter.delObjectAsync(`${resID}.history.lastOn`),                      //  "sprinklecontrol.0.sprinkle.???.history.lastOn"
                    adapter.delObjectAsync(`${resID}.history.lastRunningTime`),             //  "sprinklecontrol.0.sprinkle.???.history.lastRunningTime"
                    adapter.delObjectAsync(`${resID}.actualSoilMoisture`),                  // "sprinklecontrol.0.sprinkle.???.actualSoilMoisture"
                    adapter.delObjectAsync(`${resID}.autoOn`),                              // "sprinklecontrol.0.sprinkle.???.autoOn"
                    adapter.delObjectAsync(`${resID}.countdown`),                           // "sprinklecontrol.0.sprinkle.???.countdown"
                    adapter.delObjectAsync(`${resID}.extBreak`),                            // "sprinklecontrol.0.sprinkle.???.break"
                    adapter.delObjectAsync(`${resID}.runningTime`),                         // "sprinklecontrol.0.sprinkle.???.runningTime"
                    adapter.delObjectAsync(`${resID}.sprinklerState`),                      // "sprinklecontrol.0.sprinkle.???.sprinklerState"
                    adapter.delObjectAsync(`${resID}.triggerPoint`),                        // "sprinklecontrol.0.sprinkle.???.triggerPoint"
                    adapter.delObjectAsync(`${resID}.valveOn`),                             // "sprinklecontrol.0.sprinkle.???.valveOn"
                    delWhenExistObjectAsync(`${resID}.postponeByOneDay`, `boolean`),        // "sprinklecontrol.0.sprinkle.???.postponeByOneDay" wenn vorhanden löschen
                ]);//.then(async ()=>{
                // History - Objekt(Ordner.history) löschen
                await adapter.delObjectAsync(`${ resID }.history`);
                //}).then(async ()=>{
                // Objekt(Ordner) löschen
                await adapter.delObjectAsync(resID);
                //}).then(()=>{
                adapter.log.info(`sprinkleControl [${resID}] was deleted`);
                //});
            } catch (e) {
                adapter.log.warn(`sprinkle cannot deleted: ${e}`);
            }
        }
    }
}



async function main() {
    /* The adapters' config (in the instance object everything under the attribute "native") is accessible via
    * adapter.config:
	* => Auf die Adapterkonfiguration (im Instanz objekt alles unter dem Attribut "native") kann zugegriffen werden über
	adapter.config:
	*/
    adapter.log.debug(`adapter.config.events: ${JSON.stringify(adapter.config.events)}`);
    /**
     * The adapters' config (in the instance object everything under the attribute "native") is accessible via adapter.config:
     * => Auf die Adapterkonfiguration (im Instanz objekt alles unter dem Attribut "native") kann zugegriffen werden über adapter.config:
     *
     * @param {any} err
     * @param {any} obj
     */
    // @ts-ignore
    // @ts-ignore
    adapter.getForeignObject('system.config', (err, obj) => {
        if (obj) {
            checkStates();
        }
    });

    await myConfig.createConfig(adapter).catch((e) => adapter.log.warn(e));
    await createSprinklers().catch((e) => adapter.log.warn(e));
    await GetSystemData().catch((e) => adapter.log.warn(e));
    await sendMessageText.initConfigMessage(adapter);
    await evaporation.initEvaporation(adapter);        // init evaporation
    await valveControl.initValveControl(adapter).catch((e) => adapter.log.warn(e));
    sunPos();

    /*
    * in this template all states changes inside the adapters namespace are subscribed
	* => In dieser Vorlage werden alle Statusänderungen im Namensraum des Adapters abonniert
	* adapter.subscribeStates('*');
	*/
    await adapter.subscribeStatesAsync('control.autoOnOff');
    await adapter.subscribeStatesAsync('control.autoStart');
    await adapter.subscribeStatesAsync('control.Holiday');
    //adapter.subscribeStates('info.Elevation');
    //adapter.subscribeStates('info.Azimut');
    
    if (adapter.config.weatherForecastService === 'ownDataPoint') {
        weatherForecastTodayPfadStr = adapter.config.pathRainForecast;
        adapter.subscribeForeignStates(weatherForecastTodayPfadStr);
    } else if (adapter.config.weatherForecastService === 'dasWetter' && (adapter.config.weatherForInstance.length > 10)) {
        weatherForecastTodayPfadStr = `${ adapter.config.weatherForInstance }.location_1.ForecastDaily.Day_1.Rain`;
        adapter.subscribeForeignStates(weatherForecastTodayPfadStr);
        adapter.subscribeForeignStates(`${ adapter.config.weatherForInstance }.location_1.ForecastDaily.Day_2.Rain`);
    }

    // Request a notification from a third-party adapter => Fordern Sie eine Benachrichtigung von einem Drittanbieter-Adapter an
    if (adapter.config.publicHolidays === true && (`${ adapter.config.publicHolInstance }.heute.*`)) {
        adapter.subscribeForeignStates(`${ adapter.config.publicHolInstance }.heute.*`);
    }
    if (adapter.config.publicHolidays === true && (`${ adapter.config.publicHolInstance }.morgen.*`)) {
        adapter.subscribeForeignStates(`${ adapter.config.publicHolInstance }.morgen.*`);
    }

    if (adapter.config.triggerControlVoltage !== '') {
        await adapter.subscribeForeignStatesAsync(adapter.config.triggerControlVoltage);
    }
    switch(adapter.config.pumpSelection) {
        case 'noPump':
            break;
        case 'mainPump':
            await adapter.subscribeForeignStatesAsync(adapter.config.triggerMainPump);
            break;
        case 'cistern':
            await adapter.subscribeForeignStatesAsync(adapter.config.triggerCisternPump);
            break;
        case 'pumpAndCistern':
            await adapter.subscribeForeignStatesAsync(adapter.config.triggerMainPump);
            await adapter.subscribeForeignStatesAsync(adapter.config.triggerCisternPump);
            break;
    }

    if (adapter.config.actualValueLevel !== '') {
        await adapter.subscribeForeignStatesAsync(adapter.config.actualValueLevel);
    } else if ((adapter.config.pumpSelection === 'pumpAndCistern') || (adapter.config.pumpSelection === 'cistern')) {
        await adapter.setStateAsync('info.cisternState', { 
            val: 'The level sensor of the water cistern is not specified', 
            ack: true 
        }).catch((e) => adapter.log.warn(`info.cisternState ${e}`));
    }

    await checkActualStates().catch((e) => adapter.log.warn(`checkActualStates: ${e}`));
    // @ts-ignore
    timer = setTimeout(() => {
        startTimeSprinkle();
        secondStartTimeSprinkle();
        addStartTimeSprinkle();
        if (adapter.config.enableTimeBasedRestriction === true) {
            if(tools.laterThanTime(adapter.config.startOfInterruption) === true){            // Bewässerungsverbot wird heute noch aktiviert
                irrigationRestriction = false
                irrigationRestrictionOn();
                irrigationRestrictionOff();
            } else if (tools.laterThanTime(adapter.config.endOfInterruption) === true){      // Bewässerungsverbot aktiv
                irrigationRestriction = true;
                irrigationRestrictionOff();
                valveControl.timeBasedRestriction(true);
                adapter.log.info(`Time-based irrigation restriction is enabled! (${adapter.config.startOfInterruption} - ${adapter.config.endOfInterruption})`);
            } else {
                irrigationRestriction = false;                                      // Bewässerungsverbot war schon aktiv, wird heute nicht mehr aktiviert
            }
        }
    }, 1000);
}


if (require.main !== module) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}