'use strict';

const myConfig = require('./myConfig.js');
const addTime = require('./tools.js').addTime;
const formatTime = require('./tools').formatTime;
const sendMessageText = require('./sendMessageText.js');            // sendMessageText

/**
 * The adapter instance
 */
let adapter;

/**
 * Thread-list
 * → Auflistung aller aktiver Sprenger-Kreise
 */
const threadList = [];

/** bereit für Boost */
let boostReady = true;
/** Boost ist aktive */
let boostOn = false;
/** Timer für die Länge des */
let boostListTimer;
/** maximal zulässige Anzahl der eingeschalteten Ventile */
let maxParallel = 0;
/** Füllstand der Zisterne */
let fillLevelCistern = 0;
let statusCistern = '';

const currentPumpUse = {
    /** Pumpen aktive? */
    enable: false,
    /** Zisterne aktive? */
    pumpCistern: false,
    /** Pumpen-Bezeichnung; z.B. "hm-rpc.0.MEQ1810129.1.STATE" */
    pumpName: '',
    /** Pumpenleistung in l/h */
    pumpPower: 0
};


/*==============================================================================================================================================*/
/*                                                            interne Funktionen                                                                */
/*----------------------------------------------------------------------------------------------------------------------------------------------*/

/**
 * Sprinkle (sprinkleName) delete
 * → Ventil (sprinkleName) löschen
 *
 * @param killList - sprinkleName der zu löschenden Objekte
 */
function delList (killList) {
    for(const sprinkleName of killList) {
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
            adapter.log.debug(`delList=> order deleted ID: ${sprinkleName} ( rest orders: ${threadList.length} )`);
        }
    }

} // End delList

/*----------------------------------------------------------------------------------------------------------------------------------------------*/

/**
 * Activation of the booster (all other active valves are deactivated for the duration of the boost so that the sprinkler can be extended with the maximum possible pressure)
 * => aktivierung des Boosters (alle anderen aktiven Ventile werden für die Zeit des Boosts deaktiviert um den maximalen möglichen Druck zum Ausfahren der Sprenger zu ermöglichen)
 *
 * @param sprinkleID
 */
function boostList (sprinkleID) {
    boostReady = false;
    boostOn = true;
    for(const entry of threadList) {
        if (entry.enabled) {
            if (entry.sprinkleID === sprinkleID) {      // Booster
                /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, < 2 > on, < 3 > break, <<< 4 >>> Boost(on), < 5 > off(Boost) */
                adapter.setState(`sprinkle.${entry.sprinkleName}.sprinklerState`, {
                    val: 4,
                    ack: true
                });
                //valveState(entry, 'Boost(on)');
                entry.times.boostTime2 = setTimeout(() => {
                    /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                    adapter.setState(`sprinkle.${entry.sprinkleName}.sprinklerState`, {
                        val: 2,
                        ack: true
                    });
                    entry.times.boostTime2 = null;
                },31000);
            } else {    // rest der Ventile
                // in die Zwangspause (myBreak = true)
                entry.times.boostTime1 = setTimeout(() => {
                    /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), <<< 5 >>> off(Boost) */
                    adapter.setState(`sprinkle.${entry.sprinkleName}.sprinklerState`, {
                        val: 5,
                        ack: true
                    });
                    entry.myBreak = true;
                    // valveOnOff(entry, false, '#2.1 Set: off(Boost), ID: ');
                    entry.times.boostTime1 = null;
                },250);
                // aus der Zwangspause holen (myBreak = false)
                entry.times.boostTime2 = setTimeout(() => {
                    /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                    adapter.setState(`sprinkle.${entry.sprinkleName}.sprinklerState`, {
                        val: 2,
                        ack: true
                    });
                    // valveOnOff(entry, true, '#2.2 Set: on, ID: ');
                    entry.myBreak = false;
                    entry.times.boostTime2 = null;
                },31000);
            }
        }
    }
    boostListTimer = setTimeout(() => {
        boostOn = false;
        updateList();
    },32000);
} // End boostList

/*----------------------------------------------------------------------------------------------------------------------------------------------*/

