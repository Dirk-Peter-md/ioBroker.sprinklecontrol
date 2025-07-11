'use strict';

// Load your modules here, e.g.: => // Laden Sie Ihre Module hier, z.B.
// const fs = require("fs");

const utils = require('@iobroker/adapter-core');
const schedule  = require('node-schedule');
const SunCalc = require('suncalc');

const sendMessageText = require('./lib/sendMessageText.js');            // sendMessageText
const valveControl = require('./lib/valveControl.js');                  // Steuerung der einzelnen Ventile
const myConfig = require('./lib/myConfig.js');                          // myConfig → Speichern und abrufen von Konfigurationsdaten der Ventile
const evaporation = require('./lib/evaporation.js');
const addTime = require('./lib/tools.js').addTime;
const formatTime = require('./lib/tools.js').formatTime;
//const trend = require('./lib/tools').trend;

let adapter;
const adapterName = require('./package.json').name.split('.').pop();

let publicHolidayStr = false;           //  Feiertag heute?
let publicHolidayTomorrowStr = false;   //  Feiertag morgen?
let weatherForecastTodayPfadStr = '';   //  Pfad zur Regenvorhersage in mm
let weatherForecastTodayNum = 0;        //  heutige Regenvorhersage in mm
let weatherForecastTomorrowNum = 0;     //  morgige Regenvorhersage in mm
let addStartTimeSwitch = false;         //  Externer Schalter für Zusatzbewässerung
let startTimeStr = '';                  //  06:00
let sunriseStr = '';
let sunsetStr = '';
let goldenHourEnd = '';
let holidayStr = false;                 //  switch => sprinklecontrol.*.control.Holiday | (Holiday == true) => Wochenendprogramm
let autoOnOffStr = true;
let kwStr = '';                         //  akt. KW der Woche
let timer, timerSleep;
let today = 0;                          //  heutige Tag 0:So;1:Mo...6:Sa
/* memo */
let ObjSprinkle = {};


/* +++++++++++++++++++++++++++ Starts the adapter instance ++++++++++++++++++++++++++++++++ */

