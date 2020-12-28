'use strict';

// Load your modules here, e.g.: => // Laden Sie Ihre Module hier, z.B.
// const fs = require("fs");

const utils = require('@iobroker/adapter-core');
const schedule  = require('node-schedule');
const SunCalc = require('suncalc2');

const sendMessageText = require('./lib/sendMessageText.js');            // sendMessageText

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;
const adapterName = require('./package.json').name.split('.').pop();

/* ext. Adapter */
/** @type {any} */
let publicHolidayStr;
/** @type {any} */
let publicHolidayTomorrowStr;
/** @type {number} */
let weatherForecastTodayNum = 0;
/** @type {number} */
let weatherForecastTomorrowNum = 0;

/** @type {string} */
let startTimeStr;
/** @type {string} */
let sunriseStr;
/** @type {string} */
let goldenHourEnd;
/** @type {number} */
let maxSunshine;	//	(Sonnenscheindauer in Stunden)
/** @type {any} */
let holidayStr;
/** @type {any} */
let autoOnOffStr;
/** @type {number} */
let ETpTodayNum = 0;
/** @type {string} */
let kwStr; // akt. KW der Woche
/** @type {boolean} */
const debug = false;
/** @type {boolean} */
let boostReady = true;
/** @type {boolean} */
let boostOn = false;
/** @type {number | undefined} */
let boostListTimer;
/** @type {number | undefined} */
let timer;
/* calcEvaporation */
/** @type {number} */
let curTemperature;		/*Temperatur*/
/** @type {number} */
let curHumidity;		/*LuftFeuchtigkeit*/
/** @type {number} */
let curIllumination;	/*Helligkeit*/
/** @type {number} */
let curWindSpeed;		/*WindGeschwindigkeit*/
/** @type {number} */
let lastRainCounter = 0;	/*last rain container => letzter Regencontainer*/
/** @type {number} */
let curAmountOfRain = 0;	/*current amount of rain => aktuelle Regenmenge*/
/** @type {object} */
let lastChangeEvaPor = new Date();	/*letzte Aktualisierungszeit*/
/* Control of the cistern pump */
/** @type {number} */
let fillLevelCistern = 0;
/** @type {object} */
const currentPumpUse = {
    /** @type {boolean} */ enable: false,
    /** @type {boolean} */ pumpCistern: false,
    /** @type {string} */  pumpName: '',
    /** @type {number} */  pumpPower: 0,
};
/* memo */
/** @type {object} */
let ObjMessage = {};
/** @type {any[]} */
let ObjSprinkle = [];
/** @type {any[]} */
const resConfigChange = []; /* Speicher für Werte aus der Config und dem Programm für schnellzugriff */

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
     * @param {() => void} callback
     */
    adapter.on('unload', (callback) => {
        try {
            adapter.log.info('cleaned everything up...');
            clearTimeout(timer);
            /*Startzeiten der Timer löschen*/
            schedule.cancelJob('calcPosTimer');
            schedule.cancelJob('sprinkleStartTime');
            if (boostListTimer) {clearTimeout(boostListTimer);}
            /* alle Ventile und Aktoren deaktivieren */
            ObjThread.clearEntireList();

            callback();
        } catch (e) {
            callback();
        }
    });

    /**
     * ++++++++++++++++++ Answers when getTelegramUser calls from index_m ++++++++++++++++++
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
            // The object was changed
            /*if (adapter.config.publicHolidays === true) {
                if (id === adapter.config.publicHolInstance + '.heute.boolean') {
                    publicHolidayStr = state.val;
                    startTimeSprinkle();
                }
                if (id === adapter.config.publicHolInstance + '.morgen.boolean') {
                    publicHolidayTomorrowStr = state.val;
                    startTimeSprinkle();
                }
            }*/

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
            if (debug) {
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
                    ObjThread.clearEntireList();
                }
                startTimeSprinkle();
            }
            // wenn (sprinkleName.runningTime sich ändert) so wird der aktuelle Sprenger [sprinkleName] gestartet
            if (resConfigChange && !state.ack) {
                const found = resConfigChange.find(d => d.objectID === id);
                if (found) {
                    if (id === resConfigChange[found.sprinkleID].objectID) {
                        if (!isNaN(state.val)) {
                            if (debug) {
                                adapter.log.info('stateChange: (' + found.objectName + ')".runningTime" wurde geändert: JSON: ' + JSON.stringify(found));
                            }
                            ObjThread.addList(
                                found.sprinkleID,
                                Math.round(60 * state.val),
                                false);
                            setActualPump();
                            setTimeout(() => {
                                ObjThread.updateList();
                            }, 50);
                        }
                    }
                }

            }
            // Change in outside temperature => Änderung der Außentemperatur
            if (id === adapter.config.sensorOutsideTemperature) {	/*Temperatur*/
                const timeDifference = (state.ts - lastChangeEvaPor) / 86400000;		// 24/h * 60/min * 60/s * 1000/ms = 86400000 ms
                if (debug) {
                    adapter.log.info('ts: ' + state.ts + ' - lastChangeEvaPor: ' + lastChangeEvaPor + ' = timeDifference: ' + timeDifference);
                }
                curTemperature = state.val;
                //
                if (timeDifference) {
                    setTimeout(() => {
                        calcEvaporation(timeDifference);
                    }, 500);
                }
                lastChangeEvaPor = state.ts;
            }
            // LuftFeuchtigkeit
            if (id === adapter.config.sensorOutsideHumidity) {
                curHumidity = state.val;
            }
            // Helligkeit
            if (id === adapter.config.sensorBrightness) {
                curIllumination = state.val;
            }
            // Windgeschwindigkeit
            if (id === adapter.config.sensorWindSpeed) {
                curWindSpeed = state.val;
            }
            // Regencontainer
            /* If the amount of rain is over 20 mm, the 'lastRainCounter' is overwritten and no calculation is carried out. =>
				* Wenn die Regenmenge mehr als 20 mm beträgt, wird der 'lastRainCounter' überschrieben und es wird keine Berechnung durchgeführt. */
            if (id === adapter.config.sensorRainfall) {
                if (Math.abs(lastRainCounter - state.val) > 10) {
                    curAmountOfRain = 0;
                    if (debug) {
                        adapter.log.info('if => Math.abs: ' + Math.abs(lastRainCounter - state.val) + ' curAmountOfRain: ' + curAmountOfRain);
                    }
                } else {
                    curAmountOfRain = state.val - lastRainCounter;
                    if (debug) {
                        adapter.log.info('else => Math.abs: ' + Math.abs(lastRainCounter - state.val) + ' curAmountOfRain: ' + curAmountOfRain);
                    }
                }
                lastRainCounter = state.val;
                if (debug) {
                    adapter.log.info('lastRainCounter: ' + lastRainCounter + ' curAmountOfRain: ' + curAmountOfRain + ' state.val: ' + state.val);
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
                    weatherForecastTomorrowNum = state.val;
                    adapter.setState('info.rainTomorrow', {
                        val: weatherForecastTomorrowNum,
                        ack: true
                    });
                }
            }
            // Füllstand der Zisterne bei Statusänderung
            if (adapter.config.actualValueLevel && (id === adapter.config.actualValueLevel)) {
                fillLevelCistern = parseFloat(state.val);
                //fillLevelCistern = state.val || 0;
                setActualPump();
            }
        } else {
            // The state was deleted
            adapter.log.info(`state ${id} deleted`);
        }
    });
}