/**
 * If boostOn is ended by entering "runningTime = 0", normal operation should be restored. (Delete timer)
 * → Wenn boostOn über die Eingabe "runningTime = 0" beendet wird, so soll zum Normalen ablauf wieder zurückgekehrt werden. (Löschen der Timer)
 *
 * @param sprinkleID
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
                    adapter.log.debug(`boostKill => ID: ${entry.sprinkleName} => boostTime2 (Ende) gelöscht)`);
                }
                if (entry.times.boostTime2) {
                    clearTimeout(entry.times.boostTime2);
                    entry.times.boostTime2 = null;
                    /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                    adapter.setState(`sprinkle.${entry.sprinkleName}.sprinklerState`, {
                        val: 2,
                        ack: true
                    });
                    // valveOnOff(entry, true, '#2.3 Set: on, ID: ');
                }
            }
        }
    }
} // End boostKill

/*----------------------------------------------------------------------------------------------------------------------------------------------*/

/**
 * Schaltintervall der Ventile, Schaltabstand ist in der Config hinterlegt
 */
const valveDelay = () => {
    return new Promise (
        resolve => setTimeout (resolve, parseInt(adapter.config.switchingDistance))
    );
};
/**
 * Ausschalten der Ventile mit Schaltabstand
 *
 * @param  threadList  Auflistung aller aktiver Sprenger-Kreise
 * @param  parallel  aktuelle Anzahl der eingeschalteten Ventile
 * @returns
 */
const switchTheValvesOffOn = async (threadList, parallel) => {
    /**Sammlung von.sprinkleName die am Ende von updateList gelöscht werden
     *  @type {array} - killList
     */
    const killList = [];
    for (const entry of threadList) {               // ausschalten der Ventile
        if ((!entry.enabled                             //   Ventile ausgeschaltet z.B. Intervall-Beregnung
            || entry.enabled && entry.myBreak           //      || in Pause z.B. Boost
            || entry.killSprinkle)                      //      || Bewässerung erledigt
            && entry.enabled !== entry.enabledState     //   && Ventil nicht aktuell
        ) {
            adapter.setForeignState(entry.idState, {
                val: false,
                ack: false
            }, (err) => {
                if (err) {
                    return err;
                } else {
                    adapter.log.info(`Set (${myConfig.config[entry.sprinkleID].methodControlSM}) ID: ${entry.sprinkleName}, value: ${entry.enabled}`);
                }
            });
            entry.enabledState = entry.enabled;
            /* Ventil aus threadList löschen → Aufgabe beendet und sind nicht in der Pause */
            if (entry.killSprinkle) {
                killList.push(entry.sprinkleName);
            }
            await valveDelay ();
        }
    }
    if (currentPumpUse.pumpName !== '') {
        setPumpOnOff(parallel > 0);
        await valveDelay ();
    }
    if (adapter.config.triggerControlVoltage) {
        setVoltageOnOff(parallel>0);
        await valveDelay ();
    }


    for (const entry of threadList) {                   // einschalten der Ventile
        if (entry.enabled                                   // intern eingeschaltet
            && !entry.myBreak                               // && keine Pause
            && !entry.killSprinkle                          // Bewässerung noch nicht erledigt
            && entry.enabled !== entry.enabledState         // && Ventil nicht aktuell
        ) {
            adapter.setForeignState(entry.idState, {
                val: true,
                ack: false
            }, (err) => {
                if (err) {
                    return err;
                } else {
                    adapter.log.info(`Set Valve (${myConfig.config[entry.sprinkleID].methodControlSM}) ID: ${entry.sprinkleName}, value: ${entry.enabled}, duration: ${addTime(entry.wateringTime)}`);
                }
            });
            entry.enabledState = entry.enabled;
            await valveDelay ();
        }
    }

    delList(killList);              // erledigte Bewässerungsaufgaben aus der threadList löschen
};

/*----------------------------------------------------------------------------------------------------------------------------------------------*/

/**
 * Control of the active irrigation circuits so that the maximum pump capacity (l / h) is achieved and the maximum number of irrigation circuits is not exceeded.
 * => Steuerung der aktiven Bewässerungskreise, damit die maximale Pumpenkapazität (l / h) erreicht wird und die maximale Anzahl der Bewässerungskreise nicht überschritten wird.
 */
