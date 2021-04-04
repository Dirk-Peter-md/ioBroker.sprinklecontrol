'use strict';

const myConfig = require('./myConfig.js');
const addTime = require('./tools.js').addTime;
const formatTime = require('./tools').formatTime;
const sendMessageText = require('./sendMessageText.js');            // sendMessageText

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;

/**
 * debug - intern setzbar zur Fehlerermittlung im aktuellen Modul
 * @type {boolean}
 */
const debug = false;

/**
 * Thread-list
 * => Auflistung aller aktiver Sprenger-Kreise
 * @type {array}
 */
const threadList = [];

/** @type {boolean} */
let boostReady = true,
    /** @type {boolean} */
    boostOn = false,
    /** @type {number | undefined} */
    boostListTimer;

/* Control of the cistern pump */
/** @type {number} */
let fillLevelCistern = 0;

const currentPumpUse = {
    /**
     * Pumpen aktive?
     * @type {boolean} */
    enable: false,
    /**
     * Zisterne aktive?
     * @type {boolean} */
    pumpCistern: false,
    /**
     * Pumpen-Bezeichnung; z.B. "hm-rpc.0.MEQ1810129.1.STATE"
     * @type {string} */
    pumpName: '',
    /**
     * Pumpenleistung in l/h
     * @type {number}  */
    pumpPower: 0
}

/**
 *
 * @type {{clearEntireList: valveControl.clearEntireList,
 * initValveControl: valveControl.initValveControl,
 * setFillLevelCistern: valveControl.setFillLevelCistern,
 * addList: (function(Array<{autoOn: Boolean, sprinkleID: Number, wateringTime: Number}>): undefined)}}
 */
