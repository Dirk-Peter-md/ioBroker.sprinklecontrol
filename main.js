'use strict';
/*
 info:  log aufbau main.js: #0.*
 */
// Load your modules here, e.g.: => // Laden Sie Ihre Module hier, z.B.
// const fs = require("fs");

const utils = require('@iobroker/adapter-core');
const schedule  = require('node-schedule');
const SunCalc = require('suncalc2');

const sendMessageText = require('./lib/sendMessageText.js');            // sendMessageText
const valveControl = require('./lib/valveControl.js');                  // Steuerung der einzelnen Ventile
const myConfig = require('./lib/myConfig.js');                          // myConfig => Speichern und abrufen von Konfigurationsdaten der Ventile
const evaporation = require('./lib/evaporation.js');
const addTime = require('./lib/tools.js').addTime;
const formatTime = require('./lib/tools.js').formatTime;
//const trend = require('./lib/tools').trend;

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;
const adapterName = require('./package.json').name.split('.').pop();

/** ext. Adapter => Deutsche Feiertage
 *  @type {any} */
let publicHolidayStr;
/** @type {any} */
let publicHolidayTomorrowStr;
/* DasWetter.com */
/** @type {number}
 * - heutige Regenvorhersage in mm */
let weatherForecastTodayNum = 0;
/** @type {number}
 * - morgige Regenvorhersage in mm */
let weatherForecastTomorrowNum = 0;

/** @type {string} */
let startTimeStr;
/** @type {string} */
let sunriseStr;
/** @type {string} */
let goldenHourEnd;
/** switch => sprinklecontrol.*.control.Holiday
 *  - Wenn (Holiday == true) ist, soll das Wochenendprogramm gefahren werden.
 * @type {any} */
let holidayStr;
/** @type {any} */
let autoOnOffStr;
/** @type {string} */
let kwStr; // akt. KW der Woche
/** @type {number | undefined} */
let timer;
/** @type {number} */
let today;  // heutige Tag 0:So;1:Mo...6:Sa

/* memo */
/** @type {{}} */
let ObjSprinkle = {};

/**
 * +++++++++++++++++++++++++++ Starts the adapter instance ++++++++++++++++++++++++++++++++
 *
 * @param {Partial<ioBroker.AdapterOptions>} [options]
 */