function startAdapter(options) {

    options = options || {};
    Object.assign(options, { name: adapterName });

    adapter = new utils.Adapter(options);

    // start here!
    adapter.on('ready', () => {
        // init createConfig
        myConfig.createConfig(adapter);
        // Hauptpumpe zur Bewässerung setzen
        valveControl.initValveControl(adapter);
        main(adapter);
    });

    /**
     * +++++++++++++++++++++++++ is called when adapter shuts down +++++++++++++++++++++++++
     *
     * @param {() => void}callback
     */
    adapter.on('unload', (callback) => {
        /* Wird beim Stoppen nicht ausgeführt - Warum?
        if(adapter.config.notificationEnabled){
            sendMessageText.sendMessage('sprinklerControl is shutting down');
            adapter.log.info('sprinklerControl is shutting down');
        }
        */
        try {
            adapter.log.info('cleaned everything up...');
            clearTimeout(timer);
            clearTimeout(timerSleep);
            /*Startzeiten der Timer löschen*/
            schedule.cancelJob('calcPosTimer');
            schedule.cancelJob('sprinkleStartTime');
            schedule.cancelJob('sprinkleAddStartTime');
            /* alle Ventile und Aktoren deaktivieren */
            valveControl.clearEntireList();
            callback();
        } catch (err) {
            callback(err);
        }
    });

    /**
     * ++++++++++++++++++ Answers when getTelegramUser calls from index_m ++++++++++++++++++
     * -------------- Antwortet bei Aufrufen von getTelegramUser von index_m ---------------
     */
    adapter.on ('message', (obj) => {
        if (obj) {
            switch (obj.command) {
                case 'getTelegramUser':
                    adapter.getForeignState(`${adapter.config.telegramInstance  }.communicate.users`, (err, state) => {
                        err && adapter.log.error(err);
                        if (state && state.val) {
                            try {
                                adapter.log.debug(`getTelegramUser: ${state.val}`);
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
    });

    /**
     * ++++++++++++++++++ is called if a subscribed object changes ++++++++++++++++++
     * ---------- wird aufgerufen, wenn sich ein abonniertes Objekt ändert ----------
     */
    adapter.on('objectChange', (id, obj) => {
        if (obj) {
            adapter.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
        } else {
            // The object was deleted
            adapter.log.info(`object ${id} deleted`);
        }
    });

    /**
     * ++++++++++++++++++ is called if a subscribed state changes ++++++++++++++++++
     * --------- wird aufgerufen, wenn sich ein abonnierter Status ändert ----------
     */
    adapter.on('stateChange', (id, state) => {
        // The state was changed → Der Zustand wurde geändert
        adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

        // Signale zum bestätigen (ack = true) - signals for confirmation
        if (state?.ack === false) {
            // wenn (Holiday == true) ist, soll das Wochenendprogramm gefahren werden.
            if (id === `${adapter.namespace}.control.Holiday`) {
                // @ts-ignore
                holidayStr = state.val;
                adapter.setState(id, {
                    val: state.val,
                    ack: true
                });
                startTimeSprinkle();
            }
            // wenn (addStartTimeSwitch == true) wird die zusätzliche Bewässerung aktiviert
            if (id === `${adapter.namespace}.control.addStartTimeSwitch` && typeof state.val === 'boolean') {
                addStartTimeSwitch = state.val;
                adapter.setState(id, {
                    val: state.val,
                    ack: true
                });
            }
            // wenn (autoOnOff == false) so werden alle Sprenger nicht mehr automatisch gestartet.
            if ((id === `${adapter.namespace}.control.autoOnOff`)) {
                autoOnOffStr = state.val;
                adapter.log.info(`startAdapter: control.autoOnOff: ${state.val}`);
                adapter.setState(id, {
                    val: state.val,
                    ack: true
                });
                if (!state.val) {
                    valveControl.clearEntireList();
                }
                startTimeSprinkle();
            }
            // wenn (autoStart == true) so die automatische Bewässerung von Hand gestartet
            if (id === `${adapter.namespace}.control.autoStart`) {
                adapter.setState(id, {
                    val: false,
                    ack: true
                });
                if (state.val === true) {
                    // auto Start;
                    startOfIrrigation();
                }
            }
            // wenn (...sprinkleName.runningTime sich ändert) so wird der aktuelle Sprenger [sprinkleName]
            //    bei == 0 gestoppt, > 1 gestartet
            if (myConfig.config) {
                const found = myConfig.config.find(d => d.objectID === id);
                if (found) {
                    if (id === myConfig.config[found.sprinkleID].objectID) {
                        if (!isNaN(state.val)) {
                            valveControl.addList(
                                [{
                                    auto: false,  // Handbetrieb
                                    sprinkleID: found.sprinkleID,
                                    wateringTime: (state.val <= 0) ? 0 : Math.round(60 * state.val)
                                }]);
                            adapter.setState(id, {
                                val: (state.val <= 0) ? 0 : addTime(Math.round(60 * state.val)),
                                ack: true
                            });
                        }
                    }
                }
            }
            // wenn (...sprinkleName.autoOn == false[off])  so wird der aktuelle Sprenger [sprinkleName]
            //   bei false nicht automatisch gestartet
            if (myConfig.config && (typeof state.val === 'boolean')) {
                const found = myConfig.config.find(d => d.autoOnID === id);
                if (found && id === myConfig.config[found.sprinkleID].autoOnID) {
                    myConfig.config[found.sprinkleID].autoOn = state.val;
                    adapter.setState(id, {     // Bestätigung
                        val: state.val,
                        ack: true
                    });
                    adapter.log.info(`set ${found.objectName}.autoOn = ${state.val}, id: ${id}`);
                    if (state.val === false) {
                        valveControl.addList(
                            [{
                                auto: false,
                                sprinkleID: found.sprinkleID,
                                wateringTime: 0
                            }]
                        );
                    }
                }
            }
            //  postponeByOneDay → um einen Tag verschieben bei fixDay (twoNd & threeRd)
            const idSplit = id.split('.', 5);
            if (idSplit[4] === `postponeByOneDay`) {
                const found = myConfig.config.find(d => d.objectName === idSplit[3]);
                if (found) {
                    myConfig.postponeByOneDay(found.sprinkleID).catch((e) => {
                        adapter.log.warn(`postponeByOneDay: ${e}`);
                    });
                    adapter.setState(id, {
                        val: false,
                        ack: true
                    });
                }
            }
        }
        // Signale ohne Bestätigung - signals without confirmation
        
        // wenn in der config unter methodControlSM!== 'analog' oder 'bistable' eingegeben wurde, dann Bodenfeuchte-Sensor auslesen
        if (myConfig.config) {
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
        // Change in outside temperature → Änderung der Außentemperatur
        if (id === adapter.config.sensorOutsideTemperature) {	/*Temperatur*/
            if (!Number.isNaN(Number.parseFloat(state.val))) {
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
            if (id === `${adapter.config.publicHolInstance  }.heute.boolean`) {
                publicHolidayStr = state.val;
                startTimeSprinkle();
            }
            if (id === `${adapter.config.publicHolInstance  }.morgen.boolean`) {     
                // @ts-ignore
                publicHolidayTomorrowStr = state.val;
                startTimeSprinkle();
            }
        }
        // Wettervorhersage
        if (adapter.config.weatherForecast === true) {
            if (id === weatherForecastTodayPfadStr) {
                if (typeof state.val == 'string') {
                    weatherForecastTodayNum = parseFloat(state.val);
                } else if (typeof state.val == 'number') {
                    weatherForecastTodayNum = state.val;
                } else {
                    weatherForecastTodayNum = 0;
                    adapter.log.info(`StateChange => Wettervorhersage state.val ( ${state.val}; ${typeof state.val} ) kann nicht als Number verarbeitet werden`);
                }
                adapter.setState('info.rainToday', {
                    val: weatherForecastTodayNum,
                    ack: true
                });
            }
            if (id === `${adapter.config.weatherForInstance  }.NextDaysDetailed.Location_1.Day_2.rain_value`) {
                weatherForecastTomorrowNum = parseFloat(state.val);
                adapter.setState('info.rainTomorrow', {
                    val: weatherForecastTomorrowNum,
                    ack: true
                });
            }
        }
        // Füllstand der Zisterne bei Statusänderung
        if (adapter.config.actualValueLevel && (id === adapter.config.actualValueLevel)) {
            valveControl.setFillLevelCistern(parseFloat(state.val) || 0);
            //fillLevelCistern = state.val || 0;
        }
    });
}

// +++++++++++++++++ Get longitude an latitude from system config ++++++++++++++++++++
/**get longitude/latitude from system if not set or not valid
 * do not change if we have already a valid value
 * so we could use different settings compared to system if necessary
 * >>>
 * Längen- / Breitengrad vom System abrufen, falls nicht festgelegt oder ungültig
 * wird nicht geändert, wenn bereits ein gültiger Wert vorhanden ist,
 * daher können wir bei Bedarf andere Einstellungen als das System verwenden
 */
async function GetSystemData() {
    if (typeof adapter.config.longitude === undefined || adapter.config.longitude == null || adapter.config.longitude.length === 0 || isNaN(adapter.config.longitude)
        || typeof adapter.config.latitude === undefined || adapter.config.latitude == null || adapter.config.latitude.length === 0 || isNaN(adapter.config.latitude)) {

        try {
            const obj = await adapter.getForeignObjectAsync('system.config');

            if (obj && obj.common && obj.common.longitude && obj.common.latitude) {
                adapter.config.longitude = obj.common.longitude;
                adapter.config.latitude = obj.common.latitude;

                adapter.log.debug(`longitude: ${adapter.config.longitude} | latitude: ${adapter.config.latitude}`);
            } else {
                adapter.log.error('system settings cannot be called up. Please check the geo data');
            }
        } catch (err) {
            adapter.log.warn('system settings cannot be called up. Please check configuration!');
        }
    }
}


/**
 * Schreiben des nächsten Starts in '.actualSoilMoisture'
 * oder Rückgabe des DayName für den nächsten Start
 *
 * @param sprinkleID - Number of Array[0...]
 * @param returnOn - true = Rückgabe des Wochentags; false = Schreiben in State /.actualSoilMoisture
 * @returns nextStart ['Sun','Mon','Tue','Wed','Thur','Fri','Sat']
 */
function curNextFixDay (sprinkleID, returnOn) {
    const weekDayArray = myConfig.config[sprinkleID].startFixDay;
    const objPfad = `sprinkle.${myConfig.config[sprinkleID].objectName}`;
    const weekday = ['Sun','Mon','Tue','Wed','Thur','Fri','Sat'];
    let found = false;
    let curDay = formatTime(adapter, '', 'day');
    if (startTimeStr <= formatTime(adapter, '', 'hh:mm')) {
        curDay++
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

//
/**
 * Sets the status at start to a defined value
 * → Setzt den Status beim Start auf einen definierten Wert
 */
function checkStates() {
    /**
     * control.Holiday
     *
     * @param {string|null} err
     * @param {ioBroker.State|null|undefined} state
     */
    adapter.getState('control.Holiday', (err, state) => {
        if (state && (state.val == null)) {
            adapter.setState('control.Holiday', {
                val: false, 
                ack: true
            });
        }
    });
    /**
     * control.autoOnOff
     *
     * @param {string|null} err
     * @param {ioBroker.State|null|undefined} state
     */
    adapter.getState('control.autoOnOff', (err, state) => {
        if (state && (typeof state.val === 'boolean')) {
            autoOnOffStr = state.val;
        } else {
            autoOnOffStr = true;
            adapter.setState('control.autoOnOff', {
                val: autoOnOffStr,
                ack: true
            });
        }
    });
    adapter.getState('evaporation.ETpToday', (err, state) => {
        if (state && (state.val == null)) {
            evaporation.setETpTodayNum(0);
            adapter.setState('evaporation.ETpToday', {
                val: 0,
                ack: true
            });
        } else if (state) {
            evaporation.setETpTodayNum(parseFloat(state.val));
        }
    });
    adapter.getState('evaporation.ETpYesterday', (err, state) => {
        if (state && (state.val == null || state.val === false)) {
            adapter.setState('evaporation.ETpYesterday', {
                val: 0,
                ack: true
            });
        }
    });

    // akt. kW ermitteln für history last week
    kwStr = formatTime(adapter, '','kW');
    today = formatTime(adapter,'', 'day');
}

/**
 * aktuelle States checken nach dem Start (2000 ms) wenn alle Sprenger-Kreise angelegt wurden
 */
async function checkActualStates () {

    try {
        /**
         * switch Holiday
         *
         */
        const _holiday = await adapter.getStateAsync('control.Holiday');
        if (_holiday && _holiday.val && typeof _holiday.val === 'boolean') {
            holidayStr = _holiday.val;
        }

        /**
         * switch autoOnOff
         *
         */
        const _autoOnOff = await adapter.getStateAsync('control.autoOnOff');
        if (_autoOnOff && _autoOnOff.val && typeof _autoOnOff.val === 'boolean') {
            autoOnOffStr = _autoOnOff.val;
        }

        if (adapter.config.publicHolidays === true && (adapter.config.publicHolInstance !== 'none' || adapter.config.publicHolInstance !== '')) {
            /**
             * Feiertag Heute
             *
             */
            const _publicHolInstanceHeute = await adapter.getForeignStateAsync(
                `${adapter.config.publicHolInstance  }.heute.boolean`
            ).catch((e) => adapter.log.warn(e));
            if (_publicHolInstanceHeute && _publicHolInstanceHeute.val) {
                publicHolidayStr = _publicHolInstanceHeute.val;
            }
            /**
             * Feiertag MORGEN
             *
             */
            const _publicHolInstanceMorgen = await adapter.getForeignStateAsync(
                `${adapter.config.publicHolInstance  }.morgen.boolean`
            ).catch((e) => adapter.log.warn(e));
            if (_publicHolInstanceMorgen && _publicHolInstanceMorgen.val) {
                publicHolidayTomorrowStr = _publicHolInstanceMorgen.val;
            }
        }

        if (adapter.config.weatherForecast === true && (adapter.config.weatherForInstance !== 'none' || adapter.config.weatherForInstance !== '')) {
            /**
             * Niederschlagsmenge HEUTE in mm
             *
             */
            const _weatherForInstanceToday = await adapter.getForeignStateAsync(
                weatherForecastTodayPfadStr
            ).catch((e) => adapter.log.warn(e));
            if (_weatherForInstanceToday && _weatherForInstanceToday.val) {
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

            /**
             * Niederschlagsmenge MORGEN in mm
             *
             */
            const _weatherForInstance = await adapter.getForeignStateAsync(
                `${adapter.config.weatherForInstance  }.NextDaysDetailed.Location_1.Day_2.rain_value`
            ).catch((e) => adapter.log.warn(e));
            if (_weatherForInstance && _weatherForInstance.val) {
                weatherForecastTomorrowNum = _weatherForInstance.val;
                await adapter.setStateAsync('info.rainTomorrow', {
                    val: weatherForecastTomorrowNum,
                    ack: true
                });
            }
        }

        // wenn (...sprinkleName.autoOn == false[off])  so wird der aktuelle Sprenger [sprinkleName]
        //   bei false nicht automatisch gestartet
        /**
         * Abfrage von ...sprinkleName.autoOn
         *
         */
        const result = myConfig.config;
        if (result) {
            for (const res of result) {
                /**
                 * Abfrage ... .autoOn beim Start
                 *
                 */
                const _autoOn = await adapter.getForeignStateAsync(
                    res.autoOnID
                );
                if (_autoOn && typeof _autoOn.val === 'boolean') {
                    res.autoOn = _autoOn.val;
                    if (_autoOn.val === false) {
                        adapter.log.info(`get ${res.objectName}.autoOn = ${res.autoOn}`);
                    }
                }
            
                // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
                // +++++                            Zustände der States aktualisieren                       +++++ //
                // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //

                // .countdown beim Start auf '0' setzen
                adapter.setStateAsync(`sprinkle.${res.objectName}.countdown`,{
                    val:'0',
                    ack:true
                });
                
                // .runningTime beim Start auf '00:00' setzen
                adapter.setStateAsync(`sprinkle.${res.objectName}.runningTime`,{
                    val:'00:00',
                    ack:true
                });
                
                // .countdown beim Start auf '0' für (off) setzen
                adapter.setStateAsync(`sprinkle.${res.objectName}.sprinklerState`,{
                    val:0,
                    ack:true
                });
            }
        }

        if (adapter.config.actualValueLevel){
            /**
             * Füllstand der Zisterne in % holen
             *
             */
            const _actualValueLevel = await adapter.getForeignStateAsync(
                adapter.config.actualValueLevel
            ).catch((e) => adapter.log.warn(e));
            if (_actualValueLevel && typeof parseFloat(_actualValueLevel.val) === 'number') {
                valveControl.setFillLevelCistern(parseFloat(_actualValueLevel.val));
            }
        }
        /**
         * return the saved objects under sprinkle.*
         * rückgabe der gespeicherten Objekte unter sprinkle.*
         *
         */
        const _list = await adapter.getForeignObjectsAsync(`${adapter.namespace  }.sprinkle.*`, 'channel').catch((e) => adapter.log.warn(e));
        if (_list) {
            ObjSprinkle = _list;
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
const calcPos = schedule.scheduleJob('calcPosTimer', '5 0 * * *', function() {
    // Berechnungen mittels SunCalc
    sunPos();
    today = formatTime(adapter,'', 'day');

    // History Daten aktualisieren, wenn eine neue Woche beginnt
    adapter.log.debug(`calcPos 0:05 old-KW: ${kwStr} new-KW: ${formatTime(adapter, '','kW')} if: ${(kwStr !== formatTime(adapter, '','kW'))}`);
    if (kwStr !== formatTime(adapter, '','kW')) {
        const result = myConfig.config;
        if (result) {
            for(const i in result) {
                if (Object.hasOwn(result, i)) {
                    const objectName = result[i].objectName;
                    adapter.getState(`sprinkle.${objectName}.history.curCalWeekConsumed`, (err, state) => {
                        if (state) {
                            adapter.setState(`sprinkle.${objectName}.history.lastCalWeekConsumed`, { 
                                val: state.val,
                                ack: true 
                            });
                            adapter.setState(`sprinkle.${objectName}.history.curCalWeekConsumed`, { 
                                val: 0, 
                                ack: true 
                            });
                        }
                    });
                    adapter.getState(`sprinkle.${objectName}.history.curCalWeekRunningTime`, (err, state) => {
                        if (state) {
                            adapter.setState(`sprinkle.${objectName}.history.lastCalWeekRunningTime`, { 
                                val: state.val, 
                                ack: true 
                            });
                            adapter.setState(`sprinkle.${objectName}.history.curCalWeekRunningTime`, { 
                                val: '00:00', 
                                ack: true 
                            });
                        }
                    });
                }

            }
        }
        kwStr = formatTime(adapter, '','kW');
    }

    // ETpToday und ETpYesterday in evaporation aktualisieren da ein neuer Tag
    evaporation.setNewDay();

    // Startzeit Festlegen → verzögert wegen Daten von SunCalc
    setTimeout(() => {
        startTimeSprinkle();
        addStartTimeSprinkle();
    },1000);

});

// Berechnung mittels sunCalc
function sunPos() {
    // get today's sunlight times → Holen Sie sich die heutige Sonnenlichtzeit
    const times = SunCalc.getTimes(new Date(), adapter.config.latitude, adapter.config.longitude);

    // format sunrise time from the Date object → Formatieren Sie die Sonnenaufgangszeit aus dem Date-Objekt
    sunriseStr = `${(`0${times.sunrise.getHours()}`).slice(-2)}:${(`0${times.sunrise.getMinutes()}`).slice(-2)}`;

    // format golden hour end time from the Date object → Formatiere golden hour end time aus dem Date-Objekt
    goldenHourEnd = `${(`0${times.goldenHourEnd.getHours()}`).slice(-2)}:${(`0${times.goldenHourEnd.getMinutes()}`).slice(-2)}`;

    // format sunset time from the Date object → formatieren Sie die Sonnenuntergangszeit aus dem Date-Objekt
    sunsetStr = sunsetStr = `${(`0${times.sunset.getHours()}`).slice(-2)}:${(`0${times.sunset.getMinutes()}`).slice(-2)}`;

}

function addStartTimeSprinkle() {
    schedule.cancelJob('sprinkleAddStartTime');
    if (adapter.config.selectAddStartTime === 'greaterETpCurrent' || adapter.config.selectAddStartTime === 'withExternalSignal') {
        const addStartTimeSplit = adapter.config.addWateringStartTime.split(':');
        const scheduleAddStartTime = schedule.scheduleJob('sprinkleAddStartTime', `${addStartTimeSplit[1]} ${addStartTimeSplit[0]} * * *`, function() {
            // if (autoOnOff == false) => keine auto Start
            if (!autoOnOffStr) {
                schedule.cancelJob('sprinkleAddStartTime');
                return;
            }
            if (((adapter.config.selectAddStartTime === 'greaterETpCurrent') && (adapter.config.triggerAddStartTimeETpCur < evaporation.getETpTodayNum()))
                || (adapter.config.selectAddStartTime === 'withExternalSignal' && addStartTimeSwitch)) {
                let messageText = '';

                // Filter enabled
                const result = myConfig.config.filter(d => d.enabled === true);
                if (result) {
                    /**
                     * Array zum flüchtigen Sammeln von Bewässerungsaufgaben
                     *
                     */
                    const memAddList = [];

                    /**
                     * result Rain
                     * - (aktuelle Wettervorhersage - Schwellwert der Regenberücksichtigung) wenn Sensor sich im Freien befindet
                     * - (> 0) es regnet - Abbruch -
                     * - (≤ 0) Start der Bewässerung
                     *
                     * @param inGreenhouse - Sensor befindet sich im Gewächshaus
                     * @returns - resultierende Regenmenge
                     */
                    function resRain (inGreenhouse) {
                        return (adapter.config.weatherForecast && !inGreenhouse) ? (((+ weatherForecastTodayNum) - parseFloat(adapter.config.thresholdRain)).toFixed(1)) : 0;
                    }

                    for(const res of result) {
                        if (res.autoOn                                  // Ventil aktiv
                            && (res.addWateringTime > 0)                // zusätzliche Bewässerung aktiv time > 0
                            && (resRain(res.inGreenhouse) <= 0)) {      // keine Regenvorhersage

                            switch (res.methodControlSM) {
                                case 'bistable': {
                                    if (res.soilMoisture.bool) {
                                        messageText += `<b>${res.objectName}</b> (${res.soilMoisture.bool})\n`
                                                    +  `   START => ${addTime(Math.round(60 * res.addWateringTime), '')}\n`;
                                        memAddList.push({
                                            auto: true,
                                            sprinkleID: res.sprinkleID,
                                            wateringTime: Math.round(60 * res.addWateringTime)
                                        });
                                    }
                                    break;
                                }

                                case 'fixDay': {
                                    messageText += `<b>${res.objectName}</b>\n`
                                                +  `   START => ${addTime(Math.round(60 * res.addWateringTime), '')}\n`;
                                    memAddList.push({
                                        auto: true,
                                        sprinkleID: res.sprinkleID,
                                        wateringTime: Math.round(60 * res.addWateringTime)
                                    });
                                    break;
                                }

                                case 'calculation': {
                                    const addCountdown = res.wateringTime * (res.soilMoisture.maxIrrigation - res.soilMoisture.val) / (res.soilMoisture.maxIrrigation - res.soilMoisture.triggersIrrigation) - res.wateringTime;
                                    adapter.log.debug(`addCountdown: ${addCountdown}, addWateringTime: ${res.addWateringTime}, if(${(addCountdown - res.addWateringTime) > 0})`);
                                    if ((addCountdown - res.addWateringTime) > 0) {
                                        messageText += `<b>${res.objectName}</b> ${res.soilMoisture.pct}% (${res.soilMoisture.pctTriggerIrrigation}%)\n`
                                                     + `   START => ${addTime(Math.round(60 * addCountdown), '')}\n`;
                                        memAddList.push({
                                            auto: true,
                                            sprinkleID: res.sprinkleID,
                                            wateringTime: Math.round(60 * addCountdown)
                                        });
                                    }
                                    break;
                                }

                                case 'analog': {
                                    if (res.soilMoisture.pct < res.soilMoisture.pctAddTriggersIrrigation) {
                                        messageText += `<b>${res.objectName}</b> ${res.soilMoisture.pct} %(${res.soilMoisture.pctAddTriggersIrrigation}%)\n`
                                                    +  `   START => ${addTime(Math.round(60 * res.addWateringTime), '')}\n`;
                                        memAddList.push({
                                            auto: true,
                                            sprinkleID: res.sprinkleID,
                                            wateringTime: Math.round(60 * res.addWateringTime)
                                        });
                                    }
                                    break;
                                }

                            }
                        } else {
                            adapter.log.debug(`${res.objectName}: autoOn (${res.autoOn}) && addWateringTime (${res.addWateringTime} > 0) && resRain (${resRain(res.inGreenhouse)}) <= 0, if(${res.autoOn && (res.addWateringTime > 0) && (resRain(res.inGreenhouse) <= 0)})`);
                        }
                    }
                    valveControl.addList(memAddList);
                }
                if(!sendMessageText.onlySendError() && messageText.length > 0){
                    sendMessageText.sendMessage(messageText);
                }
            } else {
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
    let messageText = '';

    schedule.cancelJob('sprinkleStartTime');

    // if (autoOnOff == false) => keine auto Start
    if (!autoOnOffStr) {
        adapter.log.info(`Sprinkle: autoOnOff == Aus ( ${autoOnOffStr} )`);
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
     * @returns
     */
    function nextStartTime () {
        let newStartTime;
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
         * @param i
         * @returns
         */
        function checkTime(i) {
            return (+i < 10) ? `0${i}` : i;
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
                    newStartTime = addTime(sunriseStr, parseInt(adapter.config.timeShift));
                    break;
                case 'livingGoldenHourEnd' :	/*Startauswahl = Ende der Golden Hour*/
                    infoMessage = 'Start zum Ende der Golden Hour ';
                    // format goldenHourEnd time from the Date object
                    newStartTime = goldenHourEnd;
                    break;
                case 'livingSunset' :           /*Startauswahl = Sonnenuntergang*/
                    infoMessage = 'Start mit Sonnenuntergang ';
                    // format sunset time from the Date object
                    newStartTime = addTime(sunsetStr, parseInt(adapter.config.timeShift));
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

        const newStartTimeLong = `${myWeekdayStr[myWeekday]} ${newStartTime}`;
        /**
         * next Auto-Start
         *
         * @param {string|null} err
         * @param {ioBroker.State|null|undefined} state
         */
        adapter.getState('info.nextAutoStart', (err, state) =>{
            if (state) {
                if (state.val !== newStartTimeLong) {
                    adapter.setState('info.nextAutoStart', {
                        val: newStartTimeLong,
                        ack: true
                    });
                    // next Start Message
                    if(!sendMessageText.onlySendError){
                        sendMessageText.sendMessage(`${infoMessage}(${myWeekdayStr[myWeekday]}) um ${newStartTime}`);
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

    const scheduleStartTime = schedule.scheduleJob('sprinkleStartTime', `${startTimeSplit[1]} ${startTimeSplit[0]} * * *`, function() {
        startOfIrrigation();
        setTimeout (() => {
            setTimeout(()=>{
                nextStartTime();
            }, 800);
            schedule.cancelJob('sprinkleStartTime');
        }, 200);
    });
}

const startOfIrrigation = () => {
    let messageText = '';

    // Filter enabled
    const result = myConfig.config.filter(d => d.enabled === true);
    if (result) {
        /**
         * Array zum flüchtigen Sammeln von Bewässerungsaufgaben
         *
         */
        const memAddList = [];

        /**
         * result Rain
         * - (aktuelle Wettervorhersage - Schwellwert der Regenberücksichtigung) wenn Sensor sich im Freien befindet
         * - (> 0) es regnet - Abbruch -
         * - (≤ 0) Start der Bewässerung
         *
         * @param inGreenhouse - Sensor befindet sich im Gewächshaus
         * @returns - resultierende Regenmenge
         */
        function resRain (inGreenhouse) {
            return (adapter.config.weatherForecast && !inGreenhouse) ? (((+ weatherForecastTodayNum) - parseFloat(adapter.config.thresholdRain)).toFixed(1)) : 0;
        }
        // Bewässerung mit Zisterne? Füllstand anzeigen
        if (adapter.config.cisternSettings === true) messageText += `${valveControl.getStatusCistern()}\n`;

        for(const res of result) {
            let messageTextZeile1 = '';
            let messageTextZeile2 = '';
            messageTextZeile1 = `<b>${res.objectName}</b>`;
            switch (res.methodControlSM) {
                case 'bistable':
                    messageTextZeile1 += ` (${res.soilMoisture.bool})`;
                    break;
                case 'analog':
                    messageTextZeile1 += ` ${res.soilMoisture.pct}% (${res.soilMoisture.pctTriggerIrrigation}%)`;
                    break;
                case 'fixDay':
                    //messageTextZeile1 += ` (${curNextFixDay(res.sprinkleID, true)})`;
                    break;
                case 'calculation':
                    messageTextZeile1 += ` ${res.soilMoisture.pct}% (${res.soilMoisture.pctTriggerIrrigation}%)`;
                    break;
            }

            // Test Bodenfeuchte
            adapter.log.debug(`Bodenfeuchte: ${res.soilMoisture.val} <= ${res.soilMoisture.triggersIrrigation} AutoOn: ${res.autoOn}`);
            if (res.autoOn) {
                switch (res.methodControlSM) {
                    // -- bistable  --  Bodenfeuchte-Sensor mit 2-Punkt-Regler true und false -- //
                    case 'bistable':
                        if(res.soilMoisture.bool) {
                            /* Wenn in der Config Regenvorhersage aktiviert: Startvorgang abbrechen, wenn der Regen den eingegebenen Schwellwert überschreitet. */
                            if (resRain(res.inGreenhouse) <= 0) {
                                const curWateringTime = Math.round(60 * res.wateringTime * evaporation.timeExtension(res.wateringAdd));
                                memAddList.push({
                                    auto: true,
                                    sprinkleID: res.sprinkleID,
                                    wateringTime: curWateringTime
                                });
                                messageTextZeile2 += `START => ${addTime(curWateringTime, '')}`;
                            } else if (adapter.config.weatherForecast) {
                                /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                messageTextZeile2 += `<i>Start verschoben, da heute ${weatherForecastTodayNum}mm Niederschlag</i>`;
                                adapter.log.info(`${res.objectName}: Start verschoben, da Regenvorhersage für Heute ${weatherForecastTodayNum} mm [ ${resRain(res.inGreenhouse)} > 0 ]`);
                            }
                        }
                        break;
                    // --- analog  --  Bodenfeuchte-Sensor im Wertebereich von 0 bis 100% --- //
                    //  --                 Prozentuale Bodenfeuchte zu gering             --  //
                    case 'analog':
                        if(res.soilMoisture.pct <= res.soilMoisture.pctTriggerIrrigation) {
                            /* Wenn in der Config Regenvorhersage aktiviert: Startvorgang abbrechen, wenn der Regen den eingegebenen Schwellwert überschreitet. */
                            if (resRain(res.inGreenhouse) <= 0) {
                                let countdown = res.wateringTime * (100 - res.soilMoisture.pct) / (100 - res.soilMoisture.pctTriggerIrrigation); // in min
                                // Begrenzung der Bewässerungszeit auf dem in der Config eingestellten Überschreitung (in Prozent)
                                if (countdown > (res.wateringTime * res.wateringAdd / 100)) {
                                    countdown = res.wateringTime * res.wateringAdd / 100;
                                }
                                memAddList.push({
                                    auto: true,
                                    sprinkleID: res.sprinkleID,
                                    wateringTime: Math.round(60* countdown)
                                });
                                messageTextZeile2 += `START => ${addTime(Math.round(60*countdown), '')}`;
                            } else if (adapter.config.weatherForecast) {
                                /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                messageTextZeile2 += `<i>Start verschoben, da heute ${weatherForecastTodayNum}mm Niederschlag</i> `;
                                adapter.log.info(`${res.objectName}: Start verschoben, da Regenvorhersage für Heute ${weatherForecastTodayNum} mm [ ${resRain(res.inGreenhouse)} > 0 ]`);
                            }
                        }
                        break;
                    // --- fixDay  --  Start an festen Tagen ohne Sensoren  --- //
                    //  --              Bewässerungstag erreicht                //
                    case 'fixDay':
                        /* Wenn in der Config Regenvorhersage aktiviert: Startvorgang abbrechen, wenn der Regen den eingegebenen Schwellwert überschreitet. */
                        if (resRain(res.inGreenhouse) <= 0) {
                            // Bewässerungstag erreicht
                            if (res.startFixDay[today]) {
                                const curWateringTime = Math.round(60 * res.wateringTime * evaporation.timeExtension(res.wateringAdd));
                                memAddList.push({
                                    auto: true,
                                    sprinkleID: res.sprinkleID,
                                    wateringTime: curWateringTime
                                });
                                messageTextZeile2 += `START => ${addTime(curWateringTime, '')}`;
                                if (res.startDay === 'threeRd'){          // Next Start in 3 Tagen
                                    res.startFixDay[today] = false;
                                    res.startFixDay[(+ today + 3 > 6) ? (+ today-4) : (+ today+3)] = true;
                                }else if (res.startDay === 'twoNd') {     // Next Start in 2 Tagen
                                    res.startFixDay[today] = false;
                                    res.startFixDay[(+ today + 2 > 6) ? (+ today-5) : (+ today+2)] = true;
                                }
                            }
                        } else if (adapter.config.weatherForecast){
                            messageTextZeile2 += `<i>Start verschoben, da heute ${weatherForecastTodayNum}mm Niederschlag</i>`;
                            adapter.log.info(`${res.objectName}: Start verschoben, da Regenvorhersage für Heute ${weatherForecastTodayNum} mm [ ${resRain(false)} > 0 ]`);
                            if ((res.startDay === 'threeRd') || (res.startDay === 'twoNd')) {
                                let startDay = -1;
                                res.startFixDay.forEach((item, index) => {
                                    if (item) {
                                        startDay = index;
                                    }
                                });
                                if (startDay !== -1) {
                                    res.startFixDay[startDay] = false;
                                    res.startFixDay[(+ startDay + 1 > 6) ? (+ startDay-6) : (+ startDay+1)] = true;
                                } else {
                                    adapter.log.warn(`${res.objectName}: no start day found`);
                                }
                            }
                        }
                        curNextFixDay(res.sprinkleID, false);
                        messageTextZeile1 += ` (${curNextFixDay(res.sprinkleID, true)})`;
                        break;
                    // ---   calculation  --  Berechnung der Bodenfeuchte  --- //
                    //  --             Bodenfeuchte zu gering              --  //
                    case 'calculation':
                        if (res.soilMoisture.val <= res.soilMoisture.triggersIrrigation) {
                            /* Wenn in der Config Regenvorhersage aktiviert: Startvorgang abbrechen, wenn es heute ausreichend regnen sollte. */
                            const resMoisture = (adapter.config.weatherForecast)?((+ res.soilMoisture.val) + (+ weatherForecastTodayNum) - parseFloat(adapter.config.thresholdRain)):(res.soilMoisture.val);   // aktualisierte Bodenfeuchte mit Regenvorhersage
                            if ((resMoisture <= res.soilMoisture.triggersIrrigation) || res.inGreenhouse) {   // Kontrolle ob Regenvorhersage ausreicht || Bewässerung inGreenhouse
                                let countdown = res.wateringTime * (res.soilMoisture.maxIrrigation - res.soilMoisture.val) / (res.soilMoisture.maxIrrigation - res.soilMoisture.triggersIrrigation); // in min
                                // Begrenzung der Bewässerungszeit auf dem in der Config eingestellten Überschreitung (in Prozent)
                                if (countdown > (res.wateringTime * res.wateringAdd / 100)) {
                                    countdown = res.wateringTime * res.wateringAdd / 100;
                                }
                                memAddList.push({
                                    auto: true,
                                    sprinkleID: res.sprinkleID,
                                    wateringTime: Math.round(60*countdown)
                                });
                                messageTextZeile2 += `START => ${addTime(Math.round(60*countdown), '')}`;
                            } else if (adapter.config.weatherForecast) {
                                /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                messageTextZeile2 += `<i>Start verschoben, da heute ${weatherForecastTodayNum}mm Niederschlag</i>`;
                                adapter.log.info(`${res.objectName}: Start verschoben, da Regenvorhersage für Heute ${weatherForecastTodayNum} mm [ ${res.soilMoisture.val.toFixed(1)} (${resMoisture.toFixed(1)}) <= ${res.soilMoisture.triggersIrrigation} ]`);
                            }
                        }
                        break;
                }
            } else {
                messageTextZeile2 += `<i>Ventil auf Handbetrieb</i> `;
            }
            messageText += (messageTextZeile2.length > 0) ? (`${messageTextZeile1}\n   ${messageTextZeile2}\n`) : (`${messageTextZeile1}\n`);
        }
        valveControl.addList(memAddList);
    }
    if(!sendMessageText.onlySendError()){
        sendMessageText.sendMessage(messageText);
    }
}

//
async function createSprinklers() {
    /**Creates an Object .control.addStartTimeSwitch, when additional watering has been activated via an external signal
     * - Erzeugt ein Object .control.addStartTimeSwitch, wenn die Zusatzbewässerung über ein externes Signal aktiviert wurde
     * @type {{id: string, name: string} | void}
     * @private
     */
    const _addStartTimeSwitch = await adapter.findForeignObjectAsync(`${adapter.namespace}.control.addStartTimeSwitch`, 'boolean').catch((e) => adapter.log.warn(`.control.addStartTimeSwitch ${e}`));
    if (_addStartTimeSwitch.id !== `${adapter.namespace}.control.addStartTimeSwitch` && adapter.config.selectAddStartTime === 'withExternalSignal') {
        adapter.setObjectNotExistsAsync(`${adapter.namespace}.control.addStartTimeSwitch`, {
            type: 'state',
            common: {
                role: 'switch',
                name: {
                    en: "additional irrigation enabled",
                    de: "weitere Bewässerung aktiviert",
                    ru: "включено дополнительное орошение",
                    pt: "irrigação adicional ativada",
                    nl: "extra irrigatie mogelijk",
                    fr: "arrosage supplémentaire activé",
                    it: "irrigazione extra abilitata",
                    es: "riego adicional habilitado",
                    pl: "włączone dodatkowe nawadnianie",
                    uk: "додаткове зрошення включено",
                    "zh-cn": "已启用额外灌溉"
                },
                type:  'boolean',
                read:  true,
                write: true,
                def: false
            },
            native: {}
        }).catch((e) => adapter.log.warn(`.control.addStartTimeSwitch ${e}`));
    } else if (_addStartTimeSwitch.id === `${adapter.namespace}.control.addStartTimeSwitch`) {
        if (adapter.config.selectAddStartTime !== 'withExternalSignal') {
            adapter.delObjectAsync(`${adapter.namespace}.control.addStartTimeSwitch`).catch((e) => adapter.log.warn(`.control.addStartTimeSwitch ${e}`));
            addStartTimeSwitch = false;
        } else {
            /** 
             * auslesen .control.addStartTimeSwitch.val
             */
            const _state = await adapter.getStateAsync(`${adapter.namespace}.control.addStartTimeSwitch`).catch((e) => adapter.log.warn(`.control.addStartTimeSwitch ${e}`));
            if (typeof _state.val === 'boolean') {
                addStartTimeSwitch = _state.val;
            }
        }
    }



    const result = adapter.config.events;
    if (result) {
        for(const res of result) {
            let objectName;

            if(res.sprinkleName !== '') {
                objectName = res.sprinkleName.replace(/[.;, ]/g, '_');
            } else if (res.sprinkleName === '') {
                objectName = res.name.replace(/[.;, ]/g, '_');
            }

            const objPfad = `sprinkle.${objectName}`;
            const j = myConfig.config.findIndex(d => d.objectName === objectName);

            // Create bzw. update .actualSoilMoisture

            let nameMetConSM, objMetConSM;
            await fillMetConSM(res);
            async function fillMetConSM(res) {
                //adapter.log.debug(JSON.stringify(res));
                switch (res.methodControlSM) {
                    case 'calculation':
                        nameMetConSM = {
                            en: `${objectName} => Calculated soil moisture in %`,
                            de: `${objectName} => Berechnete Bodenfeuchte in%`,
                            ru: `${objectName} => Расчетная влажность почвы в%`,
                            pt: `${objectName} => Umidade do solo calculada em%`,
                            nl: `${objectName} => Berekend bodemvocht in%`,
                            fr: `${objectName} => Humidité du sol calculée en %`,
                            it: `${objectName} => Umidità del suolo in%`,
                            es: `${objectName} => Humedad del suelo calculada en%`,
                            pl: `${objectName} => Obliczona wilgotność gleby w%`,
                            uk: `${objectName} => Розрахована вологість ґрунту в%`,
                            "zh-cn": `${objectName} => 计算出的土壤湿度百分比`
                        };
                        objMetConSM = {
                            type: 'state',
                            common: {
                                role: 'state',
                                name: nameMetConSM,
                                type: 'number',
                                min: 0,
                                max: 150,
                                unit: '%',
                                read: true,
                                write: false,
                                def: 50
                            },
                            native: {},
                        };
                        break;
                    case 'bistable':
                        nameMetConSM = {
                            en: `${objectName} => bistable soil moisture sensor`,
                            de: `${objectName} => Bistabiler Bodenfeuchtesensor`,
                            ru: `${objectName} => бистабильный датчик влажности почвы`,
                            pt: `${objectName} => sensor biestável de umidade`,
                            nl: `${objectName} => bistabiele bodemvochtsensor`,
                            fr: `${objectName} => capteur d'humidité du sol bistable`,
                            it: `${objectName} => sensore di umidità bistabile`,
                            es: `${objectName} => sensor biestable de humedad`,
                            pl: `${objectName} => bistabilny czujnik wilgotności gleby`,
                            uk: `${objectName} => бістабільний датчик вологості ґрунту`,
                            "zh-cn": `${objectName} => 双稳态土壤湿度传感器`
                        };
                        objMetConSM = {
                            type: 'state',
                            common: {
                                role: 'state',
                                name: nameMetConSM,
                                type: 'boolean',
                                read: true,
                                write: false,
                                def: false
                            },
                            native: {},
                        };
                        break;
                    case 'analog':
                        nameMetConSM = {
                            en: `${objectName} => analog soil moisture sensor in %`,
                            de: `${objectName} => analoger Bodenfeuchtesensor in%`,
                            ru: `${objectName} => аналоговый датчик влажности почвы в%`,
                            pt: `${objectName} => sensor analógico de umidade em%`,
                            nl: `${objectName} => analoge bodemvochtsensor in%`,
                            fr: `${objectName} => capteur d'humidité du sol analogique en %`,
                            it: `${objectName} => sensore umidità analogico in%`,
                            es: `${objectName} => sensor analógico de humedad en%`,
                            pl: `${objectName} => analogowy czujnik wilgotności gleby w%`,
                            uk: `${objectName} => аналоговий датчик вологості ґрунту в%`,
                            "zh-cn": `${objectName} => 模拟土壤湿度传感器，单位为％`
                        };
                        objMetConSM = {
                            type: 'state',
                            common: {
                                role: 'state',
                                name: nameMetConSM,
                                type: 'number',
                                min: 0,
                                max: 150,
                                unit: '%',
                                read: true,
                                write: false
                            },
                            native: {},
                        };
                        break;
                    case 'fixDay':
                        nameMetConSM = {
                            en: `${objectName} => start on a fixed day`,
                            de: `${objectName} => start an einem festen Tag`,
                            ru: `${objectName} => начните в определенный день`,
                            pt: `${objectName} => começa em dia fixo`,
                            nl: `${objectName} => start op een vaste dag`,
                            fr: `${objectName} => commence un jour fixe`,
                            it: `${objectName} => inizio a un giorno`,
                            es: `${objectName} => empezar un día fijo`,
                            pl: `${objectName} => zacznij w ustalonym dniu`,
                            uk: `${objectName} => початок у фіксований день`,
                            "zh-cn": `${objectName} => 在固定的日期开始`
                        };
                        objMetConSM = {
                            type: 'state',
                            common: {
                                role:  'state',
                                name:  nameMetConSM,
                                type:  'number',
                                min: 0,
                                max: 7,
                                states: {0:'Sun', 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thur', 5:'Fri', 6:'Sat', 7:'off'},
                                read:  true,
                                write: false,
                                def: 7
                            },
                            native: {},
                        };
                        break;
                    default:
                        adapter.log.warn(`sprinkleControl cannot created ... Please check your sprinkleControl config ${objectName} methodControl`);
                        nameMetConSM = {
                            en: `${objectName} => Emergency program! start on a fixed day`,
                            de: `${objectName} => Notfallprogramm! start an einem festen Tag`,
                            ru: `${objectName} => Экстренная программа! начните в определенный день`,
                            pt: `${objectName} => Programa urgente! comece em dia fixo`,
                            nl: `${objectName} => Noodprogramma! op een vaste dag beginnen`,
                            fr: `${objectName} => Programme d'urgence ! commencer un jour fixe`,
                            it: `${objectName} => Emergenze! inizio a data fissa`,
                            es: `${objectName} => ¡Programa de emergencia! empezar un día fijo`,
                            pl: `${objectName} => Program awaryjny! zacznij w ustalonym dniu`,
                            uk: `${objectName} => Екстрена програма! початок у визначений день`,
                            "zh-cn": `${objectName} => 紧急计划！从固定的日子开始`
                        };
                        objMetConSM = {
                            type: 'state',
                            common: {
                                role:  'state',
                                name:  nameMetConSM,
                                type:  'number',
                                min: 0,
                                max: 7,
                                states: {0:'Sun', 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thur', 5:'Fri', 6:'Sat', 7:'off'},
                                read:  true,
                                write: false,
                                def: 7
                            },
                            native: {},
                        };
                }
            }
            // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
            // +++++                                     Objekte  erstellen                                     +++++ //
            // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
            if (objectName && objectName !== '') {
                try {
                    // Create Object for sprinkle. (ID)
                    const _sprinkleNotExist = await adapter.setObjectNotExistsAsync(`sprinkle.${objectName}`, {
                        type: 'channel',
                        common: {
                            name: res.sprinkleName
                        },
                        native: {},
                    });
                    // Create Object for .history
                    const _historyNotExist = await adapter.setObjectNotExistsAsync(`sprinkle.${objectName}.history`, {
                        type: 'channel',
                        common: {
                            name: {
                                en: `${res.sprinkleName} => History`,
                                de: `${res.sprinkleName} => Verlauf`,
                                ru: `${res.sprinkleName} => История`,
                                pt: `${res.sprinkleName} => História`,
                                nl: `${res.sprinkleName} => Geschiedenis`,
                                fr: `${res.sprinkleName} => Histoire`,
                                it: `${res.sprinkleName} => Storia`,
                                es: `${res.sprinkleName} => Historia`,
                                pl: `${res.sprinkleName} => Historia`,
                                uk: `${res.sprinkleName} => Історія`,
                                "zh-cn": `${res.sprinkleName} => 历史`
                            }
                        },
                        native: {},
                    });
                    // Create Object for .history.curCalWeekConsumed
                    // Sprinkler consumption of the current calendar week => History - Sprinkler-Verbrauch der aktuellen Kalenderwoche (783 Liter)
                    const _curCalWeekConsumedNotExist = adapter.setObjectNotExistsAsync(`${objPfad}.history.curCalWeekConsumed`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  {
                                en: `${objectName} => History - Sprinkler consumption of the current calendar week`,
                                de: `${objectName} => Verlauf — Sprinklerverbrauch der aktuellen Woche`,
                                ru: `${objectName} => История - потребление спринклеров за текущую календарную неделю`,
                                pt: `${objectName} => Histórico - Consumo de sprinklers na semana atual`,
                                nl: `${objectName} => Geschiedenis - Sprinklerverbruik van de huidige kalenderweek`,
                                fr: `${objectName} => Historique - Consommation de gicleurs de la semaine en cours`,
                                it: `${objectName} => Cronologia - Consumo di irrigatori nella settimana corrente`,
                                es: `${objectName} => Historial: consumo de rociadores en la semana natural actual`,
                                pl: `${objectName} => Historia - Zużycie tryskaczy w bieżącym tygodniu kalendarzowym`,
                                uk: `${objectName} => Історія - Споживання спринклерів поточного календарного тижня`,
                                "zh-cn": `${objectName} => 历史-当前日历周的洒水消耗量`
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
                    const _curCalWeekRunningTimeNotExist = adapter.setObjectNotExistsAsync(`${objPfad}.history.curCalWeekRunningTime`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  {
                                en: `${objectName} => History - Sprinkler running time of the current calendar week`,
                                de: `${objectName} => Verlauf — Sprinklerlaufzeit der aktuellen Woche`,
                                ru: `${objectName} => История - время работы спринклеров на текущей календарной неделе`,
                                pt: `${objectName} => Histórico - Tempo de operação do sprinkler na semana atual`,
                                nl: `${objectName} => Geschiedenis - De looptijd van de sprinkler in de huidige kalenderweek`,
                                fr: `${objectName} => Historique - Durée du gicleur pour la semaine civile en cours`,
                                it: `${objectName} => Cronologia - Durata dell'irrigatore nella settimana corrente`,
                                es: `${objectName} => Historia: duración de los rociadores de la semana actual`,
                                pl: `${objectName} => Historia - Czas pracy tryskacza bieżącego tygodnia kalendarzowego`,
                                uk: `${objectName} => Історія - Час роботи спринклера поточного календарного тижня`,
                                "zh-cn": `${objectName} => 历史-当前日历周的洒水器运行时间`
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
                    const _lastCalWeekConsumedNotExist = adapter.setObjectNotExistsAsync(`${objPfad}.history.lastCalWeekConsumed`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  {
                                en: `${objectName} => History - Sprinkler consumption of the last calendar week`,
                                de: `${objectName} => Verlauf — Sprinklerverbrauch der letzten Woche`,
                                ru: `${objectName} => История - потребление спринклеров за последнюю календарную неделю`,
                                pt: `${objectName} => Histórico - Consumo de sprinklers na última semana`,
                                nl: `${objectName} => Geschiedenis - Sprinklerverbruik van de laatste kalenderweek`,
                                fr: `${objectName} => Historique - Consommation de gicleurs la semaine dernière`,
                                it: `${objectName} => Cronologia - Consumo di irrigatori nell'ultima settimana`,
                                es: `${objectName} => Historia: consumo de rociadores de la última semana natural`,
                                pl: `${objectName} => Historia - Zużycie tryskaczy w ostatnim tygodniu kalendarzowym`,
                                uk: `${objectName} => Історія - Споживання спринклерів за останній календарний тиждень`,
                                "zh-cn": `${objectName} => 历史-上个日历周的洒水消耗量`
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
                    const _lastCalWeekRunningTimeNotExist = adapter.setObjectNotExistsAsync(`${objPfad}.history.lastCalWeekRunningTime`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  {
                                en: `${objectName} => History - Sprinkler running time of the last calendar week`,
                                de: `${objectName} => Verlauf — Sprinklerlaufzeit der letzten Woche`,
                                ru: `${objectName} => История - Время работы спринклеров за последнюю календарную неделю`,
                                pt: `${objectName} => Histórico - Tempo de operação do sprinkler na última semana`,
                                nl: `${objectName} => Geschiedenis - De looptijd van de sprinkler van de laatste kalenderweek`,
                                fr: `${objectName} => Historique - Durée de fonctionnement du gicleur la semaine dernière`,
                                it: `${objectName} => Storia - Durata dell'irrigatore nell'ultima settimana`,
                                es: `${objectName} => Historia: funcionamiento de los rociadores de la última semana`,
                                pl: `${objectName} => Historia - Czas pracy tryskacza w ostatnim tygodniu kalendarzowym`,
                                uk: `${objectName} => Історія - Час роботи спринклерів за останній календарний тиждень`,
                                "zh-cn": `${objectName} => 历史-上个日历周的洒水器运行时间`
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
                    const _lastConsumedNotExist = adapter.setObjectNotExistsAsync(`${objPfad}.history.lastConsumed`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  {
                                en: `${objectName} => History - Last consumed of sprinkler`,
                                de: `${objectName} => Historie — Letzter Sprinklerverbrauch`,
                                ru: `${objectName} => История - Последнее потребление спринклера`,
                                pt: `${objectName} => Histórico - Último consumo do aspersor`,
                                nl: `${objectName} => Geschiedenis - Sprinkler voor het laatst verbruikt`,
                                fr: `${objectName} => Historique - Dernier gicleur consommé`,
                                it: `${objectName} => Storia - Ultimo uso di irrigatore`,
                                es: `${objectName} => Historia: rociador consumido por última vez`,
                                pl: `${objectName} => Historia - Ostatnie zużycie tryskacza`,
                                uk: `${objectName} => Історія - Останнє споживання спринклера`,
                                "zh-cn": `${objectName} => 历史-上次消耗的洒水器`
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
                    const _lastOnNotExist = adapter.setObjectNotExistsAsync(`${objPfad}.history.lastOn`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  {
                                en: `${objectName} => History - Last On of sprinkler`,
                                de: `${objectName} => Historie — Letzter Start des Sprinkler`,
                                ru: `${objectName} => История - Последний включитель спринклера`,
                                pt: `${objectName} => História - Último aspersor`,
                                nl: `${objectName} => Geschiedenis - De laatste sprinkler`,
                                fr: `${objectName} => Histoire - Dernier gicleur`,
                                it: `${objectName} => Storia - Ultimo irrigatore`,
                                es: `${objectName} => Historia: el último rociador`,
                                pl: `${objectName} => Historia - Ostatnie włączenie tryskacza`,
                                uk: `${objectName} => Історія - Остання увімкнення спринклера`,
                                "zh-cn": `${objectName} => 历史-洒水器的最后一次`
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
                    const _lastRunningTimeNotExist = adapter.setObjectNotExistsAsync(`${objPfad}.history.lastRunningTime`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  {
                                en: `${objectName} => History - Last running time`,
                                de: `${objectName} => Verlauf — Letzte Laufzeit`,
                                ru: `${objectName} => История - время последнего запуска`,
                                pt: `${objectName} => Histórico - Última execução`,
                                nl: `${objectName} => Geschiedenis - Laatste speeltijd`,
                                fr: `${objectName} => Historique - Dernière diffusion`,
                                it: `${objectName} => Storia - Ultima durata`,
                                es: `${objectName} => Historia: última edición`,
                                pl: `${objectName} => Historia - Ostatni czas trwania`,
                                uk: `${objectName} => Історія - Останній час роботи`,
                                "zh-cn": `${objectName} => 历史-上次运行时间`
                            },
                            type:  'string',
                            read:  true,
                            write: false,
                            def:   '00:00'
                        },
                        native: {},
                    });
                    // Create Object for .autoOn
                    const _autoOnNotExist = adapter.setObjectNotExistsAsync(`${objPfad}.autoOn`, {
                        type: 'state',
                        common: {
                            role:  'Switch',
                            name:  {
                                en: `${objectName} => Switch automatic mode on / off`,
                                de: `${objectName} => Automatik ein-/ausschalten`,
                                ru: `${objectName} => Включить/выключить автоматический режим`,
                                pt: `${objectName} => Liga/desliga o modo automático`,
                                nl: `${objectName} => Automatische modus in- en uitschakelen`,
                                fr: `${objectName} => Activer/désactiver le mode automatique`,
                                it: `${objectName} => Attiva/spegne automaticamente`,
                                es: `${objectName} => Activar/desactivar el modo automático`,
                                pl: `${objectName} => Włączanie/wyłączanie trybu automatycznego`,
                                uk: `${objectName} => Увімкнути/вимкнути автоматичний режим`,
                                "zh-cn": `${objectName} => 开启/关闭自动模式`
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
                    // Create Object for .actualSoilMoisture
                    const _actualSoilMoistureFind = await adapter.findForeignObjectAsync(`${adapter.namespace}.${objPfad}.actualSoilMoisture`, `${objMetConSM.common.type}`);
                    if (_actualSoilMoistureFind.id !== `${adapter.namespace}.${objPfad}.actualSoilMoisture` || _actualSoilMoistureFind.name !== nameMetConSM) {
                        await adapter.setObjectAsync(
                            `${objPfad}.actualSoilMoisture`,
                            objMetConSM
                        ).catch((e) => adapter.log.warn(e));
                        adapter.log.info(`sprinkleControl [sprinkle.${objectName}.actualSoilMoisture] was updated`);
                    }

                    // postponeByOneDay → um einen Tag verschieben bei fixDay (twoNd & threeRd)
                    const _postponeByOneDay = await adapter.findForeignObjectAsync(`${adapter.namespace}.${objPfad}.postponeByOneDay`, `boolean`);
                    if (_postponeByOneDay.id !== `${adapter.namespace}.${objPfad}.postponeByOneDay`
                        && res.methodControlSM === 'fixDay'
                        && (res.startDay === 'twoNd'
                        || res.startDay === 'threeRd')) {
                        await adapter.setObjectNotExistsAsync(`${objPfad}.postponeByOneDay`, {
                            type: 'state',
                            common: {
                                role: 'button',
                                name: {
                                    en: `${objectName} Postpone start by one day`,
                                    de: `${objectName} Start um einen Tag verschieben`,
                                    ru: `${objectName} Отложите начало на один день`,
                                    pt: `${objectName} Adie o início em um dia`,
                                    nl: `${objectName} Start met een dag uitstellen`,
                                    fr: `${objectName} Reporter le début d'un jour`,
                                    it: `${objectName} Rinviare l'inizio di un giorno`,
                                    es: `${objectName} Posponer un día el inicio`,
                                    pl: `${objectName} Odłóż początek o jeden dzień`,
                                    uk: `${objectName} Відкладіть початок на один день`,
                                    "zh-cn": `${objectName} 推迟一天开始`
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
                    const _countdownNotExist = adapter.setObjectNotExistsAsync(`${objPfad}.countdown`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  {
                                en: `${objectName} => countdown of sprinkler`,
                                de: `${objectName} => Sprinkler-Countdown`,
                                ru: `${objectName} => обратный отсчет времени спринклера`,
                                pt: `${objectName} => contagem do aspersor`,
                                nl: `${objectName} => aftellen van de sprinkler`,
                                fr: `${objectName} => compte à rebours`,
                                it: `${objectName} => conto alla rovescia`,
                                es: `${objectName} => cuenta atrás del aspersor`,
                                pl: `${objectName} => odliczanie tryskacza`,
                                uk: `${objectName} => зворотний відлік спринклера`,
                                "zh-cn": `${objectName} => 洒水器倒计时`
                            },
                            type:  'string',
                            read:  true,
                            write: false,
                            def:   '-'
                        },
                        native: {},
                    });
                    // Create Object for .runningTime => Laufzeit des Ventils
                    const _runningTimeNotExist = await adapter.setObjectNotExistsAsync(`${objPfad}.runningTime`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  {
                                en: `${objectName} => running time of sprinkler`,
                                de: `${objectName} => Laufzeit des Sprinklers`,
                                ru: `${objectName} => время работы спринклера`,
                                pt: `${objectName} => duração do aspersor`,
                                nl: `${objectName} => looptijd van de sprinkler`,
                                fr: `${objectName} => durée de fonctionnement du gicleur`,
                                it: `${objectName} => durata dell'irrigatore`,
                                es: `${objectName} => duración del rociador`,
                                pl: `${objectName} => czas pracy zraszacza`,
                                uk: `${objectName} => час роботи спринклера`,
                                "zh-cn": `${objectName} => 洒水器的运行时间`
                            },
                            type:  'string',
                            read:  true,
                            write: true,
                            def:   '-'
                        },
                        native: {},
                    });
                    // Create Object for .sprinklerState => Zustand des Ventils im Thread
                    // <<< 1  = warten >>> ( 0:off; 1:wait; 2:on; 3:break; 4:Boost(on); 5:off(Boost) )
                    // Create .sprinklerState
                    const _sprinklerStateNotExists = await adapter.setObjectNotExistsAsync(`${objPfad}.sprinklerState`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  {
                                en: `${objectName} => actual state of sprinkler`,
                                de: `${objectName} => Stand der Sprinkleranlage`,
                                ru: `${objectName} => фактическое состояние спринклера`,
                                pt: `${objectName} => estado real do aspersor`,
                                nl: `${objectName} => werkelijke toestand van de sprinkler`,
                                fr: `${objectName} => état actuel du gicleur`,
                                it: `${objectName} => stato attuale dell'irrigatore`,
                                es: `${objectName} => estado actual del rociador`,
                                pl: `${objectName} => rzeczywisty stan tryskacza`,
                                uk: `${objectName} => фактичний стан спринклера`,
                                "zh-cn": `${objectName} => 洒水器的实际状态`
                            },
                            type:  'number',
                            min:	0,
                            max:	5,
                            states: {
                                0: 'off',
                                1: 'wait',
                                2: 'on',
                                3: 'break',
                                4: 'Boost(on)',
                                5: 'off(Boost)'
                            },
                            read:  true,
                            write: false,
                            def:   0
                        },
                        native: {},
                    });
                    // Create Object for triggerPoint → Schaltpunkt der Bodenfeuchte
                    const _triggerPointNotExist = await adapter.setObjectNotExistsAsync(`${objPfad}.triggerPoint`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  {
                                en: `${objectName} => Trigger point of sprinkler`,
                                de: `${objectName} => Schaltpunkt des Sprinklers`,
                                ru: `${objectName} => Точка срабатывания спринклера`,
                                pt: `${objectName} => Ponto de gatilho do aspersor`,
                                nl: `${objectName} => Triggerpunt van de sprinkler`,
                                fr: `${objectName} => Point de déclenchement du gicleur`,
                                it: `${objectName} => Punto di innesco`,
                                es: `${objectName} => Punto de activación del aspersor`,
                                pl: `${objectName} => Punkt spustowy zraszacza`,
                                uk: `${objectName} => Тригерна точка спринклера`,
                                "zh-cn": `${objectName} => 洒水器的触发点`
                              },
                            type:  'string',
                            read:  true,
                            write: false,
                            def:   '-'
                        },
                        native: {},
                    });
                    // Object created
                    let value = true;
                    (await Promise.all([
                        _sprinkleNotExist,
                        _historyNotExist,
                        _curCalWeekConsumedNotExist,
                        _curCalWeekRunningTimeNotExist,
                        _lastCalWeekConsumedNotExist,
                        _lastCalWeekRunningTimeNotExist,
                        _lastConsumedNotExist,
                        _lastOnNotExist,
                        _lastRunningTimeNotExist,
                        _autoOnNotExist,
                        _countdownNotExist,
                        _runningTimeNotExist,
                        _sprinklerStateNotExists,
                        _triggerPointNotExist
                    ])).forEach((val) => {
                        value &= val;
                    });
                    if(value) {
                        adapter.log.info(`sprinkleControl [sprinkle.${objectName}] was created`);
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

                            adapter.setStateAsync(`${objPfad}.triggerPoint`, {
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
                                await adapter.setStateAsync(`${objPfad}.actualSoilMoisture`, {
                                    val: 50,
                                    ack: true
                                });
                                adapter.log.warn(`The analoge sensor ${myConfig.config[j].triggerSM} in ${objectName} does not deliver correct values!`);
                            }
                            adapter.setStateAsync(`${objPfad}.triggerPoint`, {
                                val: (myConfig.config[j].soilMoisture.pctTriggerIrrigation).toString(),
                                ack: true
                            }).catch((e) => adapter.log.warn(`${objectName}.triggerPoint setState ${e}`));
                            break;
                        }

                        case 'fixDay': {
                            const nextStartDay = ((today + 1) > 6 ? 0 : (today + 1));

                            /**
                             * Neuen Start-Tag für Dreitage- und Zweitage-modus setzen
                             *
                             * @param threeRd - Dreitage-modus Ja/Nein
                             *     true → Dreitage-modus (treeRD)
                             *     false → Zweitage-modus (twoNd)
                             */
                            async function setNewDay (threeRd) {
                                const today = await formatTime(adapter,'', 'day');
                                const _actualSoilMoisture = await adapter.getStateAsync(
                                    `${objPfad}.actualSoilMoisture`
                                ).catch((e) => adapter.log.warn(`${objectName}.actualSoilMoisture fixDay setState ${e}`));
                                if (_actualSoilMoisture && (typeof _actualSoilMoisture.val === 'number')) {
                                    if ((_actualSoilMoisture.val >= 0) && (_actualSoilMoisture.val <= 6)) {
                                        if ((threeRd)
                                            && (_actualSoilMoisture.val === (((today + 3) > 6) ? 2 : (today + 3)))
                                            || (_actualSoilMoisture.val === (((today + 2) > 6) ? 1 : (today + 2)))
                                            || (_actualSoilMoisture.val === (((today + 1) > 6) ? 0 : (today + 1)))
                                            || (_actualSoilMoisture.val === today)) {
                                            myConfig.config[j].startFixDay[_actualSoilMoisture.val] = true;
                                        } else {
                                            myConfig.config[j].startFixDay[nextStartDay] = true;
                                        }
                                    } else {
                                        myConfig.config[j].startFixDay[nextStartDay] = true;
                                    }
                                    curNextFixDay(myConfig.config[j].sprinkleID, false);
                                }
                            }

                            if (myConfig.config[j].startDay === 'threeRd') {
                                await setNewDay(true);
                            } else if (myConfig.config[j].startDay === 'twoNd') {
                                await setNewDay(false);
                            } else if (myConfig.config[j].startDay === 'fixDay') {
                                curNextFixDay(myConfig.config[j].sprinkleID, false);
                            }

                            adapter.setStateAsync(`${objPfad}.triggerPoint`, {
                                val: '-',
                                ack: true
                            }).catch((e) => adapter.log.warn(`${objectName}.triggerPoint fixDay setState ${e}`));
                            break;
                        }

                        case 'calculation': {
                            const _actualSoilMoisture = await adapter.getStateAsync(`${objPfad}.actualSoilMoisture`).catch((e) => adapter.log.warn(e));
                            if (_actualSoilMoisture) {
                                if (await _actualSoilMoisture && typeof _actualSoilMoisture.val !== 'number' || _actualSoilMoisture.val === 0) {
                                    adapter.setStateAsync(`${objPfad}.actualSoilMoisture`, {
                                        val: myConfig.config[j].soilMoisture.pct,
                                        ack: true
                                    }).catch((e) => adapter.log.warn(e));
                                } else {
                                    // num Wert der Bodenfeuchte berechnen und in der config speichern, wenn Wert zwischen 0 und max liegt
                                    if ((0 < _actualSoilMoisture.val) && (_actualSoilMoisture.val <= (myConfig.config[j]).soilMoisture.maxRain*100/myConfig.config[j].soilMoisture.maxIrrigation)) {
                                        myConfig.config[j].soilMoisture.val = _actualSoilMoisture.val * myConfig.config[j].soilMoisture.maxIrrigation / 100;
                                        myConfig.config[j].soilMoisture.pct = _actualSoilMoisture.val;
                                    } else {
                                        // Wert aus config übernehmen
                                        adapter.setStateAsync(`${objPfad}.actualSoilMoisture`, {
                                            val: myConfig.config[j].soilMoisture.pct,
                                            ack: true
                                        }).catch((e) => adapter.log.warn(e));
                                    }
                                }
                            }

                            adapter.setStateAsync(`${objPfad}.triggerPoint`, {
                                val: (myConfig.config[j].soilMoisture.pctTriggerIrrigation).toString(),
                                ack: true
                            }).catch((e) => adapter.log.warn(e));
                            break;
                        }
                    }

                } catch (e) {
                    adapter.log.warn(`sprinkleControl cannot created ... Please check your sprinkleControl config: ${e}`);
                }
            } else {
                adapter.log.warn('sprinkleControl cannot created ... Please check in your config the sprinkle Name');
            }
        }

        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
        // +++++                                        Objekte löschen                                         +++++ //
        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
        for(const i in ObjSprinkle) {

            const resID = ObjSprinkle[i]._id;
            const objectID = resID.split('.');
            const resultID = objectID[3];

            const resultName = result.map(({ sprinkleName }) => ({ sprinkleName }));
            const fullRes = [];

            for(const i in resultName) {
                // @ts-ignore
                if (Object.hasOwn(resultName,i)) {
                    const res = resultName[i].sprinkleName.replace(/[.;, ]/g, '_');
                    fullRes.push(res);
                }
            }

            if (fullRes.indexOf(resultID) === -1) {
                try {
                    // object deleted
                    /* del when exist Object Async */
                    const delWhenExistObjectAsync = async (id, type) => {
                        const _find = await adapter.findForeignObjectAsync(`${id}`, `${type}`);
                        if (_find && _find.id === `${id}`) {
                            await adapter.delObjectAsync(`${id}`).catch((e) => adapter.log.warn(e));  // "sprinklecontrol.0.sprinkle.???.postponeByOneDay"
                        }
                    };

                    Promise.all([
                        adapter.delObjectAsync(`${resID}.actualSoilMoisture`),                  // "sprinklecontrol.0.sprinkle.???.actualSoilMoisture"
                        adapter.delObjectAsync(`${resID}.triggerPoint`),                        // "sprinklecontrol.0.sprinkle.???.triggerPoint"
                        adapter.delObjectAsync(`${resID}.sprinklerState`),                      // "sprinklecontrol.0.sprinkle.???.sprinklerState"
                        adapter.delObjectAsync(`${resID}.runningTime`),                         // "sprinklecontrol.0.sprinkle.???.runningTime"
                        delWhenExistObjectAsync(`${resID}.postponeByOneDay`, `boolean`),          // "sprinklecontrol.0.sprinkle.???.postponeByOneDay" wenn vorhanden löschen
                        adapter.delObjectAsync(`${resID}.countdown`),                           // "sprinklecontrol.0.sprinkle.???.countdown"
                        adapter.delObjectAsync(`${resID}.autoOn`),                              // "sprinklecontrol.0.sprinkle.???.autoOn"
                        adapter.delObjectAsync(`${resID}.history.lastOn`),                      //  "sprinklecontrol.0.sprinkle.???.history.lastOn"
                        adapter.delObjectAsync(`${resID}.history.lastConsumed`),                //  "sprinklecontrol.0.sprinkle.???.history.lastConsumed"
                        adapter.delObjectAsync(`${resID}.history.lastRunningTime`),             //  "sprinklecontrol.0.sprinkle.???.history.lastRunningTime"
                        adapter.delObjectAsync(`${resID}.history.curCalWeekConsumed`),          //  "sprinklecontrol.0.sprinkle.???.history.curCalWeekConsumed"
                        adapter.delObjectAsync(`${resID}.history.lastCalWeekConsumed`),         //  "sprinklecontrol.0.sprinkle.???.history.lastCalWeekConsumed"
                        adapter.delObjectAsync(`${resID}.history.curCalWeekRunningTime`),       //  "sprinklecontrol.0.sprinkle.???.history.curCalWeekRunningTime"
                        adapter.delObjectAsync(`${resID}.history.lastCalWeekRunningTime`)      //  "sprinklecontrol.0.sprinkle.???.history.lastCalWeekRunningTime"
                    ]
                    ).then(async ()=>{
                        // History - Objekt(Ordner.history) löschen
                        await adapter.delObjectAsync(`${resID}.history`);
                    }).then(async ()=>{
                        // Objekt(Ordner) löschen
                        await adapter.delObjectAsync(resID);
                    }).then(()=>{
                        adapter.log.info(`sprinkleControl [${resID}] was deleted`);
                    });
                } catch (e) {
                    adapter.log.warn(e);
                }
            }
        }
    }
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function main(adapter) {

	/* Auf die Adapterkonfiguration (im Instanz objekt alles unter dem Attribut "native") kann zugegriffen werden über adapter.config: */
    adapter.log.debug(`adapter.config.events: ${JSON.stringify(adapter.config.events)}`);
    /* Auf die Adapterkonfiguration (im Instanz objekt alles unter dem Attribut "native") kann zugegriffen werden über adapter.config */
    adapter.getForeignObject('system.config', (err, obj) => {
        if (obj) {
            checkStates();
        }
    });
    createSprinklers().catch((e) => adapter.log.warn(e));
    GetSystemData().catch((e) => adapter.log.warn(e));
    sendMessageText.initConfigMessage(adapter);
    evaporation.initEvaporation(adapter);        // init evaporation
    checkActualStates().catch((e) => adapter.log.warn(e));
    sunPos();
    timer = setTimeout(() => {
        startTimeSprinkle();
        addStartTimeSprinkle();
    }, 2000);

    /*
    * in this template all states changes inside the adapters namespace are subscribed
	* => In dieser Vorlage werden alle Statusänderungen im Namensraum des Adapters abonniert
	* adapter.subscribeStates('*');
	*/

    adapter.subscribeStates('control.autoOnOff');
    adapter.subscribeStates('control.autoStart');
    adapter.subscribeStates('control.Holiday');

    // Request a notification from a third-party adapter => Fordern Sie eine Benachrichtigung von einem Drittanbieter-Adapter an
    if (adapter.config.publicHolidays === true && (`${adapter.config.publicHolInstance}.heute.*`)) {
        adapter.subscribeForeignStates(`${adapter.config.publicHolInstance}.heute.*`);
    }
    if (adapter.config.publicHolidays === true && (`${adapter.config.publicHolInstance}.morgen.*`)) {
        adapter.subscribeForeignStates(`${adapter.config.publicHolInstance}.morgen.*`);
    }
    if (adapter.config.weatherForecast === true) {
        if (adapter.config.weatherForecastService === 'ownDataPoint') {
            weatherForecastTodayPfadStr = adapter.config.pathRainForecast;
            adapter.subscribeForeignStates(weatherForecastTodayPfadStr);
        } else if (adapter.config.weatherForecastService === 'dasWetter' && adapter.config.weatherForInstance) {
            weatherForecastTodayPfadStr = `${adapter.config.weatherForInstance}.NextDaysDetailed.Location_1.Day_1.rain_value`;
            adapter.subscribeForeignStates(weatherForecastTodayPfadStr);
            adapter.subscribeForeignStates(`${adapter.config.weatherForInstance}.NextDaysDetailed.Location_1.Day_2.rain_value`);
        } else {
            adapter.log.warn('There is no valid data record stored in the weather forecast, please correct it!');
        }
    }
    if (adapter.config.actualValueLevel !== '') {
        adapter.subscribeForeignStates(adapter.config.actualValueLevel);
    } else {
        adapter.setState('info.cisternState', { 
            val: 'The level sensor of the water cistern is not specified', 
            ack: true 
        });
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// ++++++++++++++++++ start option of Adapter ++++++++++++++++++++++
// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