//
const ObjThread = {
    threadList: [],

    /**
     * Sprinkle hinzufügen
     * @param sprinkleID {number} Position der Daten im Array resConfigChange[sprinkleID]
     * @param wateringTime {number} Bewässerungszeit in min
     * @param autoOn {boolean} Automatik oder Handbetrieb
     */
    addList : function (sprinkleID, wateringTime, autoOn) {
        const sprinkleName = resConfigChange[sprinkleID].objectName;
        let addDone = false;
        // schauen ob der Sprenger schon in der threadList ist
        if (ObjThread.threadList) {
            for(const entry of ObjThread.threadList) {
                if (entry.sprinkleID === sprinkleID) {
                    if (entry.wateringTime === parseInt(wateringTime)) {
                        // adapter.setState('sprinkle.' + sprinkleName + '.runningTime', {val: addTime(wateringTime, ''), ack: false});
                        return;
                    }
                    entry.wateringTime = parseInt(wateringTime);
                    entry.autoOn = autoOn;      // autoOn: = true autostart; = false Handbetrieb
                    adapter.setState('sprinkle.' + sprinkleName + '.runningTime', {
                        val: addTime(wateringTime, ''),
                        ack: false
                    });
                    addDone = true;		// Sprinkle found
                    if (debug) {adapter.log.info('addList (' + entry.sprinkleName + ') addDone time geändert: ' + addTime(wateringTime, ''));}
                    break;
                }
            }
        }
		
        if (!addDone) {
            if (parseInt(wateringTime) <= 0) return;
            const newThread = {};
            /** @type {number} */   newThread.sprinkleID = sprinkleID;	// Array[0...]
            /** @type {string} */   newThread.sprinkleName = sprinkleName;	// z.B "Blumenbeet"
            /** @type {string} */   newThread.idState = resConfigChange[sprinkleID].idState;	// z.B. "hm-rpc.0.MEQ1810129.1.STATE"
            /** @type {number} */   newThread.wateringTime = wateringTime;  // Bewässerungszeit
            /** @type {number} */   newThread.pipeFlow = resConfigChange[sprinkleID].pipeFlow;  // Wasserverbrauch
            /** @type {number} */   newThread.count = 0;
            /** @type {boolean} */  newThread.enabled = false;
            /** @type {boolean} */  newThread.myBreak = false;
            /** @type {number} */   newThread.litersPerSecond = resConfigChange[sprinkleID].pipeFlow / 3600;    // Wasserverbrauchsmenge pro Sekunde
            /** @type {number} */   newThread.onOffTime = resConfigChange[sprinkleID].wateringInterval;
            /** @type {boolean} */  newThread.autoOn = autoOn;
            /** @type {number} */   newThread.soilMoisture15s = 15 * (resConfigChange[sprinkleID].soilMoisture.maxIrrigation - resConfigChange[sprinkleID].soilMoisture.triggersIrrigation)
                                        / (60 * resConfigChange[sprinkleID].wateringTime);
            /** @type {any} */      newThread.times = [];       // hinterlegen der verschiedenen Zeiten von timeout für gezieltes späteres löschen
            /** @type {any} */      newThread.times.boostTime1 = null;  // boost start
            /** @type {any} */      newThread.times.boostTime2 = null;  // boost ende
            /** @type {number} */   newThread.id = ObjThread.threadList.length || 0;
            ObjThread.threadList.push(newThread);
            /* Zustand des Ventils im Thread < 0 > off, <<< 1 >>> wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
            adapter.setState('sprinkle.' + sprinkleName + '.sprinklerState', {val: 1, ack: false });
            adapter.setState('sprinkle.' + sprinkleName + '.runningTime', {val: addTime(wateringTime, ''), ack: false});
            if (debug) {adapter.log.info('addList (' + newThread.sprinkleName + '): ' + JSON.stringify(ObjThread.threadList[newThread.id]));}
        }
    }, // End addList

    /* Sprinkle (sprinkleName) delete */
    delList : (sprinkleName) => {
        let bValveFound = false;	// Ventil gefunden
        for(let counter = 0,                                  // Loop über das Array
            lastArray = (ObjThread.threadList.length - 1);     // entsprechend der Anzahl der Eintragungen
            counter <= lastArray;
            counter++) {
            const entry = ObjThread.threadList[counter].sprinkleName;
            if ((sprinkleName === entry) || bValveFound) {
                if (sprinkleName === entry) bValveFound = true;
                if (counter !== lastArray) ObjThread.threadList[counter] = ObjThread.threadList[counter + 1];
            }
        }
        /* If a valve is found, delete the last array (entry). Wenn Ventil gefunden letzten Array (Auftrag) löschen */
        if (bValveFound) {
            ObjThread.threadList.pop();
            if (debug) {adapter.log.info('delList (' + sprinkleName + ') !!! >>> wurde gelöscht');}
        }
	
        ObjThread.updateList();
	
    }, // End delList

    /* switch off all devices, when close the adapter => Beim Beenden des adapters alles ausschalten */
    clearEntireList: () => {
        // let bValveFound = false;	// Ventil gefunden
        for(let counter = ObjThread.threadList.length - 1;	// Loop über das Array
            counter >= 0;
            counter--) {
            const myEntry = ObjThread.threadList[counter];
            /* Ventil ausschalten */
            adapter.setForeignState(myEntry.idState, {val: false, ack: false});
            /* Zustand des Ventils im Thread <<< 0 >>> off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
            adapter.setState('sprinkle.' + myEntry.sprinkleName + '.sprinklerState', { val: 0, ack: true});
            adapter.setState('sprinkle.' + myEntry.sprinkleName + '.runningTime', { val: 0, ack: true});
            adapter.setState('sprinkle.' + myEntry.sprinkleName + '.countdown', { val: 0, ack: true});
            if (myEntry.autoOn) {
                resConfigChange[myEntry.sprinkleID].soilMoisture.val = resConfigChange[myEntry.sprinkleID].soilMoisture.maxIrrigation;  //  100%
                resConfigChange[myEntry.sprinkleID].soilMoisture.pct = 100;
                adapter.setState('sprinkle.' + myEntry.sprinkleName + '.actualSoilMoisture', {
                    val: resConfigChange[myEntry.sprinkleID].soilMoisture.pct,
                    ack: true
                });
            }
            adapter.setState('sprinkle.' + myEntry.sprinkleName + '.history.lastConsumed', {
                val: Math.round(myEntry.litersPerSecond * myEntry.count),
                ack: true
            });
            adapter.setState('sprinkle.' + myEntry.sprinkleName + '.history.lastRunningTime', { val: addTime(myEntry.count, ''), ack: true});
            adapter.setState('sprinkle.' + myEntry.sprinkleName + '.history.lastOn', { val: formatTime(myEntry.startTime, 'dd.mm. hh:mm'), ack: true});
            adapter.getState('sprinkle.' + myEntry.sprinkleName + '.history.curCalWeekConsumed', (err, state) => {
                if (state) {
                    adapter.setState('sprinkle.' + myEntry.sprinkleName + '.history.curCalWeekConsumed', { val: (state.val) + Math.round(myEntry.litersPerSecond * myEntry.count), ack: false});
                }
            });
            adapter.getState('sprinkle.' + myEntry.sprinkleName + '.history.curCalWeekRunningTime', (err, state) => {
                if (state) {
                    adapter.setState('sprinkle.' + myEntry.sprinkleName + '.history.curCalWeekRunningTime', { val: addTime(state.val, myEntry.count), ack: true});
                }
            });
            
            /* del timer countdown */
            clearInterval(myEntry.countdown);
            /* del timer onOffTimeoutOff */
            clearTimeout(myEntry.onOffTimeoutOff);
            /* del timer newThread.times.boostTime1 */
            if (myEntry.times.boostTime1) {
                clearTimeout(myEntry.times.boostTime1);
                myEntry.times.boostTime1 = null;
            }
            /* del timer newThread.times.boostTime2 */
            if (myEntry.times.boostTime2) {
                clearTimeout(myEntry.times.boostTime2);
                myEntry.times.boostTime2 = null;
            }

            if (debug) {adapter.log.info('clearEntireList (' + myEntry.sprinkleName + '): Ventil wird gelöscht:');}
            ObjThread.threadList.pop();
            if (debug) {adapter.log.info('clearEntireList (' + myEntry.sprinkleName + ') Ventil ist gelöscht => noch vorhandene Ventile: ' + ObjThread.threadList.length);}
        }
        ObjThread.updateList();

    }, // End clearEntireList

    boostList : (sprinkleID) => {
        boostReady = false;
        boostOn = true;
        for(const entry of ObjThread.threadList) {
            if (entry.enabled) {
                if (entry.sprinkleID === sprinkleID) {      // Booster
                    if (debug) {adapter.log.info('boostList (' + entry.sprinkleName + '): sprinkleID: ' + sprinkleID + ' => boostOn');}
                    /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, < 2 > on, < 3 > break, <<< 4 >>> Boost(on), < 5 > off(Boost) */
                    adapter.setState('sprinkle.' + entry.sprinkleName + '.sprinklerState', { val: 4, ack: true});
                    entry.times.boostTime2 = setTimeout(() => {
                        /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                        adapter.setState('sprinkle.' + entry.sprinkleName + '.sprinklerState', { val: 2, ack: true});
                        entry.times.boostTime2 = null;
                    },31000);
                } else {    // rest der Ventile
                    entry.times.boostTime1 = setTimeout(() => {
                        /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), <<< 5 >>> off(Boost) */
                        adapter.setState('sprinkle.' + entry.sprinkleName + '.sprinklerState', { val: 5, ack: true});
                        adapter.setForeignState(entry.idState, {val: false, ack: false});	// Ventil ausschalten
                        entry.times.boostTime1 = null;
                    },250);
                    entry.times.boostTime2 = setTimeout(() => {
                        /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                        adapter.setState('sprinkle.' + entry.sprinkleName + '.sprinklerState', { val: 2, ack: true});
                        adapter.setForeignState(entry.idState, {val: true, ack: false});	// Ventil einschalten
                        entry.times.boostTime2 = null;
                    },31000);
                }
            }
        }
        boostListTimer = setTimeout(() => {
            boostOn = false;
            ObjThread.updateList();
        },32000);
    }, // End boostList

    // Wenn boostOn über die Eingabe "runningTime = 0" beendet wird, so soll zum Normalen ablauf wieder zurückgekehrt werden. (Löschen der Timer)
    boostKill : (sprinkleID) => {
        for(const entry of ObjThread.threadList) {
            if (entry.enabled) {
                if (entry.sprinkleID === sprinkleID) {
                    /* booster wird gekillt */
                    boostOn = false;
                    if(entry.times.boostTime2) {
                        clearTimeout(entry.times.boostTime2);
                        entry.times.boostTime2 = null;
                        if (debug) adapter.log.info('boostKill (' + entry.sprinkleName + ') => boostTime2 (Ende) gelöscht');
                    }
                } else {
                    /* normaler weiterbetrieb für den Rest */
                    if (entry.times.boostTime1) {
                        clearTimeout(entry.times.boostTime1);
                        entry.times.boostTime1 = null;
                        if (debug) adapter.log.info('boostKill (' + entry.sprinkleName + ') => boostTime2 (Ende) gelöscht)');
                    }
                    if (entry.times.boostTime2) {
                        clearTimeout(entry.times.boostTime2);
                        entry.times.boostTime2 = null;
                        /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                        adapter.setState('sprinkle.' + entry.sprinkleName + '.sprinklerState', { val: 2, ack: true});
                        adapter.setForeignState(entry.idState, {val: true, ack: false});	// Ventil einschalten
                        if (debug) adapter.log.info('boostKill (' + entry.sprinkleName + ') wieder on => boostTime2 gelöscht');
                    }
                }
            }
        }
    }, // End boostKill

    updateList : () => {
        /* während des Boost eines Kreises ist ein zuschalten von Sprengern nicht möglich */
        if (boostOn) {return;}

        /**
         * aktuelle Rest-Pumpenleistung
         * @type {number}
         */
        let curFlow = parseInt(currentPumpUse.pumpPower); /* adapter.config.triggerMainPumpPower; */
        /**
         * aktuelle Anzahl der eingeschalteten Ventile
         * @type {number}
         */
        let parallel = 0;
        /**
         * maximal zulässige Anzahl der eingeschalteten Ventile
         * @type {number}
         */
        const maxParallel = parseInt(adapter.config.maximumParallelValves);
        /**
         * Sortierfunktion mySortDescending absteigende Sortierung
         * @param a
         * @param b
         * @returns {number}
         */
        function mySortDescending(a, b) {
            return a.pipeFlow > b.pipeFlow ? -1 :
                a.pipeFlow < b.pipeFlow ? 1 :
                    0;
        }
        /**
         * Sortierfunktion mySortAscending aufsteigende Sortierung
         * @param a
         * @param b
         * @returns {number}
         */
        function mySortAscending(a, b) {
            return a.pipeFlow < b.pipeFlow ? -1 :
                a.pipeFlow > b.pipeFlow ? 1 :
                    0;
        }
        /**
         * Handling von Ventilen, Zeiten, Verbrauchsmengen im 1s Takt
         * @param {object} entry
         */
        function countSprinkleTime(entry) {
            /* --- function beenden wenn ---*/
            if (boostOn && !(resConfigChange[entry.sprinkleID].booster)   // boost-On && kein aktuelles Boost-Ventil
            ) {
                return;
            }
            entry.count ++;
            if ((entry.count < entry.wateringTime)	// Zeit noch nicht abgelaufen?
                && ((resConfigChange[entry.sprinkleID].soilMoisture.val < resConfigChange[entry.sprinkleID].soilMoisture.maxIrrigation)		// Bodenfeuchte noch nicht erreicht? (z.B. beim Regen)
                    || !entry.autoOn)	// Vergleich nur bei Automatik
            ) {     /* zeit läuft */
                adapter.setState('sprinkle.' + entry.sprinkleName + '.countdown', {
                    val: addTime(entry.wateringTime - entry.count, ''),
                    ack: true
                });
                /* Alle 15s die Bodenfeuchte anpassen */
                if (!(entry.count % 15)) {	// alle 15s ausführen
                    resConfigChange[entry.sprinkleID].soilMoisture.val += entry.soilMoisture15s;
                    resConfigChange[entry.sprinkleID].soilMoisture.pct = Math.round(1000 * resConfigChange[entry.sprinkleID].soilMoisture.val
                        / resConfigChange[entry.sprinkleID].soilMoisture.maxIrrigation) / 10;	// Berechnung in %
                    adapter.setState('sprinkle.' + entry.sprinkleName + '.actualSoilMoisture', {
                        val: resConfigChange[entry.sprinkleID].soilMoisture.pct,
                        ack: true
                    });
                }
                /* Intervall-Beregnung wenn angegeben (onOffTime > 0) */
                if ((entry.onOffTime > 0) && !(entry.count % entry.onOffTime)) {
                    entry.enabled = false;
                    entry.myBreak = true;
                    /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, < 2 > on, <<< 3 >>> break, < 4 > Boost(on), < 5 > off(Boost) */
                    adapter.setState('sprinkle.' + entry.sprinkleName + '.sprinklerState', {
                        val: 3,
                        ack: true
                    });
                    adapter.setForeignState(entry.idState, {	// Ventil ausschalten
                        val: false,
                        ack: false
                    });
                    ObjThread.updateList();
                    clearInterval(entry.countdown);
                    entry.onOffTimeoutOff = setTimeout(()=>{
                        entry.myBreak = false;
                        /* Zustand des Ventils im Thread < 0 > off, <<< 1 >>> wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                        adapter.setState('sprinkle.' + entry.sprinkleName + '.sprinklerState', {
                            val: 1,
                            ack: true
                        });
                        ObjThread.updateList();
                    },1000 * entry.onOffTime);
                }
            } else {    /* zeit abgelaufen => Ventil ausschalten */
                adapter.setForeignState(entry.idState, {
                    val: false,
                    ack: false
                });
                /* Zustand des Ventils im Thread <<< 0 >>> off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                adapter.setState('sprinkle.' + entry.sprinkleName + '.sprinklerState', {
                    val: 0,
                    ack: true
                });
                adapter.setState('sprinkle.' + entry.sprinkleName + '.runningTime', {
                    val: 0,
                    ack: true
                });
                adapter.setState('sprinkle.' + entry.sprinkleName + '.countdown', {
                    val: 0,
                    ack: true
                });
                /* wenn in config endIrrigation =true bei auto => Bodenfeuchte auf 100% setzen*/
                if (entry.autoOn && resConfigChange[entry.sprinkleID].endIrrigation) {
                    resConfigChange[entry.sprinkleID].soilMoisture.val = resConfigChange[entry.sprinkleID].soilMoisture.maxIrrigation;
                    resConfigChange[entry.sprinkleID].soilMoisture.pct = 100;
                    adapter.setState('sprinkle.' + entry.sprinkleName + '.actualSoilMoisture', {
                        val: resConfigChange[entry.sprinkleID].soilMoisture.pct,
                        ack: true
                    });
                }
                /* Verbrauchswerte erfassen */
                adapter.setState('sprinkle.' + entry.sprinkleName + '.history.lastConsumed', {
                    val: Math.round(entry.litersPerSecond * entry.count),
                    ack: true
                });
                adapter.setState('sprinkle.' + entry.sprinkleName + '.history.lastRunningTime', {
                    val: addTime(entry.count, ''),
                    ack: true
                });
                adapter.setState('sprinkle.' + entry.sprinkleName + '.history.lastOn', {
                    val: formatTime(entry.startTime, 'dd.mm. hh:mm'),
                    ack: true
                });
                adapter.getState('sprinkle.' + entry.sprinkleName + '.history.curCalWeekConsumed', (err, state) => {
                    if (state) {
                        adapter.setState('sprinkle.' + entry.sprinkleName + '.history.curCalWeekConsumed', {
                            val: (state.val) + Math.round(entry.litersPerSecond * entry.count),
                            ack: false
                        });
                    }
                });
                adapter.getState('sprinkle.' + entry.sprinkleName + '.history.curCalWeekRunningTime', (err, state) => {
                    if (state) {
                        adapter.setState('sprinkle.' + entry.sprinkleName + '.history.curCalWeekRunningTime', {
                            val: addTime(state.val, entry.count),
                            ack: true
                        });
                    }
                });
                /* Booster zurücksetzen */
                if (resConfigChange[entry.sprinkleID].booster) {
                    if (boostOn) {ObjThread.boostKill(entry.sprinkleID);}
                    boostReady = true;
                    if (debug) {adapter.log.info('UpdateList Sprinkle Off: sprinkleID: ' + entry.sprinkleID + ', boostReady = ' + boostReady);}
                }
                /* Ventil aus threadList löschen => Aufgabe beendet */
                ObjThread.delList(entry.sprinkleName);
                /* Zeiten löschen */
                clearInterval(entry.countdown);
                /*clearTimeout(entry.onOffTimeoutOn);*/
                clearTimeout(entry.onOffTimeoutOff);
            }
        }

        // ermitteln von curPipe und der anzahl der parallelen Stränge
        for(const entry of ObjThread.threadList){
            if (entry.enabled) {
                curFlow -= entry.pipeFlow;	// // ermitteln der RestFörderkapazität
                parallel ++;	// Anzahl der Bewässerungsstellen um 1 erhöhen
            }
        }

        if (curFlow < 0) {
            /* - wenn beim Umschalten der Pumpen die Förderleistung zu gering ist Ventile deaktivieren - */
            // aufsteigend sortieren nach der Verbrauchsmenge
            ObjThread.threadList.sort(mySortAscending);

            for(const entry of ObjThread.threadList) {
                if ((entry.enabled)                           // eingeschaltet
                    && (curFlow < 0)) {        // Förderleistung der Pumpe zu gering
                    entry.enabled = false;      // ausgeschaltet merken
                    clearInterval(entry.countdown); // Zähler für Countdown, Verbrauchsmengen, usw. löschen
                    curFlow += entry.pipeFlow;	// ermitteln der RestFörderkapazität
                    parallel--;	// Anzahl der Bewässerungsstellen um 1 verringern
                    adapter.log.info('(697) Förderleistung Verbraucher löschen: Name ' + entry.sprinkleName + ' curFlow ' + curFlow + ' parallel: ' + parallel);
                    /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                    adapter.setState('sprinkle.' + entry.sprinkleName + '.sprinklerState', {
                        val: 1,
                        ack: true
                    });
                    /* Ventil ausschalten */
                    adapter.setForeignState(entry.idState, {
                        val: false,
                        ack: false
                    });
                }
            }
        }

        // absteigend sortieren nach der Verbrauchsmenge
        ObjThread.threadList.sort(mySortDescending);

        // einschalten der Bewässerungsventile nach Verbrauchsmenge und maximaler Anzahl
        for(const entry of ObjThread.threadList) {
            if (!entry.enabled                                                      // ausgeschaltet
                && !entry.myBreak                                                   // nicht mehr in der Pause
                && (curFlow >= entry.pipeFlow)                                      // noch genügend Förderleistung der Pumpe
                && (parallel < maxParallel)                                         // maxParallel noch nicht erreicht
                && ((boostReady) || !(resConfigChange[entry.sprinkleID].booster))   // nur einer mit boostFunction darf aktive sein
            ) {
                entry.enabled = true;	// einschalten merken
                if (resConfigChange[entry.sprinkleID].booster) {
                    boostReady = false;
                    if (debug) {
                        adapter.log.info('UpdateList sprinkle On: sprinkleID: ' + entry.sprinkleID + ', boostReady = ' + boostReady);
                    }
                    setTimeout(() => {
                        ObjThread.boostList(entry.sprinkleID);
                    }, 50);
                }
                curFlow -= entry.pipeFlow;	// ermitteln der RestFörderkapazität
                parallel++;	// Anzahl der Bewässerungsstellen um 1 erhöhen
                adapter.log.info('(737) Förderleistung Verbraucher hinzufügen: Name ' + entry.sprinkleName + ' curFlow ' + curFlow + ' parallel: ' + parallel);
                /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                adapter.setState('sprinkle.' + entry.sprinkleName + '.sprinklerState', {
                    val: 2,
                    ack: true
                });
                /* Ventil einschalten */
                adapter.setForeignState(entry.idState, {
                    val: true,
                    ack: false
                });
                adapter.log.info('Ventil "' + entry.sprinkleName + '" eingeschaltet für ' + addTime(entry.wateringTime, ''));
                /* countdown starten */
                if (!entry.startTime) {
                    entry.startTime = new Date();
                }
                entry.countdown = setInterval(() => {
                    countSprinkleTime(entry);
                }, 1000);	// 1000 = 1s

            }
        }

        adapter.setState('control.parallelOfMax', {
            val: parallel + ' : ' + maxParallel,
            ack: true
        });
        adapter.setState('control.restFlow', {
            val: '' + curFlow + ' (' + currentPumpUse.pumpPower + ' ' + (currentPumpUse.pumpCistern ? 'Zisterne' : 'Grundwasser')  + ')',
            ack: true
        });
        // Steuerspannung ein/aus
        if (adapter.config.triggerControlVoltage !== '') {
            adapter.getForeignState(adapter.config.triggerControlVoltage, (err, state) => {
                if (state) {
                    if (parallel > 0) {
                        if (state.val === false) {
                            adapter.setForeignState(adapter.config.triggerControlVoltage, {
                                val: true,
                                ack: false
                            });
                            adapter.log.info('Versorgungsspannung der Ventile eingeschaltet');
                        }
                    } else {
                        if (state.val !== false) {
                            adapter.setForeignState(adapter.config.triggerControlVoltage, {
                                val: false ,
                                ack: false
                            });
                            adapter.log.info('Versorgungsspannung der Ventile ausgeschaltet');
                        }
                    }
                } else if (err) {
                    adapter.log.error('triggerControlVoltage is not available (ist nicht erreichbar): ' + err);
                }
            });
        }
		
        // Pumpe ein/aus
        if (currentPumpUse.pumpName !== '') {
            adapter.getForeignState(currentPumpUse.pumpName, (err, state) => {
                if (state) {
                    if (parallel > 0) {
                        if (state.val === false) {
                            adapter.setForeignState(currentPumpUse.pumpName, {
                                val: true,
                                ack: false});
                            currentPumpUse.enable = true;
                            adapter.log.info('Hauptpumpe eingeschaltet');
                        }
                    } else {
                        if (state.val !== false) {
                            adapter.setForeignState(currentPumpUse.pumpName, {
                                val: false,
                                ack: false});
                            currentPumpUse.enable = false;
                            adapter.log.info('Hauptpumpe ausgeschaltet');
                        }
                    }				
                } else if (err) {
                    adapter.log.error('triggerMainPump is not available (ist nicht erreichbar): ' + err);
                }
            });
        }
		
    } // End updateList
	
}; // End ObjThread

/**
 * +++++++++++++++++ Festlegen der aktuellen Pumpe zur Bewässerung ++++++++++++++++++++
 */
function setActualPump() {
    if (adapter.config.cisternSettings === true) {
        /* Zisternen-Bewässerung Einstellung in der config (2.Pumpe) aktiviert */
        if (currentPumpUse.enable === true) {
            /* Bewässerungspumpen aktiv */
            if ((fillLevelCistern < parseFloat(adapter.config.triggerMinCisternLevel)) && (currentPumpUse.pumpCistern === true)) {
                /* (Zisterne unter Minimum) && (ZisternenPumpe läuft) */
                adapter.setForeignState(currentPumpUse.pumpName, {
                    val: false,
                    ack: false
                });
                currentPumpUse.pumpCistern = false;
                currentPumpUse.pumpName = adapter.config.triggerMainPump || '';
                currentPumpUse.pumpPower = adapter.config.triggerMainPumpPower;
                adapter.setForeignState(currentPumpUse.pumpName, {
                    val: true,
                    ack: false
                });
                adapter.log.info('Pumpenwechsel (Zisterne leer) Zisternen-Pumpe aus => Hauptpumpe ein');
                ObjThread.updateList();
            }
            if (fillLevelCistern < parseFloat(adapter.config.triggerMinCisternLevel)) {
                adapter.setState('info.cisternState', {
                    val: 'Cistern empty: ' + fillLevelCistern + ' %  (' + adapter.config.triggerMinCisternLevel + ' %)',
                    ack: true
                });
            } else {
                adapter.setState('info.cisternState', {
                    val: 'Cistern filled: ' + fillLevelCistern + ' %  (' + adapter.config.triggerMinCisternLevel + ' %)',
                    ack: true
                });
            }
        } else {
            /* Bewässerungspumpen inaktiv */
            if ((fillLevelCistern > parseFloat(adapter.config.triggerMinCisternLevel)) && (adapter.config.triggerCisternPump) && (adapter.config.triggerCisternPumpPower)) {
                /* Zisterne voll && triggerCisternPump && triggerCisternPumpPower vorhanden*/
                adapter.setState('info.cisternState', {
                    val: 'Cistern filled: ' + fillLevelCistern + ' %  (' + adapter.config.triggerMinCisternLevel + ' %)',
                    ack: true
                });
                currentPumpUse.pumpCistern = true;
                currentPumpUse.pumpName = adapter.config.triggerCisternPump || '';
                currentPumpUse.pumpPower = adapter.config.triggerCisternPumpPower;
                adapter.setState('control.restFlow', {
                    val: currentPumpUse.pumpPower + ' (' + currentPumpUse.pumpPower + ' Zisterne)',
                    ack: true
                });
            } else {
                adapter.setState('info.cisternState', {
                    val: 'Cistern empty: ' + fillLevelCistern + ' %  (' + adapter.config.triggerMinCisternLevel + ' %)',
                    ack: true
                });
                currentPumpUse.pumpCistern = false;
                currentPumpUse.pumpName = adapter.config.triggerMainPump || '';
                currentPumpUse.pumpPower = adapter.config.triggerMainPumpPower;
                adapter.setState('control.restFlow', {
                    val: currentPumpUse.pumpPower + ' (' + currentPumpUse.pumpPower + ' Grundwasser)',
                    ack: true
                });
            }
        }
    } else {
        /* Zisternen-Bewässerung nicht aktiv */
        if (adapter.config.triggerCisternPump) {
            adapter.setState('info.cisternState', {
                val: 'Cistern settings are not active!' + ((fillLevelCistern > 0)?(' level sensor: ' + fillLevelCistern + '%' + ((adapter.config.triggerMinCisternLevel !== '')?('  (' + adapter.config.triggerMinCisternLevel + '%)'):(''))):('')),
                ack: true
            });
        }
    }
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

//
/**
 * evaporation calculation
 * => Berechnung der Verdunstung
 * @param {number} timeDifference
 */
function calcEvaporation (timeDifference) {
    if (debug) {adapter.log.info('calcEvaporation => gestartet TimeDifferenz: ' + timeDifference);}
    //	Sonnenscheindauer in %
    const curSunshineDuration = (curIllumination < 100) ? (0) : (curIllumination > 7000) ? (1) : ((curIllumination - 100) / (6900));
	
    /* Extraterrestrische Strahlung in W/m³
    let ExStra = [86,149,247,354,439,479,459,388,287,184,104,70];   // "53NB"
    let my m = strftime("%m", localtime);
    let my RE = ExStra[$m]; */

    const RE = 45.8 * maxSunshine - 293;

    // Sättigungsdampfdruck Es in hPa
    const m1 = 6.11 * ( 10 ** (( 7.48 * curTemperature ) / ( 237 + curTemperature )));

    // Dampfdruck Ea
    const m2 = m1 * curHumidity / 100;
		
    // Globalstrahlung RG
    const m3 = (0.19 + 0.55 * curSunshineDuration) * RE;

    // Abstrahlung I in W/m²
    const m4 = 5.67E-8 * (( curSunshineDuration + 273 ) ** 4 ) * ( 0.56 - 0.08 * ( m2 ** 0.5 )) * ( 0.1 + ( 0.9 * curSunshineDuration));
		
    // Strahlungsäquivalent EH in mm/d
    const m5 = ( m3 * ( 1 - 0.2 ) - m4 ) / 28.3;
		
    // Steigung der Sättigungsdampfdruckkurve Delta in hPa/K
    const m6 = ( m1 * 4032 ) / (( 237 + curTemperature ) ** 2 );

    // Windfunktion f(v) in mm/d hPa
    const m7 = 0.13 + 0.14 * curWindSpeed / 3.6;
	
    // pot. Evapotranspiration nach Penman ETp in mm/d
    const eTp = (( m6 * m5 + 0.65 * m7 * ( m1 - m2 )) / ( m6 + 0.65 )) - 0.5;

    if (debug) {adapter.log.info('RE: ' + RE + ' ETp:' + eTp);}
    adapter.setState('evaporation.ETpCurrent', { val: Math.round(eTp * 10000) / 10000, ack: true });
	
    // Verdunstung des heutigen Tages
    const curETp = (eTp * timeDifference) - curAmountOfRain;
    curAmountOfRain = 0;	// auf 0 setzen damit nicht doppelt abgezogen wird.
    if (curETp < 2) {       // um Fehler in der Auswertung beim Neustart zu löschen
        ETpTodayNum += curETp;
    }
    if (debug) {adapter.log.info('ETpTodayNum = ' + ETpTodayNum + ' ( ' + curETp + ' )');}
    adapter.setState('evaporation.ETpToday', { val: Math.round(ETpTodayNum * 10000) / 10000, ack: true });

    applyEvaporation (curETp);
}


/**
 * apply Evaporation
 * => Verdunstung anwenden auf die einzelnen Sprenger kreise
 * @param {number} eTP
 */
function applyEvaporation (eTP){

    const result = resConfigChange; // resEnabled;
    if (result) {
	
        for(const i in result) {
            const objectName = result[i].objectName;
            const pfadActSoiMoi = 'sprinkle.' + objectName + '.actualSoilMoisture';

            resConfigChange[i].soilMoisture.val -= eTP;		// Abfrage => resConfigChange[sprinkleID].soilMoisture.val
            if (resConfigChange[i].soilMoisture.val < resConfigChange[i].soilMoisture.min) {
                resConfigChange[i].soilMoisture.val = resConfigChange[i].soilMoisture.min;
            } else if (resConfigChange[i].soilMoisture.val > resConfigChange[i].soilMoisture.maxRain) {
                resConfigChange[i].soilMoisture.val = resConfigChange[i].soilMoisture.maxRain;
            }
            resConfigChange[i].soilMoisture.pct = Math.round(1000 * resConfigChange[i].soilMoisture.val / resConfigChange[i].soilMoisture.maxIrrigation) / 10;	// Berechnung in %
            if (debug) {adapter.log.info(objectName + ' => soilMoisture: ' + resConfigChange[i].soilMoisture.val + ' soilMoisture in %: ' + resConfigChange[i].soilMoisture.pct + ' %');}
            adapter.setState(pfadActSoiMoi, {
                val: resConfigChange[i].soilMoisture.pct,
                ack: true
            });
        }
    }		
}


/**
 * func addTime (02:12:24 + 00:15) || (807) => 02:12:39
 * @param time1 {string|number} z.B. 02:12:24 || 807 => 02:12:39
 * @param time2 {string|number|undefined} z.B. 02:12:24 || 807 => 02:12:39 || undef.
 * @returns {string}
 */
function addTime(time1, time2){
    const wert = string2seconds(time1) + string2seconds(time2);
    return seconds2string(wert);

    // private functions
    function seconds2string(n){
        n = Math.abs(n);
        const h = Math.trunc(n / 3600);
        const m = Math.trunc((n / 60 ) % 60);
        const sec = Math.trunc(n % 60);
        return (h === 0)?(frmt(m) + ':' + frmt(sec)):(frmt(h) + ':' + frmt(m) + ':' + frmt(sec));
    }   //  end function seconds2string
    
    function string2seconds(n) {
        if(!n) return 0;
        if(Number.isInteger(n)) return n;
        const tmp = n.split(':').reverse();
        if(!tmp.length) tmp[0] = 0;	// Sekunden
        if(tmp.length < 2) tmp[1] = 0;	// Minuten
        if(tmp.length < 3) tmp[2] = 0;	// Stunden
        while(tmp[0] > 59) {
            tmp[0] -= 60;
            ++tmp[1];
        }
        while(tmp[1] > 59) {
            tmp[1] -= 60;
            ++tmp[2];
        }
        return (tmp[2] * 3600 + tmp[1] * 60 + 1 * tmp[0]);
    }   //  string2seconds

    function frmt(n) { return n < 10 ? '0' + n : n;}

}   // end - function addTime


/**
 * func Format Time
 * => hier wird der übergebene Zeitstempel, myDate, in das angegebene Format, timeFormat, umgewandelt.
 *   Ist myDate nicht angegeben, so wird die aktuelle Zeit verwendet.
 * @param {date} myDate
 * @param {string} timeFormat 'kW': Rückgabe der KW; 'dd.mm. hh:mm': Rückgabe Datum und Zeit
 * @returns {string|number}
 */
function formatTime(myDate, timeFormat) {	// 'kW' 'dd.mm. hh:mm' 
    function zweiStellen (s) {
        while (s.toString().length < 2) {s = '0' + s;}
        return s;
    }

    const d = (myDate)? new Date(myDate):new Date();
    const tag = zweiStellen(d.getDate());
    const monat = zweiStellen(d.getMonth() + 1);
    const stunde = zweiStellen(d.getHours());
    const minute = zweiStellen(d.getMinutes());
    const currentThursday = new Date(d.getTime() +(3-((d.getDay()+6) % 7)) * 86400000);
    // At the beginning or end of a year the thursday could be in another year.
    const yearOfThursday = currentThursday.getFullYear();
    // Get first Thursday of the year
    const firstThursday = new Date(new Date(yearOfThursday,0,4).getTime() +(3-((new Date(yearOfThursday,0,4).getDay()+6) % 7)) * 86400000);

	
    switch (timeFormat) {
        case 'kW':	// formatTime('','kW');
            // +1 we start with week number 1
            // +0.5 an easy and dirty way to round result (in combination with Math.floor)
            return Math.floor(1 + 0.5 + (currentThursday.getTime() - firstThursday.getTime()) / 86400000/7);
			
        case 'dd.mm. hh:mm':
            return tag + '.' + monat + ' ' + stunde + ':' + minute;
		
        default:
            adapter.log.info('function formatTime: falsches Format angegeben');
            break;
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
            adapter.setState('control.autoOnOff', {val: autoOnOffStr, ack: true});
        }
    });
    adapter.getState('evaporation.ETpToday', (err, state) => {
        if (state && (state.val == null)) {
            ETpTodayNum = 0;
            //            dayNum = new Date().getDay();
            adapter.setState('evaporation.ETpToday', {val: '0', ack: true});
        } else if (state) {
            ETpTodayNum = state.val;
            //            dayNum = new Date(state.ts).getDay();
        }
    });
    adapter.getState('evaporation.ETpYesterday', (err, state) => {
        if (state && (state.val == null || state.val === false)) {
            adapter.setState('evaporation.ETpYesterday', {val: '0', ack: true});
        }
    });
    /* Pumpe ausschalter wenn vorhanden */
    if (adapter.config.triggerMainPump !== '') {
        adapter.getState('adapter.config.triggerMainPump', (err, state) => {
            if (state) {
                adapter.setState(adapter.config.triggerMainPump, {val: false, ack: false});
            }
        });
    }
    /* Pumpe (Zisterne) ausschalter wenn vorhanden */
    if (adapter.config.triggerCisternPump !== '') {
        adapter.getState('adapter.config.triggerCisternPump', (err, state) => {
            if (state) {
                adapter.setState(adapter.config.triggerCisternPump, {val: false, ack: false});
            }
        });
    }
    /* alle Ventile (.name = "hm-rpc.0.MEQ1234567.3.STATE") in einem definierten Zustand (false) versetzen*/
    const result = adapter.config.events;
    if (result) {	
        for(const i in result) {
            adapter.getState(result[i].name, (err, state) => {
                if (state) {
                    adapter.setState(result[i].name, {val: false, ack: false});
                }
            });			
        }
    }

    // akt. kW ermitteln für history last week
    kwStr = formatTime('','kW');
    adapter.log.info('checkStates akt-KW: ' + kwStr);

    // Hauptpumpe zur Bewässerung setzen
    currentPumpUse.pumpCistern = false;
    currentPumpUse.pumpName = adapter.config.triggerMainPump;
    currentPumpUse.pumpPower = adapter.config.triggerMainPumpPower;

    adapter.setState('control.parallelOfMax', {
        val: 0 + ' : ' + adapter.config.maximumParallelValves,
        ack: true
    });
    adapter.setState('control.restFlow', {
        val: currentPumpUse.pumpPower + ' (' + currentPumpUse.pumpPower + ' ' + (currentPumpUse.pumpCistern ? 'Zisterne' : 'Grundwasser')  + ')',
        ack: true
    });
}

//	aktuelle States checken nach dem Start (2000 ms)
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
                adapter.setState('info.rainToday', {val: weatherForecastTodayNum, ack: true});
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
        /**
         * Füllstand der Zisterne in %
         * @param {string|null} err
         * @param {ioBroker.State|null|undefined} state
         */
        adapter.getForeignState(adapter.config.actualValueLevel, (err, state) => {
            if (typeof state !== undefined && state != null) {
                fillLevelCistern = parseFloat(state.val);
                setActualPump();
            }
        });
    }

    //
    adapter.getForeignObjects(adapter.namespace + '.sprinkle.*', 'channel', /**
        * @param {any} err
        * @param {any[]} list
        */
        function (err, list) {
            if (err) {
                adapter.log.error(err);
            } else {
                ObjSprinkle = list;
            }
        });	
	
    //
    setTimeout(() => {
        createSprinklers();
    }, 1000);
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

    // History Daten aktualisieren wenn eine neue Woche beginnt
    if (debug) {adapter.log.info('calcPos 0:05 old-KW: ' + kwStr + ' new-KW: ' + formatTime('','kW') + ' if: ' + (kwStr !== formatTime('','kW')));}
    if (kwStr !== formatTime('','kW')) {
        const result = resConfigChange;
        if (result) {	
            for(const i in result) {
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
                        adapter.setState('sprinkle.' + objectName + '.history.curCalWeekRunningTime', { val: 0, ack: true });
                    }
                });				
            }
        }
        kwStr = formatTime('','kW');
    }

    // ETpToday und ETpYesterday in evaporation aktualisieren da ein neuer Tag
    setTimeout(() => {
        adapter.setState('evaporation.ETpYesterday', { val: Math.round(ETpTodayNum * 10000) / 10000, ack: true });
        ETpTodayNum = 0;
        adapter.setState('evaporation.ETpToday', { val: '0', ack: true });
    },100);
	
    // Startzeit Festlegen => verzögert wegen Daten von SunCalc
    setTimeout(() => {
        startTimeSprinkle();
    },1000);
    
});

