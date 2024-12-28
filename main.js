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
let startTimeStr = '';
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
        } catch (e) {
            callback();
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
        if (state) {
            // The state was changed → Der Zustand wurde geändert
            adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

            // wenn (Holiday == true) ist, soll das Wochenendprogramm gefahren werden.
            if (id === `${adapter.namespace  }.control.Holiday` && state.ack === false) {
                // @ts-ignore
                holidayStr = state.val;
                adapter.setState(id, {
                    val: state.val,
                    ack: true
                });
                startTimeSprinkle();
            }
            // wenn (addStartTimeSwitch == true) wird die zusätzliche Bewässerung aktiviert
            if (id === `${adapter.namespace}.control.addStartTimeSwitch` && typeof state.val === 'boolean' && state.ack === false) {
                addStartTimeSwitch = state.val;
                adapter.setState(id, {
                    val: state.val,
                    ack: true
                });
            }
            // wenn (autoOnOff == false) so werden alle Sprenger nicht mehr automatisch gestartet.
            if ((id === `${adapter.namespace  }.control.autoOnOff`) && (state.ack === false)) {
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
            // wenn (...sprinkleName.runningTime sich ändert) so wird der aktuelle Sprenger [sprinkleName]
            //    bei == 0 gestoppt, > 1 gestartet
            if (myConfig.config && !state.ack) {
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
                                val: state.val,
                                ack: true
                            });
                        }
                    }
                }
            }
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
            // wenn (...sprinkleName.autoOn == false[off])  so wird der aktuelle Sprenger [sprinkleName]
            //   bei false nicht automatisch gestartet
            if (myConfig.config && (typeof state.val === 'boolean') && (state.ack === false)) {
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
            if (idSplit[4] === `postponeByOneDay` && state.ack === false) {
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
                        adapter.log.info(`StateChange => Wettervorhersage state.val ( ${  state.val  }; ${  typeof state.val  } ) kann nicht als Number verarbeitet werden`);
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
            adapter.setState('control.Holiday', {val: false, ack: true});
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
                    adapter.log.info(`checkActualStates => Wettervorhersage state.val ( ${  _weatherForInstanceToday.val  }); ${  typeof _weatherForInstanceToday.val  } kann nicht als Number verarbeitet werden`);
                }
                await adapter.setStateAsync('info.rainToday',
                    weatherForecastTodayNum,
                    true
                );
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
                await adapter.setStateAsync(
                    'info.rainTomorrow',
                    weatherForecastTomorrowNum,
                    true
                );
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
                ).catch((e) => adapter.log.warn(e));
                if (_autoOn && typeof _autoOn.val === 'boolean') {
                    res.autoOn = _autoOn.val;
                    if (_autoOn.val === false) {
                        adapter.log.info(`get ${res.objectName}.autoOn = ${res.autoOn}`);
                    }
                }
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
                    adapter.getState(`sprinkle.${  objectName  }.history.curCalWeekConsumed`, (err, state) => {
                        if (state) {
                            adapter.setState(`sprinkle.${  objectName  }.history.lastCalWeekConsumed`, { val: state.val, ack: true });
                            adapter.setState(`sprinkle.${  objectName  }.history.curCalWeekConsumed`, { val: 0, ack: true });
                        }
                    });
                    adapter.getState(`sprinkle.${  objectName  }.history.curCalWeekRunningTime`, (err, state) => {
                        if (state) {
                            adapter.setState(`sprinkle.${  objectName  }.history.lastCalWeekRunningTime`, { val: state.val, ack: true });
                            adapter.setState(`sprinkle.${  objectName  }.history.curCalWeekRunningTime`, { val: '00:00', ack: true });
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
    sunriseStr = `${(`0${  times.sunrise.getHours()}`).slice(-2)  }:${  (`0${  times.sunrise.getMinutes()}`).slice(-2)}`;

    // format golden hour end time from the Date object → Formatiere golden hour end time aus dem Date-Objekt
    goldenHourEnd = `${(`0${  times.goldenHourEnd.getHours()}`).slice(-2)  }:${  (`0${  times.goldenHourEnd.getMinutes()}`).slice(-2)}`;

    // format sunset time from the Date object → formatieren Sie die Sonnenuntergangszeit aus dem Date-Objekt
    sunsetStr = sunsetStr = `${(`0${  times.sunset.getHours()}`).slice(-2)  }:${  (`0${  times.sunset.getMinutes()}`).slice(-2)}`;

}

function addStartTimeSprinkle() {
    schedule.cancelJob('sprinkleAddStartTime');
    if (adapter.config.selectAddStartTime === 'greaterETpCurrent' || adapter.config.selectAddStartTime === 'withExternalSignal') {
        const addStartTimeSplit = adapter.config.addWateringStartTime.split(':');
        const scheduleAddStartTime = schedule.scheduleJob('sprinkleAddStartTime', `${addStartTimeSplit[1]  } ${  addStartTimeSplit[0]  } * * *`, function() {
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
                                                    +  `   START => ${addTime(res.addWateringTime, '')}\n`;
                                        memAddList.push({
                                            auto: true,
                                            sprinkleID: res.sprinkleID,
                                            wateringTime: res.addWateringTime
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
        const myTime = `${myHours  }:${  myMinutes}`;

        /**
         * aus 0...9 wird String 00...09
         *
         * @param i
         * @returns
         */
        function checkTime(i) {
            return (+i < 10) ? `0${  i}` : i;
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

        const newStartTimeLong = `${myWeekdayStr[myWeekday]  } ${  newStartTime}`;
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
                        sendMessageText.sendMessage(`${infoMessage  }(${  myWeekdayStr[myWeekday]  }) um ${  newStartTime}`);
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

    const scheduleStartTime = schedule.scheduleJob('sprinkleStartTime', `${startTimeSplit[1]  } ${  startTimeSplit[0]  } * * *`, function() {
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
                messageText += `<b>${  res.objectName  }</b>`;
                switch (res.methodControlSM) {
                    case 'bistable':
                        messageText += ` (${  res.soilMoisture.bool  })\n`;
                        break;
                    case 'analog':
                        messageText += ` ${  res.soilMoisture.pct  }% (${  res.soilMoisture.pctTriggerIrrigation  }%)\n`;
                        break;
                    case 'fixDay':
                        messageText += ` (${  curNextFixDay(res.sprinkleID, true)  })\n`;
                        break;
                    case 'calculation':
                        messageText += ` ${  res.soilMoisture.pct  }% (${  res.soilMoisture.pctTriggerIrrigation  }%)\n`;
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
                                    messageText += `   START => ${  addTime(curWateringTime, '')  }\n`;
                                } else if (adapter.config.weatherForecast) {
                                    /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                    messageText += `   ` + `<i>` + `Start verschoben, da heute ${  weatherForecastTodayNum  }mm Niederschlag` + `</i> ` + `\n`;
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
                                    messageText += `   START => ${  addTime(Math.round(60*countdown), '')  }\n`;
                                } else if (adapter.config.weatherForecast) {
                                    /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                    messageText += `   ` + `<i>` + `Start verschoben, da heute ${  weatherForecastTodayNum  }mm Niederschlag` + `</i> ` + `\n`;
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
                                    messageText += `   START => ${  addTime(curWateringTime, '')  }\n`;
                                    if (res.startDay === 'threeRd'){          // Next Start in 3 Tagen
                                        res.startFixDay[today] = false;
                                        res.startFixDay[(+ today + 3 > 6) ? (+ today-4) : (+ today+3)] = true;
                                    }else if (res.startDay === 'twoNd') {     // Next Start in 2 Tagen
                                        res.startFixDay[today] = false;
                                        res.startFixDay[(+ today + 2 > 6) ? (+ today-5) : (+ today+2)] = true;
                                    }
                                }
                            } else if (adapter.config.weatherForecast){
                                messageText += `   ` + `<i>` + `Start verschoben, da heute ${  weatherForecastTodayNum  }mm Niederschlag` + `</i> ` + `\n`;
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
                                    messageText += `   START => ${  addTime(Math.round(60*countdown), '')  }\n`;
                                } else if (adapter.config.weatherForecast) {
                                    /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                    messageText += `   ` + `<i>` + `Start verschoben, da heute ${  weatherForecastTodayNum  }mm Niederschlag` + `</i> ` + `\n`;
                                    adapter.log.info(`${res.objectName}: Start verschoben, da Regenvorhersage für Heute ${weatherForecastTodayNum} mm [ ${res.soilMoisture.val.toFixed(1)} (${resMoisture.toFixed(1)}) <= ${res.soilMoisture.triggersIrrigation} ]`);
                                }
                            }
                            break;
                    }
                } else {
                    messageText += '   ' + '<i>' + 'Ventil auf Handbetrieb' + '</i>' + '\n';
                }
            }
            valveControl.addList(memAddList);
        }
        if(!sendMessageText.onlySendError()){
            sendMessageText.sendMessage(messageText);
        }
        setTimeout (() => {
            setTimeout(()=>{
                nextStartTime();
            }, 800);
            schedule.cancelJob('sprinkleStartTime');
        }, 200);
    });
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
                name:  'additional irrigation enabled',
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
                        nameMetConSM = `${objectName  } => Calculated soil moisture in %`;
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
                        nameMetConSM = `${objectName  } => bistable soil moisture sensor`;
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
                        nameMetConSM = `${objectName  } => analog soil moisture sensor in %`;
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
                        nameMetConSM = `${objectName  } => start on a fixed day`;
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
                        nameMetConSM = `${objectName  } => Emergency program! start on a fixed day`;
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
                    const _sprinkleNotExist = await adapter.setObjectNotExistsAsync(`sprinkle.${  objectName}`, {
                        type: 'channel',
                        common: {
                            name: res.sprinkleName
                        },
                        native: {},
                    });
                    // Create Object for .history
                    const _historyNotExist = await adapter.setObjectNotExistsAsync(`sprinkle.${  objectName  }.history`, {
                        type: 'channel',
                        common: {
                            name: `${res.sprinkleName} => History`
                        },
                        native: {},
                    });
                    // Create Object for .history.curCalWeekConsumed
                    // Sprinkler consumption of the current calendar week => History - Sprinkler-Verbrauch der aktuellen Kalenderwoche (783 Liter)
                    const _curCalWeekConsumedNotExist = adapter.setObjectNotExistsAsync(`${objPfad}.history.curCalWeekConsumed`, {
                        type: 'state',
                        common: {
                            role:  'state',
                            name:  `${objectName} => History - Sprinkler consumption of the current calendar week`,
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
                            name:  `${objectName} => History - Sprinkler running time of the current calendar week`,
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
                            name:  `${objectName} => History - Sprinkler consumption of the last calendar week`,
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
                            name:  `${objectName} => History - Sprinkler running time of the last calendar week`,
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
                            name:  `${objectName} => History - Last consumed of sprinkler`,
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
                            name:  `${objectName} => History - Last On of sprinkler`,
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
                            name:  `${objectName} => History - Last running time`,
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
                            name:  `${objectName} => Switch automatic mode on / off`,
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
                                name: `${objectName} Postpone start by one day`,
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
                            name:  `${objectName} => countdown of sprinkler`,
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
                            name:  `${objectName} => running time of sprinkler`,
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
                            name:  `${objectName} => actual state of sprinkler`,
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
                            name:  `${objectName} => Trigger point of sprinkler`,
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

                    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
                    // +++++                            zustände der States aktualisieren                       +++++ //
                    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //

                    //
                    if(await _countdownNotExist){
                        const _countdown = await adapter.getStateAsync(`${objPfad}.countdown`).catch((e) => adapter.log.warn(`${objectName}.countdown ${e}`));
                        if (_countdown && _countdown.val !== '0') {
                            adapter.setStateAsync(
                                `${objPfad}.countdown`,
                                '0',
                                true
                            ).catch((e) => adapter.log.warn(e));
                        }
                    }
                    //
                    if (_runningTimeNotExist) {
                        const _runningTime = await adapter.getStateAsync(`${objPfad}.runningTime`).catch((e) => adapter.log.warn(`${objectName}.runningTime ${e}`));
                        if (_runningTime && _runningTime.val !== '00:00') {
                            adapter.setStateAsync(`${objPfad}.runningTime`,
                                '00:00',
                                true
                            ).catch((e) => adapter.log.warn(e));
                        }
                    }
                    //
                    if (_sprinklerStateNotExists){
                        const _sprinklerState = await adapter.getStateAsync(`${objPfad}.sprinklerState`).catch((e) => adapter.log.warn(`${objectName}.sprinklerState ${e}`));
                        if (_sprinklerState && _sprinklerState.val !== 0) {
                            await adapter.setStateAsync(`${objPfad}.sprinklerState`,
                                0,
                                true
                            ).catch((e) => adapter.log.warn(`${objectName}.sprinklerState ${e}`));
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

                            adapter.setStateAsync(`${objPfad}.triggerPoint`,
                                '-',
                                true
                            ).catch((e) => adapter.log.warn(`${objectName}.triggerPoint ${e}`));
                            break;
                        }

                        case 'analog': {
                            // Sensor soil moisture => Sensor Bodenfeuchte
                            const _triggerSMAnalog = await adapter.getForeignStateAsync(myConfig.config[j].triggerSM).catch((e) => adapter.log.warn(`${objectName}.triggerSMAnalog ${e}`));
                            if (_triggerSMAnalog && (typeof _triggerSMAnalog.val === 'number' || typeof _triggerSMAnalog.val === 'string')) {
                                myConfig.setSoilMoistPct(myConfig.config[j].sprinkleID, _triggerSMAnalog.val);
                            } else {
                                await adapter.setStateAsync(`${objPfad}.actualSoilMoisture`,
                                    50,
                                    true
                                );
                                adapter.log.warn(`The analoge sensor ${myConfig.config[j].triggerSM} in ${objectName} does not deliver correct values!`);
                            }
                            adapter.setStateAsync(`${objPfad}.triggerPoint`,
                                (myConfig.config[j].soilMoisture.pctTriggerIrrigation).toString(),
                                true
                            ).catch((e) => adapter.log.warn(`${objectName}.triggerPoint setState ${e}`));
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

                            adapter.setStateAsync(`${objPfad}.triggerPoint`,
                                '-',
                                true
                            ).catch((e) => adapter.log.warn(`${objectName}.triggerPoint fixDay setState ${e}`));
                            break;
                        }

                        case 'calculation': {
                            const _actualSoilMoisture = await adapter.getStateAsync(`${objPfad}.actualSoilMoisture`).catch((e) => adapter.log.warn(e));
                            if (_actualSoilMoisture) {
                                if (await _actualSoilMoisture && typeof _actualSoilMoisture.val !== 'number' || _actualSoilMoisture.val === 0) {
                                    adapter.setStateAsync(`${objPfad}.actualSoilMoisture`,
                                        myConfig.config[j].soilMoisture.pct,
                                        true
                                    ).catch((e) => adapter.log.warn(e));
                                } else {
                                    // num Wert der Bodenfeuchte berechnen und in der config speichern, wenn Wert zwischen 0 und max liegt
                                    if ((0 < _actualSoilMoisture.val) && (_actualSoilMoisture.val <= (myConfig.config[j]).soilMoisture.maxRain*100/myConfig.config[j].soilMoisture.maxIrrigation)) {
                                        myConfig.config[j].soilMoisture.val = _actualSoilMoisture.val * myConfig.config[j].soilMoisture.maxIrrigation / 100;
                                        myConfig.config[j].soilMoisture.pct = _actualSoilMoisture.val;
                                    } else {
                                        // Wert aus config übernehmen
                                        adapter.setStateAsync(`${objPfad}.actualSoilMoisture`,
                                            myConfig.config[j].soilMoisture.pct,
                                            true
                                        ).catch((e) => adapter.log.warn(e));
                                    }
                                }
                            }

                            adapter.setStateAsync(`${objPfad}.triggerPoint`,
                                (myConfig.config[j].soilMoisture.pctTriggerIrrigation).toString(),
                                true
                            ).catch((e) => adapter.log.warn(e));
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

    //
    adapter.subscribeStates('control.*');

    //adapter.subscribeStates('info.Elevation');
    //adapter.subscribeStates('info.Azimut');

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
        adapter.setState('info.cisternState', { val: 'The level sensor of the water cistern is not specified', ack: true });
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