const valveControl = {
    /**
     * Initialize the start configuration of ventilControl
     * => Initialisieren Sie die Startkonfiguration von ventilControl
     * @param {ioBroker.Adapter} myAdapter
     */
    initValveControl: (myAdapter) => {
        adapter = adapter || myAdapter;
        currentPumpUse.pumpCistern = false;
        currentPumpUse.pumpName = adapter.config.triggerMainPump || '';
        currentPumpUse.pumpPower = parseInt(adapter.config.triggerMainPumpPower) || 0;
        /* Objekt control.restFlow befüllen */
        adapter.setState('control.restFlow', {
            val: currentPumpUse.pumpPower + ' (' + currentPumpUse.pumpPower + ' ' + (currentPumpUse.pumpCistern ? 'Zisterne' : 'Grundwasser') + ')',
            ack: true
        });
        /* Objekt control.parallelOfMax befüllen */
        adapter.setState('control.parallelOfMax', {
            val: 0 + ' : ' + adapter.config.maximumParallelValves,
            ack: true
        });
        /* Pumpe ausschalter wenn vorhanden */
        if (adapter.config.triggerMainPump !== '') {
            adapter.getState('adapter.config.triggerMainPump', (err, state) => {
                if (state) {
                    adapter.setState(adapter.config.triggerMainPump, {
                        val: false,
                        ack: false
                    });
                }
            });
        }
        /* Pumpe (Zisterne) ausschalter wenn vorhanden */
        if (adapter.config.triggerCisternPump !== '') {
            adapter.getState('adapter.config.triggerCisternPump', (err, state) => {
                if (state) {
                    adapter.setState(adapter.config.triggerCisternPump, {
                        val: false,
                        ack: false
                    });
                }
            });
        }
        /* alle Ventile (.name = "hm-rpc.0.MEQ1234567.3.STATE") in einem definierten Zustand (false) versetzen*/
        const result = adapter.config.events;
        if (result) {
            for(const res of result) {
                adapter.getState(res.name, (err, state) => {
                    if (state) {
                        adapter.setState(res.name, {
                            val: false,
                            ack: false
                        });
                    }
                });
            }
        }
    },  // End initValveControl

    /**
     *  Add Sprinkle
     * => Sprinkle hinzufügen
     * @param {Array.<{autoOn: Boolean, sprinkleID: Number, wateringTime: Number}>} sprinkleList
     */
    addList: (sprinkleList) => {
        //
        for (const res of sprinkleList) {
            const sprinkleName = myConfig.config[res.sprinkleID].objectName;
            /**
             * add done
             * => hinzufügen erledigt (Sprenger bereits aktive)
             * @type {boolean}
             */
            let addDone = false;
            // schauen ob der Sprenger schon in der threadList ist
            if (threadList) {
                for (const entry of threadList) {
                    if (entry.sprinkleID === res.sprinkleID) {
                        if (entry.wateringTime === res.wateringTime) {
                            // adapter.setState('sprinkle.' + sprinkleName + '.runningTime', {val: addTime(wateringTime, ''), ack: false});
                            return;
                        }
                        entry.wateringTime = res.wateringTime;
                        entry.autoOn = res.autoOn;      // autoOn: = true autostart; = false Handbetrieb
                        adapter.setState('sprinkle.' + sprinkleName + '.runningTime', {
                            val: addTime(res.wateringTime, ''),
                            ack: false
                        });
                        addDone = true;		// Sprinkle found
                        if (adapter.config.debug) {
                            adapter.log.info('addList (' + entry.sprinkleName + ') addDone time geändert: ' + addTime(res.wateringTime, ''));
                        }
                        break;
                    }
                }
            }

            if (!addDone) {
                if (res.wateringTime <= 0) {
                    adapter.setState('sprinkle.' + sprinkleName + '.runningTime', {
                        val: '0',
                        ack: true
                    });
                    return;
                }
                const newThread = {};
                /** @type {number} */   newThread.sprinkleID = res.sprinkleID;	// Array[0...]
                /** @type {string} */   newThread.sprinkleName = sprinkleName;	// z.B "Blumenbeet"
                /** @type {string} */   newThread.idState = myConfig.config[res.sprinkleID].idState;	// z.B. "hm-rpc.0.MEQ1810129.1.STATE"
                /** @type {number} */   newThread.wateringTime = res.wateringTime;  // Bewässerungszeit
                /** @type {number} */   newThread.pipeFlow = myConfig.config[res.sprinkleID].pipeFlow;  // Wasserverbrauch
                /** @type {number} */   newThread.count = 0;
                /** @type {boolean} */  newThread.enabled = false;
                /** @type {boolean} */  newThread.myBreak = false;
                /** @type {number} */   newThread.litersPerSecond = myConfig.config[res.sprinkleID].pipeFlow / 3600;    // Wasserverbrauchsmenge pro Sekunde
                /** @type {number} */   newThread.onOffTime = myConfig.config[res.sprinkleID].wateringInterval;
                /** @type {boolean} */  newThread.autoOn = res.autoOn;
                /** @type {number} */   newThread.soilMoisture15s = 15 * (myConfig.config[res.sprinkleID].soilMoisture.maxIrrigation - myConfig.config[res.sprinkleID].soilMoisture.triggersIrrigation)
                    / (60 * myConfig.config[res.sprinkleID].wateringTime);
                /** @type {any} */      newThread.times = [];       // hinterlegen der verschiedenen Zeiten von timeout für gezieltes späteres löschen
                /** @type {any} */      newThread.times.boostTime1 = null;  // boost start
                /** @type {any} */      newThread.times.boostTime2 = null;  // boost ende
                /** @type {number} */   newThread.id = threadList.length || 0;
                threadList.push(newThread);
                /* Zustand des Ventils im Thread < 0 > off, <<< 1 >>> wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                valveState(newThread, 'wait');
                adapter.setState('sprinkle.' + sprinkleName + '.runningTime', {
                    val: addTime(res.wateringTime, ''),
                    ack: false
                });
                if (debug) {
                    adapter.log.info('addList (' + newThread.sprinkleName + '): ' + JSON.stringify(threadList[newThread.id]));
                }
            }
        }
        setTimeout(() => {updateList();}, 50);
    }, // End addList

    /**
     * switch off all devices, when close the adapter
     * => Beim Beenden des adapters alles ausschalten
     */
    clearEntireList: () => {
        if (boostListTimer) {
            clearTimeout(boostListTimer);
        }
        // let bValveFound = false;	// Ventil gefunden
        for (let counter = threadList.length - 1;	// Loop über das Array
             counter >= 0;
             counter--) {
            const myEntry = threadList[counter];
            /* Zustand des Ventils im Thread <<< 0 >>> off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
            valveState(myEntry, 'off');
            /* Verbrauchswerte in der Historie aktualisieren */
            addConsumedAndTime(myEntry);
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

            if (debug) {
                adapter.log.info('clearEntireList (' + myEntry.sprinkleName + '): Ventil wird gelöscht:');
            }
            threadList.pop();
            if (debug) {
                adapter.log.info('clearEntireList (' + myEntry.sprinkleName + ') Ventil ist gelöscht => noch vorhandene Ventile: ' + threadList.length);
            }
        }
        setTimeout(() => {updateList()}, 50);
    }, // End clearEntireList

    /**
     *
     * @param {number} levelCistern
     */
    setFillLevelCistern: (levelCistern) => {
    fillLevelCistern = (typeof levelCistern === 'number') ? levelCistern : 0 ;
    setActualPump();
    }   // End setFillLevelCistern
};  // End valveControl


/**
 * Sprinkle (sprinkleName) delete
 * => Ventil (sprinkleName) löschen
 * @param sprinkleName {string}
 */
function delList (sprinkleName) {
    let bValveFound = false;	// Ventil gefunden
    for(let counter = 0,                                  // Loop über das Array
        lastArray = (threadList.length - 1);     // entsprechend der Anzahl der Eintragungen
        counter <= lastArray;
        counter++) {
        const entry = threadList[counter].sprinkleName;
        if ((sprinkleName === entry) || bValveFound) {
            if (sprinkleName === entry) bValveFound = true;
            if (counter !== lastArray) threadList[counter] = threadList[counter + 1];
        }
    }
    /* If a valve is found, delete the last array (entry). Wenn Ventil gefunden letzten Array (Auftrag) löschen */
    if (bValveFound) {
        threadList.pop();
        if (adapter.config.debug) {adapter.log.info('delList (' + sprinkleName + ') !!! >>> wurde gelöscht');}
    }

    setTimeout(() => {updateList()}, 50);

} // End delList

/**
 *
 *
 * @param sprinkleID {number}
 */
function boostList (sprinkleID) {
    boostReady = false;
    boostOn = true;
    for(const entry of threadList) {
        if (entry.enabled) {
            if (entry.sprinkleID === sprinkleID) {      // Booster
                /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, < 2 > on, < 3 > break, <<< 4 >>> Boost(on), < 5 > off(Boost) */
                valveState(entry, 'Boost(on)');
                entry.times.boostTime2 = setTimeout(() => {
                    /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                    valveState(entry, 'on');
                    entry.times.boostTime2 = null;
                },31000);
            } else {    // rest der Ventile
                entry.times.boostTime1 = setTimeout(() => {
                    /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), <<< 5 >>> off(Boost) */
                    valveState(entry, 'off(Boost)');
                    entry.times.boostTime1 = null;
                },250);
                entry.times.boostTime2 = setTimeout(() => {
                    /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                    valveState(entry, 'on');
                    entry.times.boostTime2 = null;
                },31000);
            }
        }
    }
    boostListTimer = setTimeout(() => {
        boostOn = false;
        setTimeout(() => {updateList();},50);
    },32000);
} // End boostList

    //
/**
 * If boostOn is ended by entering "runningTime = 0", normal operation should be restored. (Delete timer)
 * => Wenn boostOn über die Eingabe "runningTime = 0" beendet wird, so soll zum Normalen ablauf wieder zurückgekehrt werden. (Löschen der Timer)
 * @param sprinkleID {number}
 */
function boostKill (sprinkleID) {
    for(const entry of threadList) {
        if (entry.enabled) {
            if (entry.sprinkleID === sprinkleID) {
                /* booster wird gekillt */
                boostOn = false;
                if(entry.times.boostTime2) {
                    clearTimeout(entry.times.boostTime2);
                    entry.times.boostTime2 = null;
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
                    valveState(entry, 'on');
                }
            }
        }
    }
} // End boostKill

/**
 * Control of the active irrigation circuits so that the maximum pump capacity (l / h) is achieved and the maximum number of irrigation circuits is not exceeded.
 * => Steuerung der aktiven Bewässerungskreise, damit die maximale Pumpenkapazität (l / h) erreicht wird und die maximale Anzahl der Bewässerungskreise nicht überschritten wird.
 */
function updateList () {
    /* während des Boost eines Kreises ist ein zuschalten von Sprengern nicht möglich */
    if (boostOn) {return;}

    /**
     * aktuelle Rest-Pumpenleistung
     * @type {number}
     */
    let curFlow = currentPumpUse.pumpPower; /* adapter.config.triggerMainPumpPower; */
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
        if (boostOn && !(myConfig.config[entry.sprinkleID].booster)   // boost-On && kein aktuelles Boost-Ventil
        ) {
            return;
        }
        entry.count ++;
        if ((entry.count < entry.wateringTime)	// Zeit noch nicht abgelaufen?
            && ((myConfig.config[entry.sprinkleID].soilMoisture.val < myConfig.config[entry.sprinkleID].soilMoisture.maxIrrigation)		// Bodenfeuchte noch nicht erreicht? (z.B. beim Regen)
                || !entry.autoOn)	// Vergleich nur bei Automatik
        ) {     /* zeit läuft */
            adapter.setState('sprinkle.' + entry.sprinkleName + '.countdown', {
                val: addTime(entry.wateringTime - entry.count, ''),
                ack: true
            });
            /* Alle 15s die Bodenfeuchte anpassen */
            if (!(entry.count % 15)) {	// alle 15s ausführen
                myConfig.addSoilMoistVal(entry.sprinkleID, entry.soilMoisture15s);
            }
            /* Intervall-Beregnung wenn angegeben (onOffTime > 0) */
            if ((entry.onOffTime > 0) && !(entry.count % entry.onOffTime)) {
                entry.enabled = false;
                entry.myBreak = true;
                /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, < 2 > on, <<< 3 >>> break, < 4 > Boost(on), < 5 > off(Boost) */
                valveState(entry, 'break');
                setTimeout(() => {updateList()},50);
                clearInterval(entry.countdown);
                entry.onOffTimeoutOff = setTimeout(()=>{
                    entry.myBreak = false;
                    /* Zustand des Ventils im Thread < 0 > off, <<< 1 >>> wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                    valveState(entry, 'wait');
                    setTimeout(() => {updateList()},50);
                },1000 * entry.onOffTime);
            }
        } else {    /* zeit abgelaufen => Ventil ausschalten */
            /* Zustand des Ventils im Thread <<< 0 >>> off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
            valveState(entry, 'off');
            /* Wenn in der Konfiguration Bodenfeuchte = 100% gesetzt ist und Auto-Bewässerung aktive, dann Bodenfeuchte = 100% setzen*/
            if (entry.autoOn && myConfig.config[entry.sprinkleID].endIrrigation) {
                myConfig.setSoilMoistPct100(entry.sprinkleID);
            }
            /* Verbrauchswerte in der Historie aktualisieren */
            addConsumedAndTime(entry);
            /* Booster zurücksetzen */
            if (myConfig.config[entry.sprinkleID].booster) {
                if (boostOn) {boostKill(entry.sprinkleID);}
                boostReady = true;
                if (adapter.config.debug) {adapter.log.info('UpdateList Sprinkle Off: sprinkleID: ' + entry.sprinkleID + ', boostReady = ' + boostReady);}
            }
            /* Zeiten löschen */
            clearInterval(entry.countdown);
            /*clearTimeout(entry.onOffTimeoutOn);*/
            clearTimeout(entry.onOffTimeoutOff);
            /* Ventil aus threadList löschen => Aufgabe beendet */
            delList(entry.sprinkleName);
        }
    }

    // ermitteln von curPipe und der anzahl der parallelen Stränge
    for(const entry of threadList){
        if (entry.enabled) {
            curFlow -= entry.pipeFlow;	// // ermitteln der RestFörderkapazität
            parallel ++;	// Anzahl der Bewässerungsstellen um 1 erhöhen
        }
    }

    if (curFlow < 0) {
        /* - wenn beim Umschalten der Pumpen die Förderleistung zu gering ist Ventile deaktivieren - */
        // aufsteigend sortieren nach der Verbrauchsmenge
        threadList.sort(mySortAscending);

        for(const entry of threadList) {
            if ((entry.enabled)                           // eingeschaltet
                && (curFlow < 0)) {        // Förderleistung der Pumpe zu gering
                entry.enabled = false;      // ausgeschaltet merken
                clearInterval(entry.countdown); // Zähler für Countdown, Verbrauchsmengen, usw. löschen
                curFlow += entry.pipeFlow;	// ermitteln der RestFörderkapazität
                parallel--;	// Anzahl der Bewässerungsstellen um 1 verringern
                adapter.log.info('(697) Förderleistung Verbraucher löschen: Name ' + entry.sprinkleName + ' curFlow ' + curFlow + ' parallel: ' + parallel);
                /* Zustand des Ventils im Thread < 0 > off, <<< 1 >>> wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                valveState(entry, 'wait');
            }
        }
    }

    // absteigend sortieren nach der Verbrauchsmenge
    threadList.sort(mySortDescending);

    // einschalten der Bewässerungsventile nach Verbrauchsmenge und maximaler Anzahl
    for(const entry of threadList) {
        if (!entry.enabled                                                      // ausgeschaltet
            && !entry.myBreak                                                   // nicht mehr in der Pause
            && (curFlow >= entry.pipeFlow)                                      // noch genügend Förderleistung der Pumpe
            && (parallel < maxParallel)                                         // maxParallel noch nicht erreicht
            && ((boostReady) || !(myConfig.config[entry.sprinkleID].booster))   // nur einer mit boostFunction darf aktive sein
        ) {
            entry.enabled = true;	// einschalten merken
            if (myConfig.config[entry.sprinkleID].booster) {
                boostReady = false;
                if (adapter.config.debug) {
                    adapter.log.info('UpdateList sprinkle On: sprinkleID: ' + entry.sprinkleID + ', boostReady = ' + boostReady);
                }
                setTimeout(() => {
                    boostList(entry.sprinkleID);
                }, 50);
            }
            curFlow -= entry.pipeFlow;	// ermitteln der RestFörderkapazität
            parallel++;	// Anzahl der Bewässerungsstellen um 1 erhöhen
            adapter.log.info('(737) Förderleistung Verbraucher hinzufügen: Name ' + entry.sprinkleName + ' curFlow ' + curFlow + ' parallel: ' + parallel);
            /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
            valveState(entry, 'on');
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
    setPumpOnOff(parallel > 0);

} // End updateList

/* --------------------------------------------------------------------------------------------------------------------------------------------------------------------- */



/**
 * +++++  Set the current pump for irrigation  +++++
 * => Festlegen der aktuellen Pumpe zur Bewässerung
 */
function setActualPump () {
    if (adapter.config.cisternSettings === true) {
        /* Zisternen-Bewässerung Einstellung in der config (2.Pumpe) aktiviert */
        if (currentPumpUse.enable === true) {
            /* Bewässerungspumpen aktiv */
            if ((fillLevelCistern < parseFloat(adapter.config.triggerMinCisternLevel)) && (currentPumpUse.pumpCistern === true)) {
                /* (Zisterne unter Minimum) && (ZisternenPumpe läuft) */
                adapter.setForeignState(currentPumpUse.pumpName, {
                    val: false,
                    ack: false
                }); // Pumpe Zisterne Aus
                currentPumpUse.pumpCistern = false;
                currentPumpUse.pumpName = adapter.config.triggerMainPump || '';
                currentPumpUse.pumpPower = parseInt(adapter.config.triggerMainPumpPower);
                adapter.setForeignState(currentPumpUse.pumpName, {
                    val: true,
                    ack: false
                }); // Hauptpumpe Ein
                adapter.log.info('Pumpenwechsel (Zisterne leer) Zisternen-Pumpe aus => Hauptpumpe ein');
                updateList();   // Wasserverbrauch an Pumpenleistung anpassen
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
                currentPumpUse.pumpPower = parseInt(adapter.config.triggerCisternPumpPower);
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
                currentPumpUse.pumpPower = parseInt(adapter.config.triggerMainPumpPower);
                adapter.setState('control.restFlow', {
                    val: currentPumpUse.pumpPower + ' (' + currentPumpUse.pumpPower + ' Grundwasser)',
                    ack: true
                });
            }
        }
    } else {
        /* Pumpe AUS => Zisternen-Bewässerung nicht aktiviert */
        if (adapter.config.triggerCisternPump) {
            adapter.setState('info.cisternState', {
                val: 'Cistern settings are not active!' + ((fillLevelCistern > 0)?(' level sensor: ' + fillLevelCistern + '%' + ((adapter.config.triggerMinCisternLevel !== '')?('  (' + adapter.config.triggerMinCisternLevel + '%)'):(''))):('')),
                ack: true
            });
        }
    }
}   // End setActualPump

    /**
     * Switching the pump on or off
     * => Ein bzw. ausschaltern der Pumpe
     * @param {boolean} pumpOnOff ; Pumpe on = true
     */
function setPumpOnOff(pumpOnOff) {
    if (currentPumpUse.pumpName !== '') {
        adapter.getForeignState(currentPumpUse.pumpName, (err, state) => {
            if (state) {
                if (pumpOnOff) {
                    if (state.val === false) {
                        adapter.setForeignState(currentPumpUse.pumpName, {
                            val: true,
                            ack: false
                        });
                        currentPumpUse.enable = true;
                        adapter.log.info('Hauptpumpe eingeschaltet');
                    }
                } else {
                    if (state.val !== false) {
                        adapter.setForeignState(currentPumpUse.pumpName, {
                            val: false,
                            ack: false
                        });
                        currentPumpUse.enable = false;
                        adapter.log.info('Hauptpumpe ausgeschaltet');
                    }
                }
            } else if (err) {
                adapter.log.error('triggerMainPump ' + currentPumpUse.pumpName + ' is not available (ist nicht erreichbar): ' + err);
            }
        });
    }
}   // End setPumpOnOff

/**
 * Adding the consumption data to the history
 * => Hinzufügen der Verbrauchsdaten zur History
 * @param curEntry - array mit den Daten des aktiven Ventils
 */
function addConsumedAndTime(curEntry) {
    adapter.setState('sprinkle.' + curEntry.sprinkleName + '.history.lastConsumed', {
        val: Math.round(curEntry.litersPerSecond * curEntry.count),
        ack: true
    });
    adapter.setState('sprinkle.' + curEntry.sprinkleName + '.history.lastRunningTime', {
        val: addTime(curEntry.count, ''),
        ack: true
    });
    adapter.setState('sprinkle.' + curEntry.sprinkleName + '.history.lastOn', {
        val: formatTime(adapter, curEntry.startTime, 'dd.mm. hh:mm'),
        ack: true
    });
    adapter.getState('sprinkle.' + curEntry.sprinkleName + '.history.curCalWeekConsumed', (err, state) => {
        if (state) {
            adapter.setState('sprinkle.' + curEntry.sprinkleName + '.history.curCalWeekConsumed', {
                val: (state.val) + Math.round(curEntry.litersPerSecond * curEntry.count),
                ack: false
            });
        }
    });
    adapter.getState('sprinkle.' + curEntry.sprinkleName + '.history.curCalWeekRunningTime', (err, state) => {
        if (state) {
            adapter.setState('sprinkle.' + curEntry.sprinkleName + '.history.curCalWeekRunningTime', {
                val: addTime(state.val, curEntry.count),
                ack: true
            });
        }
    });
}   // End addConsumedAndTime


/* Zustand des Ventils im Thread < 0 > off, <<< 1 >>> wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
/**
 *
 * @param {object} valve - Objekt mit den Daten des aktiven Ventils
 * @param {string} newState - Zustand des Ventils im Thread => off : 0, wait : 1, on : 2, break : 3, Boost(on) : 4, off(Boost) : 5
 */
function valveState (valve, newState) {
    /**
     * Ventil schalten wenn aktueller Zustand des Ventils abweicht
     * @param {boolean} onOff - Zustand des Ventils
     */
    function valveOnOff (onOff) {
        adapter.getForeignState(valve.idState, (err, state) => {
            if (err) {
                adapter.log.error('triggerValve ' + valve.sprinkleName + ' is not available (ist nicht erreichbar): ' + err);
            } else {
                if (state.val !== onOff) {
                    myConfig.setValveTimerID(valve.sprinkleID, onOff);
                    adapter.setForeignState(valve.idState, {
                        val: onOff,
                        ack: false
                    }, (err) => {
                        if (err) {
                            adapter.log.error('Error #20 Set ID: ' + valve.sprinkleName + ', value: ' + onOff + ', err: ' + err);
                            sendMessageText.sendMessage('Error - #20 Set ID:' + valve.sprinkleName + '(' + onOff + ')' + 'err: ' + err);
                        } else {
                            adapter.log.info('#20 Set ID: ' + valve.sprinkleName + ', value: ' + onOff);
                        }
                    });

                }
            }
        });
    }

    switch (newState) {
        case 'off' :
            adapter.setState('sprinkle.' + valve.sprinkleName + '.sprinklerState', {
                val: 0,
                ack: true
            });
            adapter.setState('sprinkle.' + valve.sprinkleName + '.runningTime', {
                val: 0,
                ack: true
            });
            adapter.setState('sprinkle.' + valve.sprinkleName + '.countdown', {
                val: 0,
                ack: true
            });
            valveOnOff(false);
            break;

        case 'wait' :
            adapter.setState('sprinkle.' + valve.sprinkleName + '.sprinklerState', {
                val: 1,
                ack: true
            });
            valveOnOff(false);
            break;

        case 'on' :
            adapter.setState('sprinkle.' + valve.sprinkleName + '.sprinklerState', {
                val: 2,
                ack: true
            });
            valveOnOff(true);
            break;

        case 'break' :
            adapter.setState('sprinkle.' + valve.sprinkleName + '.sprinklerState', {
                val: 3,
                ack: true
            });
            valveOnOff(false);
            break;

        case 'Boost(on)' :
            adapter.setState('sprinkle.' + valve.sprinkleName + '.sprinklerState', {
                val: 4,
                ack: true
            });
            valveOnOff(true);
            break;

        case 'off(Boost)' :
            adapter.setState('sprinkle.' + valve.sprinkleName + '.sprinklerState', {
                val: 5,
                ack: true
            });
            valveOnOff(false);
            break;
    }
}

module.exports = valveControl;