// Berechnung mittels sunCalc
function sunPos() {
    // get today's sunlight times => Holen Sie sich die heutige Sonnenlicht Zeit	
    const times = SunCalc.getTimes(new Date(), adapter.config.latitude, adapter.config.longitude);
	
    //Sonnenscheindauer in Stunden)
    maxSunshine = ((times.sunset.getTime() - times.sunrise.getTime()) / 3600000);
	
    // Berechnung des heutigen Tages
    // dayNum = times.sunrise.getDay();
	
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
        if (debug) {adapter.log.info('Sprinkle: autoOnOff == Aus(' + autoOnOffStr + ')');}
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
         * qparam {{string} val} state
         */
        adapter.getState('info.nextAutoStart', (err, state) =>{
            if (state) {
                if (state.val !== newStartTimeLong) {
                    adapter.setState('info.nextAutoStart', {
                        val: newStartTimeLong,
                        ack: true
                    });
                    ObjMessage.messageText = infoMessage + '(' + myWeekdayStr[myWeekday] + ') um ' + newStartTime;
                    sendMessageText(adapter, ObjMessage);
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
        // Wenn aktiviert "Einstellung Zisterne" Pumpe je Füllstand der Zisterne auswählen
        if (adapter.config.cisternSettings) {
            setActualPump();
        }
        // Filter enabled
        const result = resConfigChange.filter(d => d.enabled === true);
        if (result) {	
            for(const i in result) {
                messageText += '<b>' + result[i].objectName + '</b>' + ' ' + result[i].soilMoisture.pct + '% (' + result[i].soilMoisture.pctTriggerIrrigation + '%)' + '\n';
                // Test Bodenfeuchte
                if (debug) {adapter.log.info('Bodenfeuchte: ' + result[i].soilMoisture.val + ' <= ' + result[i].soilMoisture.triggersIrrigation + ' AutoOnOff: ' + result[i].autoOnOff);}
                // Bodenfeuchte zu gering && Ventil auf Automatik
                if ((result[i].soilMoisture.val <= result[i].soilMoisture.triggersIrrigation) && (result[i].autoOnOff)) {
                    /* Wenn in der Config Regenvorhersage aktiviert: Startvorgang abbrechen, wenn es heute ausreichend regnen sollte. */
                    const resMoisture = (+ result[i].soilMoisture.val) + (+ weatherForecastTodayNum);
                    adapter.log.info('weatherForecastTodayNum, Typeof: ' + typeof weatherForecastTodayNum + '  Wert: ' + weatherForecastTodayNum + ' soilMoisture, Typeof: ' + typeof result[i].soilMoisture.val + ' Wert: ' + result[i].soilMoisture.val + ' Summe: ' + resMoisture + ' Auswertung: ' + (resMoisture <= result[i].soilMoisture.triggersIrrigation));
                    if (adapter.config.weatherForecast && (resMoisture <= result[i].soilMoisture.triggersIrrigation)) {
                        let countdown = result[i].wateringTime * (result[i].soilMoisture.maxIrrigation - result[i].soilMoisture.val) / (result[i].soilMoisture.maxIrrigation - result[i].soilMoisture.triggersIrrigation); // in min
                        // Begrenzung der Bewässerungszeit auf dem in der Config eingestellten Überschreitung (in Prozent)
                        if (countdown > (result[i].wateringTime * result[i].wateringAdd / 100)) {
                            countdown = result[i].wateringTime * result[i].wateringAdd / 100;
                        }
                        if (debug) {adapter.log.info('sprinklecontrol: ' + result[i].objectName + '  wateringTime: ' + countdown + ' (' + result[i].wateringTime + ', ' + result[i].soilMoisture.maxIrrigation + ', ' + result[i].soilMoisture.val + ', ' + result[i].soilMoisture.triggersIrrigation + ')');}
                        ObjThread.addList(
                            result[i].sprinkleID,
                            Math.round(60*countdown),
                            true);
                        messageText += '   START => ' + addTime(Math.round(60*countdown), '') + '\n';
                    } else {
                        /* Bewässerung unterdrückt da ausreichende regenvorhersage */
                        messageText += '   ' + '<i>' + 'Start verschoben, da heute ' + weatherForecastTodayNum + 'mm Niederschlag' + '</i> ' + '\n';
                        adapter.log.info(result[i].objectName + ': Start verschoben, da Regenvorhersage für Heute ' + weatherForecastTodayNum +' mm [ ' + result[i].soilMoisture.val + ' (' + resMoisture + ') <= ' + result[i].soilMoisture.triggersIrrigation + ' ]');
                    }
                } else if (!result[i].autoOnOff) {
                    messageText += '   ' + '<i>' + 'Ventil auf Handbetrieb' + '</i>' + '\n';
                }
            }
        }
        ObjMessage.messageText = messageText;
        sendMessageText(adapter, ObjMessage);
        setTimeout (() => {
            ObjThread.updateList();
            setTimeout(()=>{
                nextStartTime();
            }, 800);
            schedule.cancelJob('sprinkleStartTime');
        }, 200);
    });
}

function initConfigMessage() {
    switch (adapter.config.notificationsType) {
        case 'Telegram':
            ObjMessage = {
                /** @type {string} */   messageText: '',
                /** @type {boolean} */  enabled: adapter.config.notificationEnabled || false,
                /** @type {string} */   notificationsType: adapter.config.notificationsType,
                /** @type {string} */   type: 'message',
                /** @type {string} */   instance: adapter.config.telegramInstance,
                /** @type {boolean} */  silentNotice: adapter.config.telegramSilentNotice,
                /** @type {boolean} */  noticeType: (adapter.config.telegramNoticeType === 'longTelegramNotice'),
                /** @type {string} */   user: adapter.config.telegramUser,
                /** @type {boolean} */  onlyError: adapter.config.telegramOnlyError,
                /** @type {number} */   waiting: parseInt(adapter.config.telegramWaitToSend) * 1000
            };
            break;

        case 'E-Mail':
            ObjMessage = {
                /** @type {string} */   messageText: '',
                /** @type {boolean} */  enabled: adapter.config.notificationEnabled || false,
                /** @type {string} */   notificationsType: adapter.config.notificationsType,
                /** @type {string} */   type: 'message',
                /** @type {string} */   instance: adapter.config.emailInstance,
                /** @type {boolean} */  noticeType: (adapter.config.emailNoticeType === 'longEmailNotice'),
                /** @type {string} */   emailReceiver: adapter.config.emailReceiver,
                /** @type {string} */   emailSender: adapter.config.emailSender,
                /** @type {boolean} */  onlyError: adapter.config.emailOnlyError,
                /** @type {number} */   waiting: parseInt(adapter.config.emailWaitToSend) * 1000
            };
            break;

        case 'Pushover':
            ObjMessage = {
                /** @type {string} */   messageText: '',
                /** @type {boolean} */  enabled: adapter.config.notificationEnabled || false,
                /** @type {string} */   notificationsType: adapter.config.notificationsType,
                /** @type {string} */   type: 'message',
                /** @type {string} */   sound: adapter.config.pushoverSound,
                /** @type {string} */   instance: adapter.config.pushoverInstance,
                /** @type {boolean} */  silentNotice: adapter.config.pushoverSilentNotice,
                /** @type {boolean} */  noticeType: (adapter.config.pushoverNoticeType === 'longPushoverNotice'),
                /** @type {string} */   deviceID: adapter.config.pushoverDeviceID,
                /** @type {boolean} */  onlyError: adapter.config.pushoverOnlyError,
                /** @type {number} */   waiting: parseInt(adapter.config.pushoverWaitToSend) * 1000
            };
            break;

        case 'WhatsApp':
            ObjMessage = {
                /** @type {string} */   messageText: '',
                /** @type {boolean} */  enabled: adapter.config.notificationEnabled || false,
                /** @type {string} */   notificationsType: adapter.config.notificationsType,
                /** @type {string} */   type: 'message',
                /** @type {string} */   instance: adapter.config.whatsappInstance,
                /** @type {boolean} */   noticeType: (adapter.config.whatsappNoticeType === 'longWhatsappNotice'),
                /** @type {boolean} */  onlyError: adapter.config.whatsappOnlyError,
                /** @type {number} */   waiting: parseInt(adapter.config.whatsappWaitToSend) * 1000
            };
            break;
    }
}

//
function createSprinklers() {
    const result = adapter.config.events;
    if (result) {	
        for(const i in result) {
            const objectName = result[i].sprinkleName.replace(/[.;, ]/g, '_');
            const objPfad = 'sprinkle.' + objectName;
            const j = resConfigChange.findIndex(d => d.objectName === objectName);
            // Create Object for sprinklers (ID)
            adapter.setObjectNotExists('sprinkle.' + objectName, {
                'type': 'channel',
                'common': {
                    'name': result[i].sprinkleName
                },
                'native': {},
            });
            // Create Object for sprinklers (ID)
            adapter.setObjectNotExists('sprinkle.' + objectName + '.history', {
                'type': 'channel',
                'common': {
                    'name': result[i].sprinkleName + ' => History'
                },
                'native': {},
            });

            // actual soil moisture
            // Create .actualSoilMoisture
            adapter.setObjectNotExists(objPfad + '.actualSoilMoisture', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => actual soil moisture in %',
                    'type':  'number',
                    'min':   0,
                    'max':   100,
                    'unit':  '%',					
                    'read':  true,
                    'write': false,
                    'def':   false
                },
                'native': {},
            });
            // actual state of sprinkler => Zustand des Ventils im Thread
            // <<< 1  = warten >>> ( 0 = Aus, 2 = Active, 3 = Pause )
            // Create .sprinklerState
            adapter.setObjectNotExists(objPfad + '.sprinklerState', {
                'type': 'state',
                'common': {
                    'role':  'state',
                    'name':  objectName + ' => actual state of sprinkler',
                    'type':  'number',
                    'min':	0,
                    'max':	3,
                    'states': '0:off;1:wait;2:on;3:break;4:Boost(on);5:off(Boost)',
                    'read':  true,
                    'write': false,
                    'def':   false
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
                    'def':   false
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
                    'def':   false
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
                    'def':   false
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
                    'def':   false
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
                    'def':   false
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
                    'def':   false
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
                    'def':   false
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
                    'def':   false
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
                    'def':   false
                },
                'native': {},
            });			
            setTimeout(() => {
                adapter.getState(objPfad + '.actualSoilMoisture', (err, state) => {

                    if (state == null || state.val == null || state.val === true || state.val === 0) {
                        adapter.setState(objPfad + '.actualSoilMoisture', {
                            val: resConfigChange[j].soilMoisture.pct,
                            ack: true
                        });
                    } else {
                        // num Wert der Bodenfeuchte berechnen und speichern im Array
                        if ((0 < state.val) || (state.val <= 100)) {
                            resConfigChange[j].soilMoisture.val = state.val * resConfigChange[j].soilMoisture.maxIrrigation / 100;
                            resConfigChange[j].soilMoisture.pct = state.val;
                        } else {

                            adapter.setState(objPfad + '.actualSoilMoisture', {
                                val: resConfigChange[j].soilMoisture.pct,
                                ack: true
                            });
                        }
                    }
                });
				
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
                        adapter.setState(objPfad + '.countdown', {val: 0, ack: true});
                    }
                });
                // history		
                adapter.getState(objPfad + '.history.lastRunningTime', (err, state) => {
                    if (state.val === false) {
                        adapter.setState(objPfad + '.history.lastRunningTime', {val: '00:00', ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.lastOn', (err, state) => {
                    if (state.val === false) {
                        adapter.setState(objPfad + '.history.lastOn', {val: '-', ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.lastConsumed', (err, state) => {
                    if (state.val === false) {
                        adapter.setState(objPfad + '.history.lastConsumed', {val: 0, ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.curCalWeekConsumed', (err, state) => {
                    if (state.val === false) {
                        adapter.setState(objPfad + '.history.curCalWeekConsumed', {val: 0, ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.lastCalWeekConsumed', (err, state) => {
                    if (state.val === false) {
                        adapter.setState(objPfad + '.history.lastCalWeekConsumed', {val: 0, ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.curCalWeekRunningTime', (err, state) => {
                    if (state.val === false) {
                        adapter.setState(objPfad + '.history.curCalWeekRunningTime', {val: '00:00', ack: true});
                    }
                });
                adapter.getState(objPfad + '.history.lastCalWeekRunningTime', (err, state) => {
                    if (state.val === false) {
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
                const res = resultName[i].sprinkleName.replace(/[.;, ]/g, '_');
                fullRes.push(res);
            }
            setTimeout(() => {

                if (fullRes.indexOf(resultID) === -1) {
                    // State löschen
					
                    // History - Objekt(Ordner) löschen					
                    adapter.delObject(resID + '.history', function (err) {
                        if (err) {
                            adapter.log.warn(err);
                        }
                    });					
                    // State löschen
                    adapter.delObject(resID + '.actualSoilMoisture');	// "sprinklecontrol.0.sprinkle.???.actualSoilMoisture"
                    adapter.delObject(resID + '.sprinklerState');	// "sprinklecontrol.0.sprinkle.???.sprinklerState"
                    adapter.delObject(resID + '.runningTime');	//	"sprinklecontrol.0.sprinkle.???.runningTime"
                    adapter.delObject(resID + '.countdown');	//	"sprinklecontrol.0.sprinkle.???.countdown"
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
// Start
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
            /*debug = adapter.config.debug;*/
            checkStates();
        }
    });

    timer = setTimeout(function() {
        setActualPump();
        checkActualStates();
        sunPos();
    }, 2000);

    GetSystemData();
    initConfigMessage();

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
    if (adapter.config.sensorBrightness !== '') {
        adapter.subscribeForeignStates(adapter.config.sensorBrightness);
    }
    if (adapter.config.sensorOutsideHumidity !== '') {
        adapter.subscribeForeignStates(adapter.config.sensorOutsideHumidity);
    }
    if (adapter.config.sensorOutsideTemperature !== '') {
        adapter.subscribeForeignStates(adapter.config.sensorOutsideTemperature);
    }
    if (adapter.config.sensorRainfall !== '') {
        adapter.subscribeForeignStates(adapter.config.sensorRainfall);
    }
    if (adapter.config.sensorWindSpeed !== '') {
        adapter.subscribeForeignStates(adapter.config.sensorWindSpeed);
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
    //
    // Report a change in the status of the trigger IDs (.runningTime) => Melden einer Änderung des Status der Trigger-IDs
    const result = adapter.config.events;
    if (result) {
        for(const i in result) {
            const objectName = result[i].sprinkleName.replace(/[.;, ]/g, '_');
            const newEntry = {
                /** @type {boolean} */ 'enabled': result[i].enabled || false,
                /** @type {boolean} */ 'booster': result[i].booster,
                /** @type {number} */ 'endIrrigation': result[i].endIrrigation,
                /** @type {boolean} */ 'autoOnOff': true,
                /** @type {string} */ 'objectName': objectName,		// z.B. Rasenumrandung
                /** @type {string} */ 'objectID': adapter.namespace + '.sprinkle.' + objectName + '.runningTime',		// sprinklecontrol.0.sprinkle.Rasenumrandung.runningTime
                /** @type {string}  */ 'idState': result[i].name,      // "hm-rpc.0.MEQ1234567.3.STATE"
                /** @type {number} */ 'sprinkleID': resConfigChange.length,		// Array[0...]
                /** @type {number} */ 'wateringTime': parseInt(result[i].wateringTime),		// ...min
                /** @type {number} */ 'wateringAdd': parseInt(result[i].wateringAdd),		// 0 ... 200%
                /** @type {number} */ 'wateringInterval': ((60 * parseInt(result[i].wateringInterval)) || 0),		// 5,10,15min
                /** @type {number} */ 'pipeFlow': parseInt(result[i].pipeFlow),
                'soilMoisture': {
                    /** @type {number} */ 'val': parseInt(result[i].maxSoilMoistureIrrigation) / 2,		        // (zB. 5 mm)
                    /** @type {number} */ 'pct': 50,                                                            //  50% = maxSoilMoistureIrrigation) / 2
                    /** @type {number} */ 'min': parseInt(result[i].maxSoilMoistureIrrigation) / 100,		    // (zB. 0,02 mm)
                    /** @type {number} */ 'maxIrrigation': parseInt(result[i].maxSoilMoistureIrrigation),		// (zB. 10 mm)
                    /** @type {number} */ 'maxRain': parseInt(result[i].maxSoilMoistureRain),		            // (zB. 12 mm)
                    /** @type {number} */ 'triggersIrrigation': parseInt(result[i].maxSoilMoistureIrrigation) * parseInt(result[i].triggersIrrigation) / 100,		// (zB. 50 % ==> 5 mm)
                    /** @type {number} */ 'pctTriggerIrrigation': parseInt(result[i].triggersIrrigation),       // (zB. 50%)
                }
            };
            resConfigChange.push(newEntry);
            // resConfigChange[objectName] = newEntry;
            if (newEntry.enabled) {
                adapter.subscribeStates(newEntry.objectID);	// abonnieren der Statusänderungen des Objekts (reagieren auf 'runningTime' der einzelnen Bewässerungskreise)
            }
            if (debug) {adapter.log.info('main => resConfigChange add: ' + objectName + '(' + newEntry.sprinkleID + ')   ' + JSON.stringify(resConfigChange[newEntry.sprinkleID]));}
        }
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