function startAdapter(options) {

    options = options || {};
    Object.assign(options, { name: adapterName });

    adapter = new utils.Adapter(options);

    // start here!
    adapter.on('ready', () => main(adapter));

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
            /*Startzeiten der Timer löschen*/
            schedule.cancelJob('calcPosTimer');
            schedule.cancelJob('sprinkleStartTime');
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
     * @param {object} obj
     */
    adapter.on('message', (obj) => {
        if (obj) {
            switch (obj.command) {
                case 'getTelegramUser':
                    adapter.getForeignState(adapter.config.telegramInstance + '.communicate.users', (err, state) => {
                        err && adapter.log.error(err);
                        if (state && state.val) {
                            try {
                                adapter.log.info('getTelegramUser:' + state.val);
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
     * @param {string} id
     * @param {Object | null | undefined} obj
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
     * @param {string} id
     * @param {State | null | undefined} state
     */
    adapter.on('stateChange', (id, state) => {
        if (state) {
            // The state was changed => Der Zustand wurde geändert
            if (adapter.config.debug) {
                adapter.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
            }
            // wenn (Holiday == true) ist, soll das Wochenendprogramm gefahren werden.
            if (id === adapter.namespace + '.control.Holiday') {
                holidayStr = state.val;
                startTimeSprinkle();
            }
            // wenn (autoOnOff == false) so werden alle Sprenger nicht mehr automatisch gestartet.
            if (id === adapter.namespace + '.control.autoOnOff') {
                autoOnOffStr = state.val;
                adapter.log.info('startAdapter: control.autoOnOff: ' + state.val);
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
                                    wateringTime: (state.val <= 0) ? state.val : Math.round(60 * state.val)
                                }]);
                        }
                    }
                }
            }
            // wenn in der config unter methodControlSM !== 'analog' oder 'bistable' eingegeben wurde, dann Bodenfeuchte-Sensor auslesen
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
            if (myConfig.config && (typeof state.val === 'boolean')) {
                const found = myConfig.config.find(d => d.autoOnID === id);
                if (found && id === myConfig.config[found.sprinkleID].autoOnID) { myConfig.config[found.sprinkleID].autoOn = state.val; }
            }
            // Change in outside temperature => Änderung der Außentemperatur
            if (id === adapter.config.sensorOutsideTemperature) {	/*Temperatur*/
                if (!Number.isNaN(Number.parseFloat(state.val))) {
                    evaporation.setCurTemperature(parseFloat(state.val), state.ts);
                } else {
                    adapter.log.warn('sensorOutsideTemperature => Wrong value: '+ state.val + ', Type: ' + typeof state.val);
                }
            }
            // LuftFeuchtigkeit
            if (id === adapter.config.sensorOutsideHumidity) {
                if (!Number.isNaN(Number.parseFloat(state.val))) {
                    evaporation.setCurHumidity(parseFloat(state.val), state.lc);
                } else {
                    adapter.log.warn('sensorOutsideHumidity => Wrong value: '+ state.val + ', Type: ' + typeof state.val);
                }
            }
            // Helligkeit
            if (id === adapter.config.sensorBrightness) {
                if (!Number.isNaN(Number.parseFloat(state.val))) {
                    evaporation.setCurIllumination(parseFloat(state.val), state.lc);
                } else {
                    adapter.log.warn('sensorBrightness => Wrong value: '+ state.val + ', Type: ' + typeof state.val);
                }
            }
            // Windgeschwindigkeit
            if (id === adapter.config.sensorWindSpeed) {
                if (!Number.isNaN(Number.parseFloat(state.val))) {
                    evaporation.setCurWindSpeed(parseFloat(state.val), state.lc);
                } else {
                    adapter.log.warn('sensorWindSpeed => Wrong value: '+ state.val + ', Type: ' + typeof state.val);
                }
            }
            // Regencontainer
            // If the amount of rain is over 20 mm, the 'lastRainCounter' is overwritten and no calculation is carried out. =>
            //	* Wenn die Regenmenge mehr als 20 mm beträgt, wird der 'lastRainCounter' überschrieben und es wird keine Berechnung durchgeführt.
            if (id === adapter.config.sensorRainfall) {
                if (!Number.isNaN(Number.parseFloat(state.val))) {
                    evaporation.setCurAmountOfRain(parseFloat(state.val));
                } else {
                    adapter.log.warn('sensorRainfall => Wrong value: '+ state.val + ', Type: ' + typeof state.val);
                }
            }
            // Feiertagskalender
            if (adapter.config.publicHolidays === true) {
                if (id === adapter.config.publicHolInstance + '.heute.boolean') {
                    publicHolidayStr = state.val;
                    startTimeSprinkle();
                }
                if (id === adapter.config.publicHolInstance + '.morgen.boolean') {
                    publicHolidayTomorrowStr = state.val;
                    startTimeSprinkle();
                }
            }
            // Wettervorhersage
            if (adapter.config.weatherForecast === true) {
                if (id === adapter.config.weatherForInstance + '.NextDaysDetailed.Location_1.Day_1.rain_value') {
                    if (typeof state.val == 'string') {
                        weatherForecastTodayNum = parseFloat(state.val);
                    } else if (typeof state.val == 'number') {
                        weatherForecastTodayNum = state.val;
                    } else {
                        weatherForecastTodayNum = 0;
                        console.log.info('StateChange => Wettervorhersage state.val ( ' + state.val + '; ' + typeof state.val + ' ) kann nicht als Number verarbeitet werden');
                    }
                    adapter.setState('info.rainToday', {
                        val: weatherForecastTodayNum,
                        ack: true
                    });
                }
                if (id === adapter.config.weatherForInstance + '.NextDaysDetailed.Location_1.Day_2.rain_value') {
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
        } else {
            // The state was deleted
            adapter.log.info(`state ${id} deleted`);
        }
    });
}

// +++++++++++++++++ Get longitude an latitude from system config ++++++++++++++++++++
function GetSystemData() {
    /**get longitude/latitude from system if not set or not valid
     * do not change if we have already a valid value
     * so we could use different settings compared to system if necessary
     * >>>
     * Längen- / Breitengrad vom System abrufen, falls nicht festgelegt oder ungültig
     * Ändern Sie nicht, wenn wir bereits einen gültigen Wert haben
     * Daher können wir bei Bedarf andere Einstellungen als das System verwenden
     */
    if (typeof adapter.config.longitude === undefined || adapter.config.longitude == null || adapter.config.longitude.length === 0 || isNaN(adapter.config.longitude)
        || typeof adapter.config.latitude === undefined || adapter.config.latitude == null || adapter.config.latitude.length === 0 || isNaN(adapter.config.latitude)) {

        adapter.log.debug('longitude/longitude not set, get data from system ' + typeof adapter.config.longitude + ' ' + adapter.config.longitude + '/' + typeof adapter.config.latitude + ' ' + adapter.config.latitude);

        adapter.getForeignObject('system.config', (err, state) => {
            if (err) {
                adapter.log.error(err);
            } else {
                adapter.config.longitude = state.common.longitude;
                adapter.config.latitude = state.common.latitude;
                adapter.log.info('system  longitude ' + adapter.config.longitude + ' latitude ' + adapter.config.latitude);
            }
        });
    }
}

/**
 * Schreiben des nächsten Starts in .actualSoilMoisture
 * oder Rückgabe des DayName für den nächsten Start
 * @param {number} sprinkleID - Number of Array[0...]
 * @param {boolean} returnOn - true = Rückgabe des Wochentags; false = Schreiben in State .actualSoilMoisture
 * @returns {string} nextStart ['Sun','Mon','Tue','Wed','Thur','Fri','Sat']
 */
function curNextFixDay (sprinkleID, returnOn) {
    const weekDayArray = myConfig.config[sprinkleID].startFixDay;
    const objPfad = 'sprinkle.' + myConfig.config[sprinkleID].objectName;
    const weekday = ['Sun','Mon','Tue','Wed','Thur','Fri','Sat'];
    let curDay = formatTime(adapter, '', 'day');
    for ( let i=0; i<7; i++ ) {
        curDay++;
        if (curDay > 6) {curDay = curDay - 7;}
        if (weekDayArray[curDay] === true) {
            if (returnOn) {
                return weekday[curDay];
            } else {
                adapter.setState(objPfad + '.actualSoilMoisture', {
                    val: curDay,
                    ack: true
                });
            }
            break;
        }
    }
}

//
/**
 * Sets the status at start to a defined value
 * => Setzt den Status beim Start auf einen definierten Wert
 */
function checkStates() {
    //
    /**
     * control.Holiday
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
     * @param {string|null} err
     * @param {ioBroker.State|null|undefined} state
     */
    adapter.getState('control.autoOnOff', (err, state) => {
        if (state && (state.val == null)) {
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
function checkActualStates () {
    /**
     * switch Holiday
     * @param {string|null} err
     * @param {ioBroker.State|null|undefined} state
     */
    adapter.getState('control.Holiday', (err, state) => {
        if (state) {
            holidayStr = state.val;
        }
    });

    /**
     * switch autoOnOff
     * @param {string|null} err
     * @param {ioBroker.State|null|undefined} state
     */
    adapter.getState('control.autoOnOff', (err, state) => {
        if (state) {
            autoOnOffStr = state.val;
        }
    });

    //
    if (adapter.config.publicHolidays === true && (adapter.config.publicHolInstance !== 'none' || adapter.config.publicHolInstance !== '')) {
        /**
         * Feiertag HEUTE
         * @param {string|null} err
         * @param {ioBroker.State|null|undefined} state
         */
        adapter.getForeignState(adapter.config.publicHolInstance + '.heute.boolean', (err, state) => {
            if (state) {
                publicHolidayStr = state.val;
            }
        });
        /**
         * Feiertag MORGEN
         * @param {string|null} err
         * @param {ioBroker.State|null|undefined} state
         */
        adapter.getForeignState(adapter.config.publicHolInstance + '.morgen.boolean', (err, state) => {
            if (state) {
                publicHolidayTomorrowStr = state.val;
            }
        });
    }

    if (adapter.config.weatherForecast === true && (adapter.config.weatherForInstance !== 'none' || adapter.config.weatherForInstance !== '')) {
        /**
         * Niederschlagsmenge HEUTE in mm
         * @param {string|null} err
         * @param {ioBroker.State|null|undefined} state
         */
        adapter.getForeignState(adapter.config.weatherForInstance + '.NextDaysDetailed.Location_1.Day_1.rain_value', (err, state) => {
            if (state) {
                if (typeof state.val == 'string') {
                    weatherForecastTodayNum = parseFloat(state.val);
                } else if (typeof state.val == 'number') {
                    weatherForecastTodayNum = state.val;
                } else {
                    weatherForecastTodayNum = 0;
                    console.log.info('checkActualStates => Wettervorhersage state.val ( ' + state.val + '; ' + typeof state.val + ' ) kann nicht als Number verarbeitet werden');
                }
                adapter.setState('info.rainToday', {
                    val: weatherForecastTodayNum,
                    ack: true
                });
            }
        });
        /**
         * Niederschlagsmenge MORGEN in mm
         * @param {string|null} err
         * @param {ioBroker.State|null|undefined} state
         */
        adapter.getForeignState(adapter.config.weatherForInstance, (err, state) => {
            if (state) {
                weatherForecastTomorrowNum = state.val;
                adapter.setState('info.rainTomorrow', {
                    val: weatherForecastTomorrowNum,
                    ack: true
                });
            }
        });
    }

    /**
     * Füllstand der Zisterne in %
     * @param {string|null} err
     * @param {ioBroker.State|null|undefined} state
     */
    adapter.getForeignState(adapter.config.actualValueLevel, (err, state) => {
        if (typeof state !== undefined && state != null) {
            valveControl.setFillLevelCistern(parseFloat(state.val));
        }
    });

    /**
     * rückgabe der gespeicherten Objekte unter sprinkle.*
     * @param {string|null} err
     * @param {Object|undefined} list
     */
    adapter.getForeignObjects(adapter.namespace + '.sprinkle.*', 'channel',
        function (err, list) {
            if (err) {
                adapter.log.error(err);
            } else {
                ObjSprinkle = list;
            }
        });	
	
    //
    setTimeout(()=>{
        createSprinklers();
    },1000);
    setTimeout(() => {
        startTimeSprinkle();
    }, 2000);
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

    // History Daten aktualisieren wenn eine neue Woche beginnt
    if (adapter.config.debug) {adapter.log.info('calcPos 0:05 old-KW: ' + kwStr + ' new-KW: ' + formatTime(adapter, '','kW') + ' if: ' + (kwStr !== formatTime(adapter, '','kW')));}
    if (kwStr !== formatTime(adapter, '','kW')) {
        const result = myConfig.config;
        if (result) {	
            for(const i in result) {
                if (result.hasOwnProperty(i)) {
                    const objectName = result[i].objectName;
                    adapter.getState('sprinkle.' + objectName + '.history.curCalWeekConsumed', (err, state) => {
                        if (state) {
                            adapter.setState('sprinkle.' + objectName + '.history.lastCalWeekConsumed', { val: state.val, ack: true });
                            adapter.setState('sprinkle.' + objectName + '.history.curCalWeekConsumed', { val: 0, ack: true });
                        }
                    });
                    adapter.getState('sprinkle.' + objectName + '.history.curCalWeekRunningTime', (err, state) => {
                        if (state) {
                            adapter.setState('sprinkle.' + objectName + '.history.lastCalWeekRunningTime', { val: state.val, ack: true });
                            adapter.setState('sprinkle.' + objectName + '.history.curCalWeekRunningTime', { val: '00:00', ack: true });
                        }
                    });
                }

            }
        }
        kwStr = formatTime(adapter, '','kW');
    }

    // ETpToday und ETpYesterday in evaporation aktualisieren da ein neuer Tag
    evaporation.setNewDay();
	
    // Startzeit Festlegen => verzögert wegen Daten von SunCalc
    setTimeout(() => {
        startTimeSprinkle();
    },1000);
    
});

// Berechnung mittels sunCalc
function sunPos() {
    // get today's sunlight times => Holen Sie sich die heutige Sonnenlicht Zeit	
    const times = SunCalc.getTimes(new Date(), adapter.config.latitude, adapter.config.longitude);
	
    // format sunrise time from the Date object => Formatieren Sie die Sonnenaufgangszeit aus dem Date-Objekt
    sunriseStr = ('0' + times.sunrise.getHours()).slice(-2) + ':' + ('0' + times.sunrise.getMinutes()).slice(-2);

    // format golden hour end time from the Date object => Formatiere golden hour end time aus dem Date-Objekt
    goldenHourEnd = ('0' + times.goldenHourEnd.getHours()).slice(-2) + ':' + ('0' + times.goldenHourEnd.getMinutes()).slice(-2);
	
}

// Determination of the irrigation time => Bestimmung der Bewässerungszeit
function startTimeSprinkle() {
    let startTimeSplit = [];
    let infoMessage;
    let messageText = '';

    schedule.cancelJob('sprinkleStartTime'); 

    // if autoOnOff == false => keine auto Start
    if (!autoOnOffStr) {
        if (adapter.config.debug) {adapter.log.info('Sprinkle: autoOnOff == Aus(' + autoOnOffStr + ')');}
        adapter.setState('info.nextAutoStart', { val: 'autoOnOff = off(0)', ack: true });
        return;
    }

    /**
     * next start time (automatic)
     * => Berechnung des nächsten Starts (Automatik)
     * @returns {string}
     */
    function nextStartTime () {
        let newStartTime;
        let run = 0;
        const curTime = new Date();
        const myHours = checkTime(curTime.getHours());
        const myMinutes = checkTime(curTime.getMinutes());
        let myWeekday = curTime.getDay();
        const myWeekdayStr = ['So','Mo','Di','Mi','Do','Fr','Sa'];
        const myTime = myHours + ':' + myMinutes;

        /**
         * aus 0...9 wird String 00...09
         * @param {string|number} i
         * @returns {string}
         */
        function checkTime(i) {
            return (i < 10) ? '0' + i : i;
        }

        do {
            myWeekday += run;
            run++;
            if (myWeekday>6){myWeekday=0;}
            // Start time variant according to configuration => Startzeitvariante gemäß Konfiguration
            switch(adapter.config.wateringStartTime) {
                case 'livingTime' :				/*Startauswahl = festen Zeit*/
                    infoMessage = 'Start zur festen Zeit ';
                    newStartTime = adapter.config.weekLiving;
                    break;
                case 'livingSunrise' :			/*Startauswahl = Sonnenaufgang*/
                    infoMessage = 'Start mit Sonnenaufgang ';
                    // format sunset/sunrise time from the Date object
                    newStartTime = addTime(sunriseStr, parseInt(adapter.config.timeShift));
                    break;
                case 'livingGoldenHourEnd' :	/*Startauswahl = Ende der Golden Hour*/
                    infoMessage = 'Start zum Ende der Golden Hour ';
                    // format goldenHourEnd time from the Date object
                    newStartTime = goldenHourEnd;
                    break;
            }
            // Start am Wochenende => wenn andere Zeiten verwendet werden soll
            if((adapter.config.publicWeekend) && ((myWeekday) === 6 || (myWeekday) === 0)){
                infoMessage = 'Start am Wochenende ';
                newStartTime = adapter.config.weekEndLiving;
            }
            // Start an Feiertagen => wenn Zeiten des Wochenendes verwendet werden soll
            if((adapter.config.publicHolidays) && (adapter.config.publicWeekend)
                && (((publicHolidayStr === true) && (run === 1))            // heute Feiertag && erster Durchlauf
                || ((publicHolidayTomorrowStr === true) && (run === 2))     // morgen Feiertag && zweiter Durchlauf
                || (holidayStr === true))) {                                // Urlaub
                infoMessage = 'Start am Feiertag ';
                newStartTime = adapter.config.weekEndLiving;
            }
        } while ((newStartTime <= myTime) && (run === 1));

        const newStartTimeLong = myWeekdayStr[myWeekday] + ' ' + newStartTime;
        /**
         * next Auto-Start
         * @param {string|null} err
         * @param {State|null|undefined} state
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
                        sendMessageText.sendMessage(infoMessage + '(' + myWeekdayStr[myWeekday] + ') um ' + newStartTime);
                    }
                    adapter.log.info(infoMessage + '(' + myWeekdayStr[myWeekday] + ') um ' + newStartTime);
                }
            }
        });
        return newStartTime;
    }
    //
    startTimeStr = nextStartTime();
    startTimeSplit = startTimeStr.split(':');

    const scheduleStartTime = schedule.scheduleJob('sprinkleStartTime', startTimeSplit[1] + ' ' + startTimeSplit[0] + ' * * *', function() {
        // Filter enabled
        const result = myConfig.config.filter(d => d.enabled === true);
        if (result) {
            /**
             * Array zum flüchtigen Sammeln von Bewässerungsaufgaben
             * @type {Array.<{auto: Boolean, sprinkleID: Number, wateringTime: Number}>}
             */
            const memAddList = [];

            /**
             * result Rain
             * - (aktuelle Wettervorhersage - Schwellwert der Regenberücksichtigung) wenn Sensor sich im Freien befindet
             * - (> 0) es Regnet - Abbruch -
             * - (<= 0) Start der Bewässerung
             * @param {boolean} inGreenhouse - Sensor befindet sich im Gewächshaus
             * @returns {number} - resultierende Regenmenge
             */
            function resRain (inGreenhouse) {
                return (adapter.config.weatherForecast && !inGreenhouse) ? (((+ weatherForecastTodayNum) - parseFloat(adapter.config.thresholdRain)).toFixed(1)) : 0;
            }

            for(const res of result) {
                messageText += '<b>' + res.objectName + '</b>';
                switch (res.methodControlSM) {
                    case 'bistable':
                        messageText += ' (' + res.soilMoisture.bool + ')\n';
                        break;
                    case 'analog':
                        messageText += ' ' + res.soilMoisture.pct + '% (' + res.soilMoisture.pctTriggerIrrigation + '%)\n';
                        break;
                    case 'fixDay':
                        messageText += ' (' + curNextFixDay(res.sprinkleID, true) + ')\n';
                        break;
                    case 'calculation':
                        messageText += ' ' + res.soilMoisture.pct + '% (' + res.soilMoisture.pctTriggerIrrigation + '%)\n';
                        break;
                }

                // Test Bodenfeuchte
                if (adapter.config.debug) {adapter.log.info('Bodenfeuchte: ' + res.soilMoisture.val + ' <= ' + res.soilMoisture.triggersIrrigation + ' AutoOn: ' + res.autoOn);}
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
                                    messageText += '   START => ' + addTime(curWateringTime, '') + '\n';
                                } else if (adapter.config.weatherForecast) {
                                    /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                    messageText += '   ' + '<i>' + 'Start verschoben, da heute ' + weatherForecastTodayNum + 'mm Niederschlag' + '</i> ' + '\n';
                                    adapter.log.info(res.objectName + ': Start verschoben, da Regenvorhersage für Heute ' + weatherForecastTodayNum +' mm [ ' + resRain(res.inGreenhouse) + ' > 0 ]');
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
                                    if (countdown > (res.wateringTime * res.wateringAdd / 100)) {countdown = res.wateringTime * res.wateringAdd / 100;}
                                    memAddList.push({
                                        auto: true,
                                        sprinkleID: res.sprinkleID,
                                        wateringTime: Math.round(60* countdown)
                                    });
                                    messageText += '   START => ' + addTime(Math.round(60*countdown), '') + '\n';
                                } else if (adapter.config.weatherForecast) {
                                    /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                    messageText += '   ' + '<i>' + 'Start verschoben, da heute ' + weatherForecastTodayNum + 'mm Niederschlag' + '</i> ' + '\n';
                                    adapter.log.info(res.objectName + ': Start verschoben, da Regenvorhersage für Heute ' + weatherForecastTodayNum +' mm [ ' + resRain(res.inGreenhouse) + ' > 0 ]');
                                }
                            }
                            break;
                        // --- fixDay  --  Start an festen Tagen ohne Sensoren  --- //
                        //  --              Bewässerungstag erreicht                //
                        case 'fixDay':
                            if (res.startFixDay[today]) {
                                /* Wenn in der Config Regenvorhersage aktiviert: Startvorgang abbrechen, wenn der Regen den eingegebenen Schwellwert überschreitet. */
                                if (resRain(false) <= 0) {
                                    const curWateringTime = Math.round(60 * res.wateringTime * evaporation.timeExtension(res.wateringAdd));
                                    memAddList.push({
                                        auto: true,
                                        sprinkleID: res.sprinkleID,
                                        wateringTime: curWateringTime
                                    });
                                    messageText += '   START => ' + addTime(curWateringTime, '') + '\n';
                                    if (res.startDay === 'threeRd'){          // Next Start in 3 Tagen
                                        res.startFixDay[today] = false;
                                        res.startFixDay[(+ today + 3 > 6) ? (+ today-4) : (+ today+3)] = true;
                                    }else if (res.startDay === 'twoNd') {     // Next Start in 2 Tagen
                                        res.startFixDay[today] = false;
                                        res.startFixDay[(+ today + 2 > 6) ? (+ today-5) : (+ today+2)] = true;
                                    }
                                } else if (adapter.config.weatherForecast){
                                    messageText += '   ' + '<i>' + 'Start verschoben, da heute ' + weatherForecastTodayNum + 'mm Niederschlag' + '</i> ' + '\n';
                                    adapter.log.info(res.objectName + ': Start verschoben, da Regenvorhersage für Heute ' + weatherForecastTodayNum +' mm [ ' + resRain(false) + ' > 0 ]');
                                    res.startFixDay[today] = false;
                                    res.startFixDay[(+ today + 1 > 6) ? (+ today-6) : (+ today+1)] = true;
                                }
                                curNextFixDay(res.sprinkleID, false);
                            }
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
                                    if (countdown > (res.wateringTime * res.wateringAdd / 100)) {countdown = res.wateringTime * res.wateringAdd / 100;}
                                    memAddList.push({
                                        auto: true,
                                        sprinkleID: res.sprinkleID,
                                        wateringTime: Math.round(60*countdown)
                                    });
                                    messageText += '   START => ' + addTime(Math.round(60*countdown), '') + '\n';
                                } else if (adapter.config.weatherForecast) {
                                    /* Bewässerung unterdrückt da ausreichende Regenvorhersage */
                                    messageText += '   ' + '<i>' + 'Start verschoben, da heute ' + weatherForecastTodayNum + 'mm Niederschlag' + '</i> ' + '\n';
                                    adapter.log.info(res.objectName + ': Start verschoben, da Regenvorhersage für Heute ' + weatherForecastTodayNum +' mm [ ' + res.soilMoisture.val + ' (' + resMoisture + ') <= ' + res.soilMoisture.triggersIrrigation + ' ]');
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
function createSprinklers() {
    const result = adapter.config.events;
    if (result) {	
        for(const res of result) {
            const objectName = res.sprinkleName.replace(/[.;, ]/g, '_');
            const objPfad = 'sprinkle.' + objectName;
            const j = myConfig.config.findIndex(d => d.objectName === objectName);
            // Create Object for sprinklers (ID)
            adapter.setObjectNotExists('sprinkle.' + objectName, {
                'type': 'channel',
                'common': {
                    'name': res.sprinkleName
                },
                'native': {},
            });
            // Create Object for sprinklers (ID)
            adapter.setObjectNotExists('sprinkle.' + objectName + '.history', {
                'type': 'channel',
                'common': {
                    'name': res.sprinkleName + ' => History'
                },
                'native': {},
            });
            // actual soil moisture
            // Create bzw. update .actualSoilMoisture nach der Sensorart
            /**
             * Aufbau des Objects .actualSoilMoisture
             * @type {Object}
             */
            let myObj = {};
            /** @type {string} */
            let objName;

            switch (res.methodControlSM) {
                case 'calculation':
                    objName = objectName + ' => Calculated soil moisture in %';
                    myObj = {
                        'type': 'state',
                        'common': {
                            'role': 'state',
                            'name': objName,
                            'type': 'number',
                            'min': 0,
                            'max': 150,
                            'unit': '%',
                            'read': true,
                            'write': false
                        },
                        'native': {},
                    };
                    break;
                case 'bistable':
                    objName = objectName + ' => bistable soil moisture sensor';
                    myObj = {
                        'type': 'state',
                        'common': {
                            'role': 'state',
                            'name': objName,
                            'type': 'boolean',
                            'read': true,
                            'write': false,
                            'def': false
                        },
                        'native': {},
                    };
                    break;
                case 'analog':
                    objName = objectName + ' => analog soil moisture sensor in %';
                    myObj = {
                        'type': 'state',
                        'common': {
                            'role': 'state',
                            'name': objName,
                            'type': 'number',
                            'min': 0,
                            'max': 150,
                            'unit': '%',
                            'read': true,
                            'write': false
                        },
                        'native': {},
                    };
                    break;
                case 'fixDay':
                    objName = objectName + ' => start on a fixed day';
                    myObj = {
                        'type': 'state',
                        'common': {
                            'role':  'state',
                            'name':  objName,
                            'type':  'number',
                            'min': 0,
                            'max': 7,
                            'states': '0:Sun;1:Mon;2:Tue;3:Wed;4:Thur;5:Fri;6:Sat;7:off',
                            'read':  true,
                            'write': false,
                            'def': 7
                        },
                        'native': {},
                    };
                    break;
            }
            adapter.setObjectNotExists(objPfad + '.actualSoilMoisture', myObj);
            let myName;
            setTimeout (()=> {
                adapter.getObject(objPfad + '.actualSoilMoisture', function (err, obj) {
                    if (err || !obj) {
                        adapter.log.error(objPfad + '.actualSoilMoisture, getObject => err: ' + err);
                    } else {
                        if((typeof obj.common.name === 'string') && obj.common.name.length > 0) {myName = obj.common.name;}
                    }
                });
                setTimeout(()=>{
                    if (myName !== objName) {   // bei Änderung der "Methode zur Kontrolle der Bodenfeuchtigkeit" aktualisiere das Objekt
                        adapter.setObject(objPfad + '.actualSoilMoisture', myObj);
                    }
                },200);
            }, 100);

            // Trigger point of sprinkler => Schaltpunkt der Bodenfeuchte
            adapter.setObjectNotExists(objPfad + '.triggerPoint', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => Trigger point of sprinkler',
                    'type':  'string',
                    'read':  true,
                    'write': false,
                    'def':   '-'
                },
                'native': {},
            });
            // actual state of sprinkler => Zustand des Ventils im Thread
            // <<< 1  = warten >>> ( 0:off; 1:wait; 2:on; 3:break; 4:Boost(on); 5:off(Boost) )
            // Create .sprinklerState
            adapter.setObjectNotExists(objPfad + '.sprinklerState', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => actual state of sprinkler',
                    'type':  'number',
                    'min':	0,
                    'max':	5,
                    'states': '0:off;1:wait;2:on;3:break;4:Boost(on);5:off(Boost)',
                    'read':  true,
                    'write': false,
                    'def':   0
                },
                'native': {},
            });
            // running time of sprinkler => Laufzeit des Ventils
            adapter.setObjectNotExists(objPfad + '.runningTime', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => running time of sprinkler',
                    'type':  'string',
                    'read':  true,
                    'write': true,
                    'def':   '-'
                },
                'native': {},
            });
            // countdown of sprinkler => Countdown des Ventils
            adapter.setObjectNotExists(objPfad + '.countdown', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => countdown of sprinkler',
                    'type':  'string',
                    'read':  true,
                    'write': false,
                    'def':   '-'
                },
                'native': {},
            });
            // autoOn
            adapter.setObjectNotExists(objPfad + '.autoOn', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => Switch automatic mode on / off',
                    'type':  'boolean',
                    'read':  true,
                    'write': true,
                    'def':   true
                },
                'native': {},
            });
            // History - Last running time of sprinkler => History - Letzte Laufzeit des Ventils (0 sek, 47:00 min, 1:03:45 )
            adapter.setObjectNotExists(objPfad + '.history.lastRunningTime', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => History - Last running time',
                    'type':  'string',
                    'read':  true,
                    'write': false,
                    'def':   '00:00'
                },
                'native': {},
            });
            // History - Last On of sprinkler => History - Letzter Start des Ventils (30.03 06:30)
            adapter.setObjectNotExists(objPfad + '.history.lastOn', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => History - Last On of sprinkler',
                    'type':  'string',
                    'read':  true,
                    'write': false,
                    'def':   '-'
                },
                'native': {},
            });
            // History - Last consumed of sprinkler => History - Letzte Verbrauchsmenge des Ventils (783 Liter)
            adapter.setObjectNotExists(objPfad + '.history.lastConsumed', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => History - Last consumed of sprinkler',
                    'type':  'number',
                    'unit':  'Liter',
                    'read':  true,
                    'write': false,
                    'def':   0
                },
                'native': {},
            });
            // History - Sprinkler consumption of the current calendar week => History - Sprinkler-Verbrauch der aktuellen Kalenderwoche (783 Liter)
            adapter.setObjectNotExists(objPfad + '.history.curCalWeekConsumed', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => History - Sprinkler consumption of the current calendar week',
                    'type':  'number',
                    'unit':  'Liter',
                    'read':  true,
                    'write': false,
                    'def':   0
                },
                'native': {},
            });
            // History - Sprinkler consumption of the last calendar week => History - Sprinkler-Verbrauch der letzten Kalenderwoche (783 Liter)
            adapter.setObjectNotExists(objPfad + '.history.lastCalWeekConsumed', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => History - Sprinkler consumption of the last calendar week',
                    'type':  'number',
                    'unit':  'Liter',
                    'read':  true,
                    'write': false,
                    'def':   0
                },
                'native': {},
            });
            // History - Sprinkler running time of the current calendar week => History - Sprinkler-Laufzeit der aktuellen Kalenderwoche (783 Liter)
            adapter.setObjectNotExists(objPfad + '.history.curCalWeekRunningTime', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => History - Sprinkler running time of the current calendar week',
                    'type':  'string',
                    'read':  true,
                    'write': false,
                    'def':   '00:00'
                },
                'native': {},
            });
            // History - Sprinkler running time of the last calendar week => History - Sprinkler-Laufzeit der letzten Kalenderwoche (783 Liter)
            adapter.setObjectNotExists(objPfad + '.history.lastCalWeekRunningTime', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => History - Sprinkler running time of the last calendar week',
                    'type':  'string',
                    'read':  true,
                    'write': false,
                    'def':   '00:00'
                },
                'native': {},
            });

            setTimeout(() => {
                switch (myConfig.config[j].methodControlSM) {
                    case 'bistable':
                        if(myConfig.config[j].triggerSM.length > 5) {
                            adapter.getForeignState(myConfig.config[j].triggerSM, (err,state) => {
                                if (typeof state !== undefined && typeof state.val === 'boolean') {
                                    myConfig.setSoilMoistBool(myConfig.config[j].sprinkleID, state.val);
                                }
                            });
                        }
                        adapter.setState(objPfad + '.triggerPoint', {
                            val: '-',
                            ack: true
                        });
                        break;

                    case 'analog':
                        if (myConfig.config[j].triggerSM.length > 5) {
                            adapter.getForeignState(myConfig.config[j].triggerSM, (err,state) => {
                                if (typeof state !== undefined && state.val) {
                                    myConfig.setSoilMoistPct(myConfig.config[j].sprinkleID, state.val);
                                }
                            });
                        }
                        adapter.setState(objPfad + '.triggerPoint', {
                            val: (myConfig.config[j].soilMoisture.pctTriggerIrrigation).toString(),
                            ack: true
                        });
                        break;

                    case 'fixDay':

                        /** @type {number} */
                        const nextStartDay = ((today + 1) > 6 ? 0 : (today + 1));

                        /**
                         * Neuen Start-Tag für Dreitage- und Zweitage-modus setzen
                         * @param {boolean} threeRd - Dreitage-modus Ja/Nein
                         *     true => Dreitage-modus (treeRD)
                         *     false => Zweitage-modus (twoNd)
                         */
                        function setNewDay (threeRd) {
                            const today = formatTime(adapter,'', 'day');
                            adapter.getState(objPfad + '.actualSoilMoisture', (err, state) => {
                                if (state && (typeof state.val === 'number')) {
                                    if ((state.val >= 0) && (state.val <= 6)) {
                                        if ((threeRd)
                                            && (state.val === (((today + 3) > 6) ? 2 : (today + 3)))
                                            || (state.val === (((today + 2) > 6) ? 1 : (today + 2)))
                                            || (state.val === (((today + 1) > 6) ? 0 : (today + 1)))
                                            || (state.val === today)) {
                                            myConfig.config[j].startFixDay[state.val] = true;
                                        } else {
                                            myConfig.config[j].startFixDay[nextStartDay] = true;
                                        }
                                    } else {
                                        myConfig.config[j].startFixDay[nextStartDay] = true;
                                    }
                                    curNextFixDay(myConfig.config[j].sprinkleID, false);
                                }
                            });

                        }

                        if (myConfig.config[j].startDay === 'threeRd') {
                            setNewDay(true);
                        } else if (myConfig.config[j].startDay === 'twoNd') {
                            setNewDay(false);
                        } else if (myConfig.config[j].startDay === 'fixDay') {
                            adapter.log.info('set Day (fixDay): ' + myConfig.config[j].objectName);
                            curNextFixDay(myConfig.config[j].sprinkleID, false);
                        }

                        adapter.setState(objPfad + '.triggerPoint', {
                            val: '-',
                            ack: true
                        });
                        break;

                    case 'calculation':
                        adapter.getState(objPfad + '.actualSoilMoisture', (err, state) => {
                            if (state == null || typeof state.val !== 'number' || state.val === 0) {
                                adapter.setState(objPfad + '.actualSoilMoisture', {
                                    val: myConfig.config[j].soilMoisture.pct,
                                    ack: true
                                });
                            } else {
                                // num Wert der Bodenfeuchte berechnen und der config speichern wenn Wert zwischen 0 und max liegt
                                if ((0 < state.val) && (state.val <= (myConfig.config[j]).soilMoisture.maxRain*100/myConfig.config[j].soilMoisture.maxIrrigation)) {
                                    myConfig.config[j].soilMoisture.val = state.val * myConfig.config[j].soilMoisture.maxIrrigation / 100;
                                    myConfig.config[j].soilMoisture.pct = state.val;
                                } else {
                                    // Wert aus config übernehmen
                                    adapter.setState(objPfad + '.actualSoilMoisture', {
                                        val: myConfig.config[j].soilMoisture.pct,
                                        ack: true
                                    });
                                }
                            }
                        });
                        adapter.setState(objPfad + '.triggerPoint', {
                            val: (myConfig.config[j].soilMoisture.pctTriggerIrrigation).toString(),
                            ack: true
                        });
                        break;
                }

                adapter.getState(objPfad + '.sprinklerState', (err, state) => {
                    if (state) {
                        adapter.setState(objPfad + '.sprinklerState', {val: 0, ack: true});
                    }
                });
                adapter.getState(objPfad + '.runningTime', (err, state) => {
                    if (state) {
                        adapter.setState(objPfad + '.runningTime', {val: '00:00', ack: true});
                    }
                });
                adapter.getState(objPfad + '.countdown', (err, state) => {
                    if (state) {
                        adapter.setState(objPfad + '.countdown', {val: '0', ack: true});
                    }
                });
                adapter.getState(objPfad + '.autoOn', (err, state) => {
                    if (state) {
                        if (typeof state.val === 'boolean' && ((new Date () - state.ts) > 60000)) {
                            myConfig.config[j].autoOn = state.val;
                        } else {
                            adapter.setState(objPfad + '.autoOn', {val: true, ack: true});
                            myConfig.config[j].autoOn = true;
                        }
                    }
                });
                // history		
                adapter.getState(objPfad + '.history.lastRunningTime', (err, state) => {
                    if (typeof state === 'object' && typeof state.val !== 'string') {
                        adapter.setState(objPfad + '.history.lastRunningTime', {val: '00:00', ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.lastOn', (err, state) => {
                    if (typeof state === 'object' && typeof state.val !== 'string') {
                        adapter.setState(objPfad + '.history.lastOn', {val: '-', ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.lastConsumed', (err, state) => {
                    if (typeof state === 'object' && typeof state.val !== 'number') {
                        adapter.setState(objPfad + '.history.lastConsumed', {val: 0, ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.curCalWeekConsumed', (err, state) => {
                    if (typeof state === 'object' && typeof state.val !== 'number') {
                        adapter.setState(objPfad + '.history.curCalWeekConsumed', {val: 0, ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.lastCalWeekConsumed', (err, state) => {
                    if (typeof state === 'object' && typeof state.val !== 'number') {
                        adapter.setState(objPfad + '.history.lastCalWeekConsumed', {val: 0, ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.curCalWeekRunningTime', (err, state) => {
                    if (typeof state === 'object' && typeof state.val !== 'string') {
                        adapter.setState(objPfad + '.history.curCalWeekRunningTime', {val: '00:00', ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.lastCalWeekRunningTime', (err, state) => {
                    if (typeof state === 'object' && typeof state.val !== 'string') {
                        adapter.setState(objPfad + '.history.lastCalWeekRunningTime', {val: '00:00', ack: true});
                    }
                });
            },1500);
        }
        // delete old sprinkle
        for(const i in ObjSprinkle) {

            const resID = ObjSprinkle[i]._id;
            const objectID = resID.split('.');
            const resultID = objectID[3];

            const resultName = result.map(({ sprinkleName }) => ({ sprinkleName }));
            const fullRes = [];
			
            for(const i in resultName) {
                if (resultName.hasOwnProperty(i)) {
                    const res = resultName[i].sprinkleName.replace(/[.;, ]/g, '_');
                    fullRes.push(res);
                }
            }
            setTimeout(() => {

                if (fullRes.indexOf(resultID) === -1) {
                    // History - Objekt(Ordner) löschen					
                    adapter.delObject(resID + '.history', function (err) {
                        if (err) {
                            adapter.log.warn(err);
                        }
                    });					
                    // State löschen
                    adapter.delObject(resID + '.actualSoilMoisture');	// "sprinklecontrol.0.sprinkle.???.actualSoilMoisture"
                    adapter.delObject(resID + '.triggerPoint');     // "sprinklecontrol.0.sprinkle.???.triggerPoint"
                    adapter.delObject(resID + '.sprinklerState');	// "sprinklecontrol.0.sprinkle.???.sprinklerState"
                    adapter.delObject(resID + '.runningTime');	//	"sprinklecontrol.0.sprinkle.???.runningTime"
                    adapter.delObject(resID + '.countdown');	//	"sprinklecontrol.0.sprinkle.???.countdown"
                    adapter.delObject(resID + '.autoOn'); // "sprinklecontrol.0.sprinkle.???.autoOn"
                    adapter.delObject(resID + '.history.lastOn');	//	"sprinklecontrol.0.sprinkle.???..history.lastOn"
                    adapter.delObject(resID + '.history.lastConsumed');	//	"sprinklecontrol.0.sprinkle.???..history.lastConsumed"
                    adapter.delObject(resID + '.history.lastRunningTime');	// "sprinklecontrol.0.sprinkle.???.history.lastRunningTime"
                    adapter.delObject(resID + '.history.curCalWeekConsumed');	//	"sprinklecontrol.0.sprinkle.???.history.curCalWeekConsumed"
                    adapter.delObject(resID + '.history.lastCalWeekConsumed');	//	"sprinklecontrol.0.sprinkle.???.history.lastCalWeekConsumed"
                    adapter.delObject(resID + '.history.curCalWeekRunningTime');	//	"sprinklecontrol.0.sprinkle.???.history.curCalWeekRunningTime"
                    adapter.delObject(resID + '.history.lastCalWeekRunningTime');	//	"sprinklecontrol.0.sprinkle.???.history.lastCalWeekRunningTime"
                    // Objekt(Ordner) löschen
                    adapter.delObject(resID, function (err) {
                        if (err) {
                            adapter.log.warn(err);
                        }
                    });				
                }
            }, 1500);	

        }

    }
}

/**
 *
 * @param {ioBroker.Adapter} adapter
 */
function main(adapter) {

    /* The adapters config (in the instance object everything under the attribute "native") is accessible via
    * adapter.config:
	* => Auf die Adapterkonfiguration (im Instanz objekt alles unter dem Attribut "native") kann zugegriffen werden über
	adapter.config:
	*/
    adapter.log.debug(JSON.stringify(adapter.config.events));

    /**
     * The adapters config (in the instance object everything under the attribute "native") is accessible via adapter.config:
     * => Auf die Adapterkonfiguration (im Instanz objekt alles unter dem Attribut "native") kann zugegriffen werden über adapter.config:
     * @param {any} err
     * @param {any} obj
     */
    adapter.getForeignObject('system.config', (err) => {
        if (!err) {
            // init createConfig
            myConfig.createConfig(adapter);
            checkStates();
        }
    });

    GetSystemData();
    sendMessageText.initConfigMessage(adapter);

    timer = setTimeout(function() {
        checkActualStates();
        // init evaporation
        evaporation.initEvaporation(adapter);
        // Hauptpumpe zur Bewässerung setzen
        valveControl.initValveControl(adapter);
        sunPos();
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
    if (adapter.config.publicHolidays === true && (adapter.config.publicHolInstance + '.heute.*')) {
        adapter.subscribeForeignStates(adapter.config.publicHolInstance + '.heute.*');
    }
    if (adapter.config.publicHolidays === true && (adapter.config.publicHolInstance + '.morgen.*')) {
        adapter.subscribeForeignStates(adapter.config.publicHolInstance + '.morgen.*');
    }
    if ((adapter.config.weatherForecast === true) && (adapter.config.weatherForInstance + '.NextDaysDetailed.Location_1.Day_1.*')) {
        adapter.subscribeForeignStates(adapter.config.weatherForInstance + '.NextDaysDetailed.Location_1.Day_1.rain_value');
    }
    if ((adapter.config.weatherForecast === true) && (adapter.config.weatherForInstance + '.NextDaysDetailed.Location_1.Day_2.*')) {
        adapter.subscribeForeignStates(adapter.config.weatherForInstance + '.NextDaysDetailed.Location_1.Day_2.rain_value');
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