function updateList () {
    /* während des Boost eines Kreises ist ein zuschalten von Sprengern nicht möglich */
    if (boostOn) {
        return;
    }

    /** aktuelle Rest-Pumpenleistung */
    let curFlow = currentPumpUse.pumpPower, /* adapter.config.triggerMainPumpPower; */
        /** aktuelle Anzahl der eingeschalteten Ventile */
        parallel = 0;

    /**
     * Sortierfunktion mySortDescending absteigende Sortierung
     *
     * @param a
     * @param b
     * @returns
     */
    function mySortDescending(a, b) {
        return (a.pipeFlow > b.pipeFlow) ? -1 :
            (a.pipeFlow < b.pipeFlow) ? 1 :
                0;
    }
    /**
     * Sortierfunktion mySortAscending aufsteigende Sortierung
     *
     * @param a
     * @param b
     * @returns
     */
    function mySortAscending(a, b) {
        return (a.pipeFlow < b.pipeFlow) ? -1 :
            (a.pipeFlow > b.pipeFlow) ? 1 :
                0;
    }
    /**
     * Handling von Ventilen, Zeiten, Verbrauchsmengen im 1s Takt
     *
     * @param entry
     */
    function countSprinkleTime(entry) {
        /* --- function beenden wenn ---*/
        if (boostOn && !(myConfig.config[entry.sprinkleID].booster)   // boost-On && kein aktuelles Boost-Ventil
        ) {
            return;
        }
        entry.count ++;
        if ((entry.count < entry.wateringTime)	// Zeit noch nicht abgelaufen?
            && (!entry.calcOn       // alles ausser Berechnung der Verdunstung
                || !entry.autoOn	// Handbetrieb
                || (myConfig.config[entry.sprinkleID].soilMoisture.val < myConfig.config[entry.sprinkleID].soilMoisture.maxIrrigation))		// Bodenfeuchte noch nicht erreicht? (z.B. beim Regen)
        ) {     /* Zeit läuft */
            adapter.setState(`sprinkle.${entry.sprinkleName}.countdown`, {
                val: addTime(entry.wateringTime - entry.count),
                ack: true
            });
            /* Alle 15s die Bodenfeuchte anpassen */
            if (entry.calcOn            // Vergleich nur bei Berechnung der Verdunstung
                && !(entry.count % 15)	// alle 15s ausführen
            ) {
                myConfig.addSoilMoistVal(entry.sprinkleID, entry.soilMoisture15s);
            }
            /* Intervall-Beregnung wenn angegeben (onOffTime > 0) */
            if ((entry.onOffTime > 0) && !(entry.count % entry.onOffTime)) {
                adapter.log.info(`Intervall-Beregnung, onOffTime: ${entry.onOffTime}, count: ${entry.count}`);
                entry.enabled = false;
                entry.myBreak = true;
                /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, < 2 > on, <<< 3 >>> break, < 4 > Boost(on), < 5 > off(Boost) */
                adapter.setState(`sprinkle.${entry.sprinkleName}.sprinklerState`, {
                    val: 3,
                    ack: true
                });
                updateList();
                clearInterval(entry.countdown);
                entry.onOffTimeoutOff = setTimeout(()=>{
                    entry.myBreak = false;
                    /* Zustand des Ventils im Thread < 0 > off, <<< 1 >>> wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                    adapter.setState(`sprinkle.${entry.sprinkleName}.sprinklerState`, {
                        val: 1,
                        ack: true
                    });
                    updateList();
                },1000 * (entry.onOffTime < 600 ? 600 : entry.onOffTime));  // 600 sek Pause (10 min)
            }
        } else {    /* zeit abgelaufen => Ventil ausschalten */
            /* Zustand des Ventils im Thread <<< 0 >>> off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
            entry.enabled = false;
            adapter.setState(`sprinkle.${entry.sprinkleName}.sprinklerState`, {
                val: 0,
                ack: true
            });
            adapter.setState(`sprinkle.${entry.sprinkleName}.runningTime`, {
                val: '0',
                ack: true
            });
            adapter.setState(`sprinkle.${entry.sprinkleName}.countdown`, {
                val: '0',
                ack: true
            });

            /* Wenn in der Konfiguration Bodenfeuchte = 100% gesetzt ist und Auto-Bewässerung aktive, dann Bodenfeuchte = 100% setzen*/
            if (entry.autoOn && entry.calcOn && myConfig.config[entry.sprinkleID].endIrrigation) {
                myConfig.setSoilMoistPct100(entry.sprinkleID);
            }
            /* Verbrauchswerte in der Historie aktualisieren */
            addConsumedAndTime(entry);
            /* Booster zurücksetzen */
            if (myConfig.config[entry.sprinkleID].booster) {
                if (boostOn) {
                    boostKill(entry.sprinkleID);
                }
                boostReady = true;
                adapter.log.debug(`ID: ${entry.sprinkleName} UpdateList Sprinkle Off: boostReady = ${boostReady}`);
            }
            /* Zeiten löschen */
            clearInterval(entry.countdown);
            /*clearTimeout(entry.onOffTimeoutOn);*/
            clearTimeout(entry.onOffTimeoutOff);
            /* Ventil aus threadList löschen → Aufgabe beendet */
            //delList(entry.sprinkleName);
            entry.killSprinkle = true;
            updateList();
        }
    }

    // ermitteln von curPipe und der anzahl der parallelen Stränge
    for(const entry of threadList){
        if (entry.enabled && !entry.killSprinkle) {
            curFlow -= entry.pipeFlow;	// // ermitteln der RestFörderkapazität
            parallel ++;	// Anzahl der Bewässerungsstellen um 1 erhöhen
        }
    }

    if (curFlow < 0) {
        /* - wenn beim Umschalten der Pumpen die Förderleistung zu gering → Ventile deaktivieren - */
        // aufsteigend sortieren nach der Verbrauchsmenge
        threadList.sort(mySortAscending);

        for(const entry of threadList) {
            if (entry.enabled                   //  eingeschaltet
                && !entry.killSprinkle          //  && Aufgabe noch nicht erledigt
                && (curFlow < 0)                //  && Förderleistung der Pumpe zu gering
            ) {
                entry.enabled = false;          // ausgeschaltet merken
                clearInterval(entry.countdown); // Zähler für Countdown, Verbrauchsmengen, usw. löschen
                curFlow += entry.pipeFlow;	    // ermitteln der RestFörderkapazität
                parallel--;	                    // Anzahl der Bewässerungsstellen um 1 verringern
                /* Zustand des Ventils im Thread < 0 > off, <<< 1 >>> wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                adapter.setState(`sprinkle.${entry.sprinkleName}.sprinklerState`, {
                    val: 1,
                    ack: true
                });
                // valveOnOff(entry, false, '#2.6 Set: wait, ID: ');
                adapter.log.info(`Set Valve ID: ${entry.sprinkleName} Pump delivery rate too low, wait!  curFlow ${curFlow} parallel: ${parallel}`);
            }
        }
    }

    // absteigend sortieren nach der Verbrauchsmenge
    threadList.sort(mySortDescending);

    // einschalten der Bewässerungsventile nach Verbrauchsmenge und maximaler Anzahl
    for(const entry of threadList) {
        // adapter.log.info(`Ventile Ein: enabled: ${!entry.enabled} && killSprinkle: ${!entry.killSprinkle} && myBreak: ${!entry.myBreak} && Flow: ${(curFlow >= entry.pipeFlow)} && ||: ${(parallel < maxParallel)} && noBoost: ${((boostReady) || !(myConfig.config[entry.sprinkleID].booster))}`);
        if (!entry.enabled                                                      // ausgeschaltet
            && !entry.killSprinkle                                              // && Aufgabe noch nicht erledigt
            && !entry.myBreak                                                   // && nicht in der Pause
            && (curFlow >= entry.pipeFlow)                                      // && noch genügend Förderleistung der Pumpe
            && (parallel < maxParallel)                                         // && maxParallel noch nicht erreicht
            && ((boostReady) || !(myConfig.config[entry.sprinkleID].booster))   // nur einer mit boostFunction darf aktive sein
        ) {
            entry.enabled = true;	// einschalten merken
            if (myConfig.config[entry.sprinkleID].booster) {
                boostReady = false;
                adapter.log.debug(`ID: ${entry.sprinkleName}UpdateList sprinkle On: boostReady = ${boostReady}`);
                setTimeout(() => {
                    boostList(entry.sprinkleID);
                }, 50);
            }
            curFlow -= entry.pipeFlow;	// ermitteln der RestFörderkapazität
            parallel++;	// Anzahl der Bewässerungsstellen um 1 erhöhen
            /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
            adapter.setState(`sprinkle.${entry.sprinkleName}.sprinklerState`, {
                val: 2,
                ack: true
            });
            // valveOnOff(entry, true, '#2.7 Set: on, ID: ');
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
        val: `${parallel} : ${maxParallel}`,
        ack: true
    });
    adapter.setState('control.restFlow', {
        val: `${curFlow} (${currentPumpUse.pumpPower} ${currentPumpUse.pumpCistern ? 'Zisterne' : 'Grundwasser'})`,
        ack: true
    });

    switchTheValvesOffOn(threadList, parallel).then(err => {
        if (err) {
            adapter.log.error(`Error - Set (false) err: ${err}`);
            sendMessageText.sendMessage(`Error - Set (fase) err: ${err}`);
        }
    });
} // End updateList

/* --------------------------------------------------------------------------------------------------------------------------------------------------------------------- */

/**
 * +++++  Set the current pump for irrigation  +++++
 * → Festlegen der aktuellen Pumpe zur Bewässerung
 */
function setActualPump () {
    if (adapter.config.cisternSettings === true) {
        /* Zisternen-Bewässerung Einstellung in der config (2. Pumpe) aktiviert */
        if (currentPumpUse.enable === true) {
            /* Bewässerungspumpen aktiv */
            if ((fillLevelCistern < parseFloat(adapter.config.triggerMinCisternLevel)) && (currentPumpUse.pumpCistern === true)) {
                /* (Zisterne unter Minimum) && (ZisternenPumpe läuft) */
                adapter.setForeignState(currentPumpUse.pumpName, {
                    val: false,
                    ack: false
                }); // Pumpe Zisterne Aus
                if (currentPumpUse.pumpCistern === true && !sendMessageText.onlySendError()) {
                        sendMessageText.sendMessage(`Pump change (cistern empty) Cistern pump off => main pump on`); 
                }
                currentPumpUse.pumpCistern = false;
                currentPumpUse.pumpName = adapter.config.triggerMainPump || '';
                currentPumpUse.pumpPower = parseInt(adapter.config.triggerMainPumpPower);
                adapter.setForeignState(currentPumpUse.pumpName, {
                    val: true,
                    ack: false
                }); // Hauptpumpe Ein
                adapter.log.info('Pump change (cistern empty) Cistern pump off => main pump on');
                updateList();   // Wasserverbrauch an Pumpenleistung anpassen
            }
            if (fillLevelCistern < parseFloat(adapter.config.triggerMinCisternLevel)) {
                statusCistern = `Cistern empty: ${fillLevelCistern} %  (${adapter.config.triggerMinCisternLevel + 5} %)`;
                adapter.setState('info.cisternState', {
                    val: statusCistern,
                    ack: true
                });
            } else {
                statusCistern = `Cistern filled: ${fillLevelCistern} %  (${adapter.config.triggerMinCisternLevel} %)`;
                adapter.setState('info.cisternState', {
                    val: statusCistern,
                    ack: true
                });
            }
        } else {
            /* Bewässerungspumpen inaktiv */
            if ((fillLevelCistern >= (parseFloat(adapter.config.triggerMinCisternLevel) + 5)) && (adapter.config.triggerCisternPump) && (adapter.config.triggerCisternPumpPower)) {
                /* Zisterne voll && triggerCisternPump && triggerCisternPumpPower vorhanden*/
                statusCistern = `Cistern filled: ${fillLevelCistern} %  (${adapter.config.triggerMinCisternLevel} %)`;
                adapter.setState('info.cisternState', {
                    val: statusCistern,
                    ack: true
                });
                if (currentPumpUse.pumpCistern === false && !sendMessageText.onlySendError()) {
                    sendMessageText.sendMessage(`Cistern filled: ${fillLevelCistern} %  (${adapter.config.triggerMinCisternLevel} %)`); 
                }
                currentPumpUse.pumpCistern = true;
                currentPumpUse.pumpName = adapter.config.triggerCisternPump || '';
                currentPumpUse.pumpPower = parseInt(adapter.config.triggerCisternPumpPower);
                adapter.setState('control.restFlow', {
                    val: `${currentPumpUse.pumpPower} (${currentPumpUse.pumpPower} Zisterne)`,
                    ack: true
                });
            } else {
                statusCistern = `Cistern empty: ${fillLevelCistern} %  (${adapter.config.triggerMinCisternLevel + 5} %)`;
                adapter.setState('info.cisternState', {
                    val: statusCistern,
                    ack: true
                });
                currentPumpUse.pumpCistern = false;
                currentPumpUse.pumpName = adapter.config.triggerMainPump || '';
                currentPumpUse.pumpPower = parseInt(adapter.config.triggerMainPumpPower);
                adapter.setState('control.restFlow', {
                    val: `${currentPumpUse.pumpPower} (${currentPumpUse.pumpPower} Grundwasser)`,
                    ack: true
                });
            }
        }
    } else {
        /* Pumpe AUS => Zisternen-Bewässerung nicht aktiviert */
        if (adapter.config.triggerCisternPump) {
            statusCistern = `Cistern settings are not active!${(fillLevelCistern > 0)?(` level sensor: ${fillLevelCistern}%${(adapter.config.triggerMinCisternLevel !== '')?(`${adapter.config.triggerMinCisternLevel}%`):('')}`):('')}`;
            adapter.setState('info.cisternState', {
                val: statusCistern,
                ack: true
            });
        }
    }
}   // End setActualPump

/**
 * Switching the pump on or off
 * => Ein bzw. ausschaltern der Pumpe
 * 
 * @param pumpOnOff ; Pumpe on = true
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
                        adapter.log.info('Set (pump) on');
                    }
                } else {
                    if (state.val !== false) {
                        adapter.setForeignState(currentPumpUse.pumpName, {
                            val: false,
                            ack: false
                        });
                        currentPumpUse.enable = false;
                        adapter.log.info('Set (pump) off');
                    }
                }
            } else if (err) {
                adapter.log.error(`triggerMainPump ${currentPumpUse.pumpName} is not available (ist nicht erreichbar): ${err}`);
            }
        });
    }
}   // End setPumpOnOff

/**
 * Switching the control voltage on or off
 * => Ein bzw. ausschaltern der Steuerspannung
 *
 * @param voltageOnOff - Voltage on = true
 */
function setVoltageOnOff(voltageOnOff) {
    if (adapter.config.triggerControlVoltage !== '') {
        adapter.getForeignState(adapter.config.triggerControlVoltage, (err, state) => {
            if (state) {
                if (voltageOnOff) {
                    if (state.val === false) {
                        adapter.setForeignState(adapter.config.triggerControlVoltage, {
                            val: true,
                            ack: false
                        });
                        adapter.log.info('Set (voltage) on');
                    }
                } else {
                    if (state.val !== false) {
                        adapter.setForeignState(adapter.config.triggerControlVoltage, {
                            val: false,
                            ack: false
                        });
                        adapter.log.info('Set (voltage) off');
                    }
                }
            } else if (err) {
                adapter.log.error(`triggerControlVoltage is not available (ist nicht erreichbar): ${err}`);
            }
        });
    }
}

/**
 * Adding the consumption data to the history
 * => Hinzufügen der Verbrauchsdaten zur History
 *
 * @param entry - array mit den Daten des aktiven Ventils
 */
function addConsumedAndTime(entry) {
    adapter.setState(`sprinkle.${entry.sprinkleName}.history.lastConsumed`, {
        val: Math.round(entry.litersPerSecond * entry.count),
        ack: true
    });
    adapter.setState(`sprinkle.${entry.sprinkleName}.history.lastRunningTime`, {
        val: addTime(entry.count),
        ack: true
    });
    adapter.setState(`sprinkle.${entry.sprinkleName}.history.lastOn`, {
        val: formatTime(adapter, entry.startTime, 'dd.mm. hh:mm'),
        ack: true
    });
    adapter.getState(`sprinkle.${entry.sprinkleName}.history.curCalWeekConsumed`, (err, state) => {
        if (state) {
            adapter.setState(`sprinkle.${entry.sprinkleName}.history.curCalWeekConsumed`, {
                val: (state.val) + Math.round(entry.litersPerSecond * entry.count),
                ack: true
            });
        }
    });
    adapter.getState(`sprinkle.${entry.sprinkleName}.history.curCalWeekRunningTime`, (err, state) => {
        if (state) {
            adapter.setState(`sprinkle.${entry.sprinkleName}.history.curCalWeekRunningTime`, {
                val: addTime(state.val, entry.count),
                ack: true
            });
        }
    });
}   // End addConsumedAndTime


/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
/*                                                       externe Funktionen                                                                     */
/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/

/**
 * -- externe Funktionen -> initValveControl - addList - clearEntireList - setFillLevelCistern --
 *
 */
const valveControl = {
    /**
     * Initialize the start configuration of ventilControl
     * => Initialisieren Sie die Startkonfiguration von ventilControl
     * 
     * @param myAdapter
     */
    initValveControl (myAdapter) {
        adapter = myAdapter;
        currentPumpUse.pumpCistern = false;
        currentPumpUse.pumpName = adapter.config.triggerMainPump || '';
        currentPumpUse.pumpPower = parseInt(adapter.config.triggerMainPumpPower) || 0;
        maxParallel = parseInt(adapter.config.maximumParallelValves);
        /* Objekt control.restFlow befüllen */
        adapter.setState('control.restFlow', {
            val: `${currentPumpUse.pumpPower} (${currentPumpUse.pumpPower} ${currentPumpUse.pumpCistern ? 'Zisterne' : 'Grundwasser'})`,
            ack: true
        });
        /* Objekt control.parallelOfMax befüllen */
        adapter.setState('control.parallelOfMax', {
            val: `0 : ${adapter.config.maximumParallelValves}`,
            ack: true
        });
        /* 24V ausschalter, wenn vorhanden */
        if (adapter.config.triggerControlVoltage !== '') {
            adapter.getForeignState('adapter.config.triggerControlVoltage', (err, state) => {
                if (state && state.val === true) {
                    adapter.setForeignState(adapter.config.triggerControlVoltage, {
                        val: false,
                        ack: false
                    });
                }
            });
        }
        /* Pumpe ausschalter, wenn vorhanden */
        if (adapter.config.triggerMainPump !== '') {
            adapter.getForeignState('adapter.config.triggerMainPump', (err, state) => {
                if (state && state.val === true) {
                    adapter.setForeignState(adapter.config.triggerMainPump, {
                        val: false,
                        ack: false
                    });
                }
            });
        }
        /* Pumpe (Zisterne) ausschalter, wenn vorhanden */
        if (adapter.config.triggerCisternPump !== '') {
            adapter.getForeignState('adapter.config.triggerCisternPump', (err, state) => {
                if (state && state.val === true) {
                    adapter.setForeignState(adapter.config.triggerCisternPump, {
                        val: false,
                        ack: false
                    });
                }
            });
        }
        /* alle Ventile (.name = "hm-rpc.0.MEQ1234567.3.STATE") in einem definierten Zustand (false) versetzen*/
        const result = adapter.config.events;
        if (result) {
            for (const res of result) {
                adapter.getForeignState(res.name, (err, state) => {
                    if (state && state.val === true) {
                        adapter.setForeignState(res.name, {
                            val: false,
                            ack: false
                        });
                    }
                });
            }
        }
    },  // End initValveControl

    /**
     *  Add Sprinkle→ Sprinkle hinzufügen
     *  
     * @param sprinkleList
     * @param sprinkleList[].auto - auto → Automatik == (true), Handbetrieb == (false)
     * @param sprinkleList[].sprinkleID - sprinkleID → zugriff auf myConfig.config[sprinkleID]. xyz
     * @param sprinkleList[].wateringTime - wateringTime → Bewässerungszeit in min
     */
    addList (sprinkleList) {
        //
        for (const res of sprinkleList) {
            const sprinkleName = myConfig.config[res.sprinkleID].objectName;
            /**
             * add done
             * → hinzufügen erledigt (Sprenger bereits aktive)
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
                        entry.autoOn = res.auto;      // auto: = true autostart; = false Handbetrieb
                        adapter.setState(`sprinkle.${sprinkleName}.runningTime`, {
                            val: addTime(res.wateringTime),
                            ack: true
                        });
                        addDone = true;		// Sprinkle found
                        adapter.log.debug(`update ID: ${entry.sprinkleName} new time: ${addTime(res.wateringTime)}`);
                        break;
                    }
                }
            }

            if (!addDone) {
                if (res.wateringTime <= 0) {
                    adapter.setState(`sprinkle.${sprinkleName}.runningTime`, {
                        val: '0',
                        ack: true
                    });
                    return;
                }

                let pipeFlow = myConfig.config[res.sprinkleID].pipeFlow;

                // Kontrolle des Ventilverbrauchs(muss kleiner als Pumpenleistung sein, da Ventil sonst nicht starten kann)
                if (adapter.config.cisternSettings === true) {
                    if ((pipeFlow > adapter.config.triggerMainPumpPower) || (pipeFlow > adapter.config.triggerCisternPumpPower)) {
                        if (pipeFlow > adapter.config.triggerMainPumpPower) adapter.log.warn(`Emergency irrigation! ${sprinkleName}: Valve consumption > pump performance (main pump)`);
                        if (pipeFlow > adapter.config.triggerCisternPumpPower) adapter.log.warn(`Emergency irrigation! ${sprinkleName}: Valve consumption > pump performance (cistern pump)`);
                        pipeFlow = (adapter.config.triggerMainPumpPower < adapter.config.triggerCisternPumpPower) ? adapter.config.triggerMainPumpPower : adapter.config.triggerCisternPumpPower;                            
                    }
                } else {
                    if (pipeFlow > adapter.config.triggerMainPumpPower) {
                        adapter.log.warn(`Emergency irrigation! ${sprinkleName}: Valve consumption > pump performance (main pump)`);
                        pipeFlow = adapter.config.triggerMainPumpPower;
                    }
                }

                const newThread = {
                    sprinkleID: res.sprinkleID,	// Array[0...]   
                    sprinkleName: sprinkleName,	// z.B "Blumenbeet"   
                    idState: myConfig.config[res.sprinkleID].idState,	// z.B. "hm-rpc.0.MEQ1810129.1.STATE"   
                    wateringTime: res.wateringTime,  // Bewässerungszeit in s (Sekunden)  
                    pipeFlow: pipeFlow,  // Wasserverbrauch in l/h   
                    count: 0,                // Zähler im Sekundentakt  
                    calcOn: (myConfig.config[res.sprinkleID].methodControlSM === 'calculation'),         //  Anpassung der Bodenfeuchte true/false  
                    enabled: false,          // Ventil softwaremäßig ein  
                    enabledState: false,     // Ventil hardwaremäßig ein  
                    myBreak: false,          // meine Pause  
                    killSprinkle: false,     // Löschauftrag ausführen am Ende in threadList   
                    litersPerSecond: pipeFlow / 3600,    // Wasserverbrauchsmenge pro Sekunde   
                    onOffTime: myConfig.config[res.sprinkleID].wateringInterval,  
                    autoOn: res.auto,   
                    soilMoisture15s: 15 * (myConfig.config[res.sprinkleID].soilMoisture.maxIrrigation - myConfig.config[res.sprinkleID].soilMoisture.triggersIrrigation)
                                                / (60 * myConfig.config[res.sprinkleID].wateringTime),
                    times: {
                        boostTime1: null,  // boost start 
                        boostTime2: null,  // boost ende
                    },       // hinterlegen der verschiedenen Zeiten von timeout für gezieltes späteres löschen  
                    id: threadList.length || 0,
                    };
                threadList.push(newThread);
                /* Zustand des Ventils im Thread < 0 > off, <<< 1 >>> wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                adapter.setState(`sprinkle.${sprinkleName}.sprinklerState`, {
                    val: 1,
                    ack: true
                });
                adapter.setState(`sprinkle.${sprinkleName}.runningTime`, {
                    val: addTime(res.wateringTime),
                    ack: true
                });
                adapter.log.debug(`ID: ${sprinkleName} new order created: ${JSON.stringify(threadList[newThread.id])}`);
            }
        }
        updateList();
    }, // End addList

    /**
     * switch off all devices, when close the adapter
     * => Beim Beenden des adapters alles ausschalten
     */
    clearEntireList () {
        setVoltageOnOff(false);
        setPumpOnOff(false);
        if (boostListTimer) {
            boostReady = true;
            boostOn = false;
            clearTimeout(boostListTimer);
        }
        // let bValveFound = false;	// Ventil gefunden
        for (let counter = threadList.length - 1;	// Loop über das Array
            counter >= 0;
            counter--) {
            const entry = threadList[counter];
            if (entry.enabledState) {
                adapter.log.info(`Set Valve (SprinkleControl: off) ID: ${entry.sprinkleName}, value: false`);
                adapter.setForeignState(entry.idState, {
                    val: false,
                    ack: false
                });
            }
            /* Zustand des Ventils im Thread <<< 0 >>> off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
            adapter.setState(`sprinkle.${entry.sprinkleName}.sprinklerState`, {
                val: 0,
                ack: true
            });
            adapter.setState(`sprinkle.${entry.sprinkleName}.runningTime`, {
                val: '0',
                ack: true
            });
            adapter.setState(`sprinkle.${entry.sprinkleName}.countdown`, {
                val: '0',
                ack: true
            });
            // valveOnOff(myEntry, false, '#2.0 Set: off, ID: ');
            /* Verbrauchswerte in der Historie aktualisieren */
            addConsumedAndTime(entry);
            /* del timer countdown */
            clearInterval(entry.countdown);
            /* del timer onOffTimeoutOff */
            clearTimeout(entry.onOffTimeoutOff);
            /* del timer newThread.times.boostTime1 */
            if (entry.times.boostTime1) {
                clearTimeout(entry.times.boostTime1);
                entry.times.boostTime1 = null;
            }
            /* del timer newThread.times.boostTime2 */
            if (entry.times.boostTime2) {
                clearTimeout(entry.times.boostTime2);
                entry.times.boostTime2 = null;
            }
            adapter.log.debug(`order deleted Stop all ID: ${entry.sprinkleName} ( rest orders: ${threadList.length} )`);
            threadList.pop();   // del last array
        }
        updateList();
    }, // End clearEntireList

    /**
     * Änderungen des Füllstands setzen + Vorrang der Pumpe setzen
     *
     * @param levelCistern
     */
    setFillLevelCistern (levelCistern) {
        fillLevelCistern = (typeof levelCistern === 'number') ? levelCistern : 0;
        setActualPump();
    },   // End setFillLevelCistern

    getStatusCistern () {
        return statusCistern;
    }
};  // End valveControl

/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/

module.exports = valveControl;