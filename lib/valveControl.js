
'use strict';

const asyncTime = require('timers/promises');
// import {setTimeout} from 'timers/promises';

const myConfig = require('./myConfig.js');
const tools = require('./tools.js').tools;
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

/**
 * Ventil mit dem größten Durchfluss (pipeFlow) für die Steuerung des Druckentlastungsventils
 * - wird in der Funktion updateList() ermittelt
 */
const pressureReliefValve = {enable: false, name: '',wateringTime: 10, ac: {}, controller: {}, control: {idState: undefined, idON_TIME: undefined, idACK: undefined, maker: undefined}};

/**
 *  - bereit zum Boost (true: kein Boostventil aktive; false: BoostVentil aktive)
 */
let boostReady = true,
    /**
     * - Boost aktive
     */
    boostOn = false,
    /**
     * maximal zulässige Anzahl der eingeschalteten Ventile
     */
    maxParallel = 0,
    /**
     *  Füllstand der Zisterne
     */
    fillLevelCistern = 0,
    /**
     * Zeitliche Bewässerungseinschränkung EIN/AUS
     */
    timeBasedRestrictionEn = false;

const updateListMarker = {funcActive: false, newStart: false, switchingDistance: 5000, cancelSwitchingDistance: {}};

/**
 * aktive Pumpendaten
 * - enable: Pumpe ein/ausgeschaltet
 * - name: Bezeichnung der Pumpe
 * - idState: Objektname des State
 * - id: ID des States unter Objecte im ioBroker info.cisternPump || info.mainPump
 * - intBreak: Pause (Zisterne leer)
 * - pumpCistern: ZisternenPumpe aktiv bei Verwendung zweier Pumpen
 * - leadTime: Vorlaufzeit
 * - cancelLeadTime: Vorlaufzeit abbrechen
 * - pumpPower: Maximalleistung der Pumpe
 * - restFlow: aktuelle LeistungsReserve der Pumpe
 * - controller: Rückmeldung ack
 * - ac: AbortController
 */

const currentPumpUse = {enable: false, name: '', wateringTime: 0, id: '', pumpCistern: false, intBreak: false, leadTime: 0, cancelLeadTime: {}, pumpPower: 0, restFlow: 0,ac: {},controller: {}, control: {idState: undefined, idON_TIME: undefined, idACK: undefined, maker: undefined}};
let mainPumpControl = {idState: undefined, idON_TIME: undefined, idACK: undefined, maker: undefined};
let cisternPumpControl = {idState: undefined, idON_TIME: undefined, idACK: undefined, maker: undefined};

/**
 *  Steuerspannung 24V
 * - enable: 24V ein/ausgeschaltet
 * - name: Bezeichnung 24V
 * - idState: Aktorerkennung "hm-rpc.0.MEQ1810129.1.STATE"
 * - controller: controlle von Zeiten und Abbruchsignalen
 */
const controlVoltage = {enable: false, name: '24V',wateringTime: 0, ac: {}, controller: {}, control: {idState: undefined, idON_TIME: undefined, idACK: undefined, maker: undefined}};

/**
 *  Schaltabstand in ms
 * - Schaltabstand zwischen den Ventilen
 * - 250 ms - 240 000 ms (4 min)
 */
let switchingDistanceMS = 250;
/*==============================================================================================================================================*/
/*                                                            interne Funktionen                                                                */
/*----------------------------------------------------------------------------------------------------------------------------------------------*/

/**
 * Schalten der Ventile
 * 
 * @param {object} thread -Objekt des Ventils
 * @param {boolean} val - neuer Zustand des Ventils
 * @returns {Promise<string|undefined>}
 */

const setValve = async (thread, val) => {
    // beim Schalten im guten Vertrauen (Befehl ohne Antwort)
    if (adapter.config.switchingBehavior === 'noResponse') {
        try {
            await adapter.setForeignStateAsync(thread.control.idState, {
                val: val,
                ack: false
            });
            thread.enable = val;
            if (thread.name !== 'Cistern pump' && thread.name !== 'Main pump' && thread.name !== '24V' && thread.name !== 'no Pump') {
                adapter.setStateAsync(`sprinkle.${thread.name}.sprinklerState`, {
                    val: thread.state,
                    ack: true
                });
                adapter.setStateAsync(`sprinkle.${thread.name}.valveOn`, {
                    val: thread.enable,
                    ack: true
                });
            }
            adapter.log.info(`setValve ${ thread.name }: ${ val }, ${ thread.wateringTime > 0 && val === true ? `${ tools.addTime(thread.wateringTime,'') }, ` : '' }`);
            return thread.control.idState;
        } catch (error) {
            thread.enable = false;
            thread.state = 'Error'
            throw new Error(`setValve ${thread.name} error: ${error}`);
        }
    }

    const startTime = new Date();
    let result = undefined;
    let updateStr = '';

    thread.ac.acSetValveCancelTimeout = new AbortController;
    /**
     *  Sprinkle geschaltet
     *
     * @param {{val:boolean,ack:boolean}} state 
     */
    thread.controller.ackTrue = (state) => {
        if (
            (thread.control.maker === 'standard') && (state?.val === val)
            || (thread.control.maker === 'HM') && (val ? state?.val === true : state?.val === false)
            || (thread.control.maker === 'HmIP') && (val ? state?.val === 1 : state?.val === 0)
        ) {
            adapter.log.debug(`setValve ${thread.name} => ackTrue`);
            result = thread.control.idState;
            thread.enable === val ? updateStr = ' (update)' : thread.enable = val;
            thread.ac.acSetValveCancelTimeout.abort();
        } else {
            adapter.log.debug(`setValve ${thread.name}  => check ackTrue! 
                if => maker ${ thread.control.maker } === 'standard' && ${state?.val} === ${val}
                || ${thread.control.maker} === 'HM' && ${val} ? ${state?.val} === true : ${state?.val} === false
                || ${thread.control.maker} === 'HmIP' && ${val} ? ${state?.val} === 1 : ${state?.val} === 0}
            `);
        }
    };
    
    //adapter.log.info(`Set Valve (async () => {...}`);
    try {
        // Ventil ansteuern
        if (thread.control.idON_TIME !== null) {
            await adapter.setForeignStateAsync(thread.control.idON_TIME, {
                val: val ? Math.ceil(thread.wateringTime + 5) : 0,
                ack: false
            });
            await asyncTime.setTimeout(200, undefined, undefined);
        }
        
        const _setValve = await adapter.setForeignStateAsync(thread.control.idState, {
            val: val,
            ack: false
        });
        if (_setValve === thread.control.idState) {     // Auftrag ausgeführt
            await asyncTime.setTimeout(3000, undefined, { signal: thread.ac.acSetValveCancelTimeout.signal });  // max. 3s warten auf Rückmeldung ackTrue
            const _getValve = await adapter.getForeignStateAsync(thread.control.idState);
            if (_getValve?.val === val
            ) {
                thread.enable === val ? updateStr = ' (update)' : thread.enable = val;;
                return thread.control.idState;
            } else {
                throw new Error(` > was not switched! (${val}) Check the device! Reply: ${JSON.stringify(_getValve)}`);
            }
        } else {
            throw new Error(` command could not be sent`);
        }
    } catch (error) {
        // thread.controller.ackTrue wurde ausgelöst
        if (error.name !== `AbortError`) {
            await adapter.setForeignStateAsync(thread.control.idState, {
                val: false,
                ack: false
            });
            thread.enable = false;
            thread.state = 'Error'
            if (adapter.config.notificationEnabled) {
                sendMessageText.sendMessage(`setValve ${thread.name} (${thread.control.idState}) ${error}`);
            }
            throw new Error(` > set Valve ${error}`);
        }
    } finally {
        adapter.log.info(`setValve ${thread.name}: 
            ${val}, 
            ${thread.control.maker !== 'standard' ? `${thread.control.maker}, ` : ''}
            ${ (thread.wateringTime > 0 && val === true && thread.name !== 'Cistern pump' && thread.name !== 'Main pump' && thread.name !== '24V')
            ? `${ tools.addTime(thread.wateringTime,'') }${ updateStr }, ` : ''}
            processing time: ${(+new Date()) - +startTime}ms
        `);
        if (thread.ac.acSetValveCancelTimeout.aborted === false) thread.ac.acSetValveCancelTimeout.abort();
    }

    if (thread.name !== 'Cistern pump' && thread.name !== 'Main pump' && thread.name !== '24V' && thread.name !== 'no Pump') {
        adapter.setStateAsync(`sprinkle.${thread.name}.sprinklerState`, {
            val: thread.state,
            ack: true
        });
        adapter.setStateAsync(`sprinkle.${thread.name}.valveOn`, {
            val: thread.enable,
            ack: true
        });
    }
    return result;
};

/**
 * Sprinkle (name) delete
 * → Ventil (name) löschen
 * 
 * @param {Array.<{name: string}>} killList
 * @returns {Promise}
 */
const delList = async (killList) => {
    new Promise((resolve, reject) => {
        const badList = [];
        for (const name of killList) {
            let bValveFound = false;	// Ventil gefunden
            for (let counter = 0,                                  // Loop über das Array
                lastArray = (threadList.length - 1);     // entsprechend der Anzahl der Eintragungen
                counter <= lastArray;
                counter++) {
                const entry = threadList[counter].name;
                if ((name === entry) || bValveFound) {
                    if (name === entry) bValveFound = true;
                    if (counter !== lastArray) threadList[counter] = threadList[counter + 1];
                }
            }
            /* If a valve is found, delete the last array (entry). Wenn Ventil gefunden letzten Array (Auftrag) löschen */
            if (bValveFound) {
                threadList.pop();
                adapter.log.debug(`delList => order deleted ID: ${name} ( rest orders: ${threadList.length} )`);
            }else{
                badList.push(name);
            }
        }
        if (badList.length > 0) {
            reject(`delList: could not find ${JSON.stringify(badList)}`);
        } else {
            resolve;
        }
    });
};  // End delList

/**
 * currentConsumption aktueller Verbrauch ermitteln
 *
 * @param {boolean} write
 * @returns {Promise<{curFlow:number, parallel:number, pumpRequired:boolean}>}
 */
const currentConsumption = async (write) => {
    try {
        let curFlow = currentPumpUse.intBreak ? 0 : currentPumpUse.pumpPower, /* adapter.config.triggerMainPumpPower; */
            /** aktuelle Anzahl der eingeschalteten Ventile */
            parallel = 0,
            pumpRequired = false;
        adapter.log.debug(`currentConsumption curFlow: ${curFlow}, ${currentPumpUse.intBreak} => ${currentPumpUse.intBreak ? 0 : currentPumpUse.pumpPower}`);
        if (!currentPumpUse.intBreak) {
        // ermitteln von curPipe und der Anzahl der parallelen Stränge
            for (const entry of threadList){
                if (entry.state === 'wait') pumpRequired = true;   // state => wait
                if (entry.enable === true
                    && entry.extBreak === false
                    && timeBasedRestrictionEn === false
                ) {
                    curFlow -= entry.pipeFlow;	// // ermitteln der RestFörderkapazität
                    parallel ++;	// Anzahl der Bewässerungsstellen um 1 erhöhen
                    pumpRequired = true;
                }
            }
        }
        // bei write schreiben der aktuellen Förderleistung der Pumpe und der Anzahl der parallelen Stränge
        if (write || currentPumpUse.intBreak) {
            adapter.setStateAsync('control.parallelOfMax', {
                val: `${parallel} : ${maxParallel}`,
                ack: true
            });
            adapter.setStateAsync('control.restFlow', {
                val: `${curFlow} (${currentPumpUse.pumpPower} | ${currentPumpUse.name})`,
                ack: true
            });
        }

        return {
            curFlow: curFlow,
            parallel: parallel,
            pumpRequired: pumpRequired
        };
        
    } catch (error) {
        adapter.log.error(`currentConsumption Error: ${error}`);
        return {
            curFlow: 0,
            parallel: 99,
            pumpRequired: false
        };
    }
};

/** Interval-Beregnung aus */

const onOffTimeoutOff = async (entry) => {
    entry.ac.acOnOffTimeoutOff = new AbortController;
    try {
        const res = await asyncTime.setTimeout(1000 * (entry.onOffTimeOff < 600 ? 600 : entry.onOffTimeOff),`time expired`, { signal: entry.ac.acOnOffTimeoutOff.signal });   // mindestens 600 sek Pause (10 min)
        if (res === `time expired`) {   // Zeit abgelaufen
            entry.myBreak = false;
            // Zustand des Ventils im Thread < 0 > off, <<< 1 >>> wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost)
            entry.state = 'wait';
            adapter.setStateAsync(`sprinkle.${entry.name}.sprinklerState`, {
                val: entry.state,     // <<< 1 >>> wait
                ack: true
            });
            updateList();            
        }
    } catch (error) {
        adapter.log.error(`onOffTimeoutOff error: ${error}`);
    } finally {
        if (entry.ac.acOnOffTimeoutOff.aborted === false) entry.ac.acOnOffTimeoutOff.abort();
    }
};
/*----------------------------------------------------------------------------------------------------------------------------------------------*/

/*----------------------------------------------------------------------------------------------------------------------------------------------*/

/**
 * Handling von Ventilen, Zeiten, Verbrauchsmengen im 1s Takt
 * 
 * @param {object} entry
 */
const countSprinkleTime = async (entry) => {
    try {
        /* --- function beenden wenn ---*/
        if ((boostOn && !(myConfig.config[entry.sprinkleID].booster)    // boost-On && kein aktuelles Boost-Ventil
            || entry.extBreak === true                                  // extBreak aktive
            || timeBasedRestrictionEn === true                            // zeitliche Bewässerungsbeschränkung aktiv
        )                                          
        ) {
            return;
        }

        entry.count ++;

        if ((entry.count < entry.wateringTime)	// Zeit noch nicht abgelaufen?
            && (!entry.calcOn       // Vergleich nur bei Berechnung der Verdunstung
                || !entry.autoOn	// Vergleich nur bei Automatik
                || (myConfig.config[entry.sprinkleID].calculation.val < myConfig.config[entry.sprinkleID].calculation.maxIrrigation))		// Bodenfeuchte noch nicht erreicht? (z.B. beim Regen)
        ) {     /* Zeit läuft */
            adapter.setStateAsync(`sprinkle.${entry.name}.countdown`, {
                val: tools.addTime(entry.wateringTime - entry.count, ''),
                ack: true
            });

            /* Alle 15s die Bodenfeuchte anpassen */
            if (entry.calcOn            // Vergleich nur bei Berechnung der Verdunstung
                && !(entry.count % 15)	// alle 15s ausführen
            ) {
                myConfig.addSoilMoistVal(entry.sprinkleID, entry.soilMoisture15s);
            }

            /* Intervall-Beregnung wenn angegeben (onOffTimeOff > 0) */
            if ((entry.onOffTimeOff > 0) && !(entry.count % entry.onOffTimeOn)) {
                adapter.log.info(`Intervall-Beregnung, timeOn: ${entry.onOffTimeOn}s, count: ${entry.count}s, timeOff: ${entry.onOffTimeOff}s, count % onOffTime: ${entry.count % entry.onOffTimeOn}`);
                const _setValveOnOff = await setValve(entry, false);
                if (_setValveOnOff === entry.control.idState) {
                    entry.myBreak = true;
                    /* Zustand des Ventils im Thread <<< 3 = Pause >>> (0:off; 1:wait; 2:on; 3:break; 4:Boost(on); 5:off(Boost); 6:Cistern empty; 7:extBreak) */
                    entry.state = 'break';
                    adapter.setStateAsync(`sprinkle.${entry.name}.sprinklerState`, {
                        val: entry.state,
                        ack: true
                    });
                    clearInterval(entry.countdown);
                    entry.countdown = null;
                    currentConsumption(true);
                    onOffTimeoutOff(entry);
                    updateList();                   
                }
            }
        } else {    /* zeit abgelaufen => Ventil ausschalten */
            /* Wenn in der Konfiguration Bodenfeuchte = 100% gesetzt ist und Auto-Bewässerung aktive, dann Bodenfeuchte = 100% setzen*/
            if (entry.autoOn && entry.calcOn && myConfig.config[entry.sprinkleID].calculation.endIrrigation) {
                myConfig.setSoilMoistPct100(entry.sprinkleID);
            }
            /* Verbrauchswerte in der Historie aktualisieren */
            addConsumedAndTime(entry);
            /* Booster zurücksetzen */
            if (myConfig.config[entry.sprinkleID].booster) {
                //if (boostOn) {boostKill(entry.sprinkleID);}
                boostReady = true;
                boostOn = false;
                adapter.log.debug(`ID: ${entry.name} UpdateList Sprinkle Off: boostReady = ${boostReady}`);
            }

            const _setValve = await setValve(entry, false);

            /* Zustand des Ventils im Thread <<< 0 >>> off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
            entry.state = 'off';
            const _sprinklerState = await adapter.setStateAsync(`sprinkle.${entry.name}.sprinklerState`, {
                val: entry.state,
                ack: true
            });
            const _runningTime = adapter.setStateAsync(`sprinkle.${entry.name}.runningTime`, {
                val: '00:00',
                ack: true
            });
            const _countdown = adapter.setStateAsync(`sprinkle.${entry.name}.countdown`, {
                val: '0',
                ack: true
            });
            currentConsumption(true);
            // currentConsumption(entry.pipeFlow, false);
            Promise.all([
                _setValve,
                _sprinklerState,
                _runningTime,
                _countdown
            ]).then(async () => {
                entry.killSprinkle = true;
                /* Zeiten löschen */
                clearInterval(entry.countdown);
                entry.countdown = null;
                // entry.ac.acOnOffTimeoutOff.abort(); /// ???

            }).then(()=>{
                updateList();
            });

        }
    } catch (error) {
        adapter.log.error(`countSprinkleTime(${entry.name}): ${error}`);
    }

};

/**
 * Timer zum ausschalten des Boost
 * 
 * @param {*} entry 
 */
const boostOnTimer = async (entry) => {
    entry.ac.acBoostOnTimer = new AbortController;
    const combinedSignal = AbortSignal.any([
        entry.ac.acBoostOnTimer.signal
    ]);
    try {
        adapter.log.debug(`ID: ${entry.name} boostOnTimer time start`);
        await asyncTime.setTimeout(30000, undefined, { signal: combinedSignal });
        boostOn = false;
        // Zustand des Ventils im Thread < 0 > off, < 1 > wait, <<< 2 >>> on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost)
        entry.state = 'on';
        adapter.setStateAsync(`sprinkle.${entry.name}.sprinklerState`, {
            val: entry.state,
            ack: true
        });
        adapter.log.debug(`ID: ${entry.name} boostOnTimer time out: boostOn = ${boostOn}`);
        updateList();          
    } catch (error) {
        boostOn = false;
        adapter.log.debug(`ID: ${entry.name} boostOnTimer time out: ERROR: ${error}`);
        updateList();
    }finally{
        if (entry.ac.acBoostOnTimer.aborted === false) entry.ac.acBoostOnTimer.abort();
    }
};

/**
 * Control of the active irrigation circuits so that the maximum pump capacity (l / h) is achieved and the maximum number of irrigation circuits is not exceeded.
 * => Steuerung der aktiven Bewässerungskreise, damit die maximale Pumpenkapazität (l / h) erreicht wird und die maximale Anzahl der Bewässerungskreise nicht überschritten wird.
 */
const updateList = async () => {
    /* während des Boost eines Kreises ist ein Zuschalten von Sprengern nicht möglich */
    if (boostOn) return;
    if (updateListMarker.funcActive === true) {
        updateListMarker.newStart = true;
        return;
    }
    const killList = [];
    let consumption = {};
    /* (timerOn = true) => Schaltabstand zwischen den Ventilen ein */
    let timerOn = true;
    // let switchingDistanceOn = false;
    updateListMarker.funcActive = true;

    /**
     * Sortierfunktion mySortDescending absteigende Sortierung
     * 
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
     * 
     * @param a
     * @param b
     * @returns {number}
     */
    function mySortAscending(a, b) {
        return a.pipeFlow < b.pipeFlow ? -1 :
            a.pipeFlow > b.pipeFlow ? 1 :
                0;
    }

    // ermitteln der maximalen Laufzeit aller Ventile in der threadList
    const sumOfWateringTime = Math.ceil(threadList.reduce(
        (sum, entry) => sum + entry.wateringTime + (switchingDistanceMS / 1000), (currentPumpUse.leadTime + switchingDistanceMS) / 1000));

    // Anpassung ON_Time wenn Laufzeit zu kurz
    const adjustment = sumOfWateringTime > controlVoltage.wateringTime   
        && adapter.config.switchingBehavior === 'homematic' 
        ? true 
        : false;

    /**
     * Druckentlastungsventil Steuerung
     * - Wenn die Bewässerung beendet wird, soll der Druck in den Leitungen durch kurzes Öffnen eines Druckentlastungsventils abgebaut werden, 
     * um die Lebensdauer des Systems zu erhöhen. Hierzu wird das Ventil mit dem Größten Durchfluss (pipeFlow) für 10 Sekunden angesteuert.
     */
    function findPressureReliefValve() {
        return myConfig.config.reduce((max, item) => {
                return (item.extBreak === false
                    && item.autoOn === true
                    && max.pipeFlow > item.pipeFlow
                    ) ? max : item;                    
            }, myConfig.config[0]
        );
    }
    // Implementation for pressure relief valve control


    consumption = await currentConsumption(true);
    if (consumption.pumpRequired === true) {    // Pumpe erforderlich

        // Spannungsversorgung einschalten bei Leistungsanforderung
        try {
            if (adapter.config.triggerControlVoltage
            && controlVoltage.enable === false
            || adjustment === true
            ) {
                controlVoltage.wateringTime = sumOfWateringTime > controlVoltage.wateringTime ? sumOfWateringTime + 5 : controlVoltage.wateringTime;   // Schaltzeit der 24V Versorgung entsprechend der maximalen Laufzeit aller Ventile in der threadList anpassen
                const _controlVoltage = await setValve(controlVoltage, true);
                if (_controlVoltage === controlVoltage.control.idState) {
                    adapter.setStateAsync(`info.supplyVoltage`, {
                        val: controlVoltage.enable, 
                        ack: true
                    });
                    await asyncTime.setTimeout(switchingDistanceMS, undefined, undefined);
                }
            }                    
        } catch (error) {
            adapter.log.error(`Error trigger Control Voltage [${controlVoltage.control.idState}]: ${error}`);
        }
           
        // Pumpe einschalten bei Leistungsanforderung
        try {
            if (adapter.config.pumpSelection !== 'noPump'
            && currentPumpUse.enable === false
            || adjustment === true
            ) {
                currentPumpUse.wateringTime = sumOfWateringTime > currentPumpUse.wateringTime ? sumOfWateringTime : currentPumpUse.wateringTime;   // Schaltzeit der Pumpe entsprechend der maximalen Laufzeit aller Ventile in der threadList anpassen                
                const _currentPumpUse = await setValve(currentPumpUse, true);
                if (_currentPumpUse && _currentPumpUse === currentPumpUse.control.idState) {
                    timerOn = false;
                    adapter.setStateAsync(currentPumpUse.id, {
                        val: currentPumpUse.enable, 
                        ack: true
                    });
                    await asyncTime.setTimeout(currentPumpUse.leadTime, undefined, undefined);
                }
            }                   
        } catch (error) {
            adapter.log.error(`Error trigger current Pump [${currentPumpUse.control.idState}]: ${error}`);
        }
    }

    /* - wenn beim Umschalten der Pumpen die Förderleistung zu gering → Ventile deaktivieren - */
    if (consumption.curFlow < 0) {
        // aufsteigend sortieren nach der Verbrauchsmenge
        threadList.sort(mySortAscending);

        for await(const entry of threadList) {
            entry.ac.acUpdateListPuOff = new AbortController;    // acPumpeOff
            try {
                if (entry.enable                        //  eingeschaltet
                && !entry.killSprinkle                  //  && Aufgabe noch nicht erledigt
                && (consumption.curFlow < 0)            //  && Förderleistung der Pumpe zu gering
                ) {
                    entry.state = 'wait';   //1
                    const _setValve2 = await setValve(entry, false);
                    if (_setValve2 === entry.control.idState) {
                        consumption = await currentConsumption(true);
                        clearInterval(entry.countdown); // Zähler für Countdown, Verbrauchsmengen, usw. löschen
                        entry.countdown = null;
                        adapter.log.info(`Set Valve ID: ${entry.name} Pump delivery rate too low, wait!  curFlow ${consumption.curFlow} parallel: ${consumption.parallel}`);
                        await asyncTime.setTimeout(300, undefined, {signal: entry.ac.acUpdateListPuOff.signal});
                    }                    
                }else{
                    entry.ac.acUpdateListPuOff.abort();
                }
            } catch (error) {   // Fehler beim Reduzieren der Verbrauchsmenge
                adapter.log.error(`Error reducing consumption amount: ${error}`);
            } finally {
                if (entry.ac.acUpdateListPuOff.aborted === false) entry.ac.acUpdateListPuOff.abort();
            }
        }
    }

    adapter.log.debug(`curFlow: ${consumption.curFlow}, parallel: ${consumption.parallel}`);
    // absteigend sortieren nach der Verbrauchsmenge
    threadList.sort(mySortDescending);

    // einschalten der Bewässerungsventile nach Verbrauchsmenge und maximaler Anzahl
    for await(const entry of threadList) {
        try {
            if (!entry.enable                                                   // ausgeschaltet
            && !entry.killSprinkle                                              // && Aufgabe noch nicht erledigt
            && !entry.myBreak                                                   // && nicht in der Pause Interval-Beregnung
            && !entry.extBreak                                                  // && nicht in der externen Pause (extBreak)
            && !timeBasedRestrictionEn                                            // && nicht in der zeitlichen Bewässerungsbeschränkung
            && (consumption.curFlow >= entry.pipeFlow)                          // && noch genügend Förderleistung der Pumpe
            && (consumption.parallel < maxParallel)                             // && maxParallel noch nicht erreicht
            && !boostOn                                                         // && Ventile nur einschalten, wenn kein Boost aktive 
            && (boostReady  || !(myConfig.config[entry.sprinkleID].booster))    // && wenn kein Boostventil aktive ist => alle Ventile ein ansonsten nur Ventile ohne Boostfunktion
            ){
                entry.ac.acUpdateListOn = new AbortController;

                timerOn === true ? await asyncTime.setTimeout(switchingDistanceMS, undefined, {signal: entry.ac.acUpdateListOn.signal}) : timerOn = true;
                entry.state = myConfig.config[entry.sprinkleID].booster ? 'boost(on)' : 'on';    // state 4 => boost(on) : 2 => on
                const _setValve3 = await setValve(entry, true);
                if (_setValve3 === entry.control.idState) {
                    consumption = await currentConsumption(true);
                    if (myConfig.config[entry.sprinkleID].booster) {
                        boostReady = false;
                        boostOn = true;
                        boostOnTimer(entry);
                        adapter.log.debug(`ID: ${entry.name} UpdateList sprinkle On: boostReady = ${boostReady}`);
                    }

                    /* countdown starten */
                    if (!entry.startTime) {
                        entry.startTime = new Date();
                    }
                    adapter.log.debug(`!entry.countdown: ${!entry.countdown}, type: ${typeof(entry.countdown)}`);
                    if(!entry.countdown){
                        entry.countdown = setInterval(countSprinkleTime, 1000, entry); // 1000 = 1s
                        //entry.countdown = asyncTime.setInterval();
                    }                                    
                } else {
                    entry.ac.acUpdateListOn.abort();
                    entry.killSprinkle = true;
                }
            }
        } catch (error) {   //Fehler beim Einschalten der Bewässerungsventile
            adapter.log.error(`Error turning on irrigation valves [${entry.name}]: ${error}`);
        }
    }

    // Ausschalten der Ventile bei boostReady
    if (boostOn) {
        for await(const entry of threadList){
            entry.ac.acUpdateListBoostOn = new AbortController;
            try {
                if(entry.enable                                 // eingeschaltet
                && !entry.killSprinkle
                && !myConfig.config[entry.sprinkleID].booster
                ){
                    entry.state = 'off(Boost)';    //state => 5/off(boost)
                    const _setValve4 = await setValve(entry, false);
                    if (_setValve4 === entry.control.idState){
                        consumption = await currentConsumption(true);
                        clearInterval(entry.countdown);
                        entry.countdown = null;
                        await asyncTime.setTimeout(300, undefined, {signal: entry.ac.acUpdateListBoostOn.signal});    
                    }                    
                }    
            } catch (error) {
                entry.ac.acUpdateListBoostOn.abort();
                adapter.log.error(`Error when switching off the valves with boostReady [${entry.name}]: ${error}`);
            } finally {
                if (entry.ac.acUpdateListBoostOn.aborted === false) entry.ac.acUpdateListBoostOn.abort();
            }
        }
    }

    if (consumption.parallel === 0) {    // Pumpe nicht mehr erforderlich | 0 Ventile an

        // Pumpe ausschalten
        if (currentPumpUse.enable === true) {
            try {
                const _currentPumpUse = await setValve(currentPumpUse, false);
                if (_currentPumpUse === currentPumpUse.control.idState) {
                    adapter.setStateAsync(currentPumpUse.id,{
                        val: currentPumpUse.enable, 
                        ack: true
                    });
                    await asyncTime.setTimeout(switchingDistanceMS, undefined, undefined);
                }                 
            } catch (error) {
                adapter.log.error(`Error trigger current Pump [${currentPumpUse.idState}]: ${error}`);
            }            
        }

        if (adapter.config.pressureRelief === true          // Druckentlastungsventil aktiviert
            && adapter.config.pumpSelection !== 'noPump'    // && Pumpe vorhanden
        ) {
            try {
                const empty = await findPressureReliefValve();
                if (empty) {
                    pressureReliefValve.name = empty.objectName;
                    pressureReliefValve.wateringTime = 10;
                    pressureReliefValve.pipeFlow = empty.pipeFlow;
                    pressureReliefValve.enable = false;
                    pressureReliefValve.control = empty.control;
                    adapter.log.info(`Pressure relief valve: ${pressureReliefValve.name} with pipeFlow ${pressureReliefValve.pipeFlow} l/h for 10s opened!`);
                    await setValve(pressureReliefValve, true);
                    await asyncTime.setTimeout(1000 * pressureReliefValve.wateringTime, undefined, undefined);
                    await setValve(pressureReliefValve, false);
                    await asyncTime.setTimeout(switchingDistanceMS, undefined, undefined);
                }
            } catch (error) {
                adapter.log.error(`Error trigger pressure relief valve: ${error}`);
            }
        }

        // Spannungsversorgung (24V) ausschalten
        if(controlVoltage.enable === true) {
            try {
                const _controlVoltage = await setValve(controlVoltage, false);
                if (_controlVoltage === controlVoltage.control.idState) {
                    adapter.setStateAsync(`info.supplyVoltage`, {
                        val: controlVoltage.enable, 
                        ack: true
                    });
                    // await asyncTime.setTimeout(switchingDistanceMS, undefined, undefined);

                }                
            } catch (error) {
                adapter.log.error(`Error trigger Control Voltage [${controlVoltage.control.idState}]: ${error}`);
            }       
        }
    }

    for await(const entry of threadList){
        if(entry.killSprinkle
            && !entry.enable
        ){
            killList.push(entry.name);
        }
    }

    if (killList.length > 0) {
        await delList(killList);      // erledigte Bewässerungsaufgaben aus der threadList löschen
        await asyncTime.setTimeout(50,undefined,undefined);
    }

    updateListMarker.funcActive = false;
    if (updateListMarker.newStart === true) {
        updateListMarker.newStart = false;
        await asyncTime.setTimeout(50,undefined,undefined);
        updateList();
    }

}; // End updateList

/* --------------------------------------------------------------------------------------------------------------------------------------------------------------------- */

/**
 * +++++  Set the current pump for irrigation  +++++
 * → Festlegen der aktuellen Pumpe zur Bewässerung
 */
const setActualPump = async () => {
    try {
        switch(adapter.config.pumpSelection) {
            case 'noPump':
            case 'mainPump': {
                /* Pumpe AUS => Zisternen-Bewässerung nicht aktiviert */
                if (adapter.config.triggerCisternPump) {
                    adapter.setState('info.cisternState', {
                        val: `Cistern settings are not active! ${(fillLevelCistern > 0) ? (`level sensor: ${fillLevelCistern}% ${(adapter.config.triggerMinCisternLevel !== '') ? (`  ${adapter.config.triggerMinCisternLevel}%`) : ('')}`):('')}`,
                        ack: true
                    });
                }
                break;
            }

            case 'cistern': {
                if (fillLevelCistern < parseFloat(adapter.config.triggerMinCisternLevel)) {     //  (Zisterne unter Minimum)
                    if (!currentPumpUse.intBreak) {
                        currentPumpUse.intBreak = true;
                        adapter.log.warn('Cistern empty => irrigation no longer possible');
                        if(!sendMessageText.onlySendError()){
                            sendMessageText.sendMessage('Cistern empty => irrigation no longer possible');  // Zisterne leer => Bewässerung nicht mehr möglich
                        }
                    }
                    adapter.setState('info.cisternState', {
                        val: `Cistern empty: ${fillLevelCistern} % (${adapter.config.triggerMinCisternLevel} %)`,
                        ack: true
                    });
                    //  Pumpe ist eingeschaltet => ausschalten
                    if (currentPumpUse.enable) {
                        await setValve(currentPumpUse, false);
                        updateList();   // Wasserverbrauch an Pumpenleistung anpassen
                    }
                } else if (fillLevelCistern > parseFloat(adapter.config.triggerOnCisternLevel)) {
                    if (currentPumpUse.intBreak) {
                        currentPumpUse.intBreak = false;
                        adapter.log.warn('Cistern filled => irrigation can begin again');                   // Zisterne gefüllt => Bewässerung kann wieder beginnen
                        if(!sendMessageText.onlySendError()){
                            sendMessageText.sendMessage('Cistern filled => irrigation can begin again');
                        }
                    }
                    currentPumpUse.intBreak = false;
                    adapter.setState('info.cisternState', {
                        val: `Cistern filled: ${fillLevelCistern} % (${adapter.config.triggerMinCisternLevel} %)`,
                        ack: true
                    });
                    updateList();   // Wasserverbrauch an Pumpenleistung anpassen
                } else if (currentPumpUse.intBreak === true) {
                    adapter.setState('info.cisternState', {
                        val: `Cistern empty: ${fillLevelCistern} % (${adapter.config.triggerMinCisternLevel} %)`,
                        ack: true
                    });
                } else {
                    adapter.setState('info.cisternState', {
                        val: `Cistern filled: ${fillLevelCistern} % (${adapter.config.triggerMinCisternLevel} %)`,
                        ack: true
                    });
                }
                break;
            }

            case 'pumpAndCistern': {
                if (currentPumpUse.enable) {
                /* Bewässerungspumpen aktiv */
                    if ((fillLevelCistern < parseFloat(adapter.config.triggerMinCisternLevel)) && (currentPumpUse.pumpCistern === true)) {
                    /* (Zisterne unter Minimum) && (ZisternenPumpe läuft) */
                        const _setValveCisternPumpOff = await setValve(currentPumpUse, false);  // Pumpe Zisterne Aus
                        if (_setValveCisternPumpOff === currentPumpUse.control.idState) {
                            await adapter.setStateAsync(currentPumpUse.id, {      // set State cisternPump === false
                                val: currentPumpUse.enable, 
                                ack: true
                            });
                        }
                        currentPumpUse.pumpCistern = false;
                        currentPumpUse.name = 'Main pump';
                        currentPumpUse.control  = { ...mainPumpControl };
                        currentPumpUse.id = 'info.mainPump';
                        currentPumpUse.pumpPower = parseInt(adapter.config.triggerMainPumpPower);
                        /* Hauptpumpe Ein */
                        const _setValveMainPumpOn = await setValve(currentPumpUse, true);   
                        if (_setValveMainPumpOn === currentPumpUse.idState) {
                            await adapter.setStateAsync(currentPumpUse.id, {      // set State cisternPump === false
                                val: currentPumpUse.enable, 
                                ack: true
                            });
                        }
                        adapter.log.info('Pump change (cistern empty) Cistern pump off => main pump on');
                        if(!sendMessageText.onlySendError()){
                            sendMessageText.sendMessage('Pump change (cistern empty) Cistern pump off => main pump on');
                        }
                        updateList();   // Wasserverbrauch an Pumpenleistung anpassen
                    }
                } else {
                /* Bewässerungspumpen inaktiv */
                    if ((fillLevelCistern > parseFloat(adapter.config.triggerOnCisternLevel)) && (adapter.config.triggerCisternPump) && (adapter.config.triggerCisternPumpPower)) {
                    /* Zisterne voll && triggerCisternPump && triggerCisternPumpPower vorhanden*/
                        adapter.setState('info.cisternState', {
                            val: `Cistern filled: ${fillLevelCistern} % (${adapter.config.triggerMinCisternLevel} %)`,
                            ack: true
                        });
                        currentPumpUse.pumpCistern = true;
                        currentPumpUse.name = 'Cistern pump';
                        currentPumpUse.id = 'info.cisternPump';
                        currentPumpUse.control = { ...cisternPumpControl };
                        currentPumpUse.pumpPower = parseInt(adapter.config.triggerCisternPumpPower);

                    } else {
                        adapter.setState('info.cisternState', {
                            val: `Cistern empty: ${fillLevelCistern} % (adapter.config.triggerMinCisternLevel %)`,
                            ack: true
                        });
                        currentPumpUse.pumpCistern = false;
                        currentPumpUse.name = 'Main pump';
                        currentPumpUse.id = 'info.mainPump';
                        currentPumpUse.control = { ...mainPumpControl };
                        currentPumpUse.pumpPower = parseInt(adapter.config.triggerMainPumpPower);
                    }
                    adapter.setState('control.restFlow', {
                        val: `${currentPumpUse.pumpPower} (${currentPumpUse.pumpPower} | ${currentPumpUse.name})`,
                        ack: true
                    });
                }
                if (currentPumpUse.pumpCistern) {
                    adapter.setState('info.cisternState', {
                        val: `Cistern filled: ${fillLevelCistern} % (${adapter.config.triggerMinCisternLevel} %)`,
                        ack: true
                    });
                } else {
                    adapter.setState('info.cisternState', {
                        val: `Cistern empty: ${fillLevelCistern} % (${adapter.config.triggerMinCisternLevel} %)`,
                        ack: true
                    });
                }
                break;
            }
        }   
    } catch (error) {
        adapter.log.error(`setActualPump ${error}`);
    }
};   // End setActualPump


/**
 * Adding the consumption data to the history
 * => Hinzufügen der Verbrauchsdaten zur History
 * 
 * @param entry - array mit den Daten des aktiven Ventils
 */
function addConsumedAndTime(entry) {
    adapter.setState(`sprinkle.${entry.name}.history.lastConsumed`, {
        val: Math.round(entry.litersPerSecond * entry.count),
        ack: true
    });
    adapter.setState(`sprinkle.${entry.name}.history.lastRunningTime`, {
        val: tools.addTime(entry.count, ''),
        ack: true
    });
    const _formatTime = tools.formatTime(entry.startTime);
    adapter.setState(`sprinkle.${entry.name}.history.lastOn`, {
        val: _formatTime.dayTime,
        ack: true
    });
    adapter.getState(`sprinkle.${entry.name}.history.curCalWeekConsumed`, (err, state) => {
        if (state && state.val) {
            adapter.setState(`sprinkle.${entry.name}.history.curCalWeekConsumed`, {
                val: (+state.val) + Math.round(entry.litersPerSecond * entry.count),
                ack: true
            });
        }
    });
    adapter.getState(`sprinkle.${entry.name}.history.curCalWeekRunningTime`, (err, state) => {
        if (state && state.val) {
            adapter.setState(`sprinkle.${entry.name}.history.curCalWeekRunningTime`, {
                val: tools.addTime(+state.val, entry.count),
                ack: true
            });
        }
    });
}   // End addConsumedAndTime


/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
/*                                                       externe Funktionen                                                                     */
/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/

/**
 * -- externe Funktionen -> initValveControl - addList - extBreak - clearEntireList - setFillLevelCistern --
 */
const valveControl = {
    /**
     * Initialize the start configuration of ventilControl
     * => Initialisieren Sie die Startkonfiguration von ventilControl
     * 
     * @param {ioBroker.Adapter} myAdapter
     */
    initValveControl: async function (myAdapter) {
        adapter = adapter || myAdapter;

        try {
            switchingDistanceMS = (
                (+adapter.config.switchingDistance || 0) < 200)
                    ? 200
                    : (
                    (+adapter.config.switchingDistance > 240000)
                        ? 240000
                        : (+adapter.config.switchingDistance)
                );
            adapter.log.info(`switchingDistanceMS: ${switchingDistanceMS}ms`);

            /* Object supplyVoltage (VersorgungsSpannung) anlegen */
            if (adapter.config.triggerControlVoltage.length > 5) {

                controlVoltage.control = await tools.idStateControl(adapter, adapter.config.triggerControlVoltage);
                if (controlVoltage?.control?.idACK) adapter.subscribeForeignStates(controlVoltage.control.idACK);

                await adapter.setObjectNotExistsAsync(`info.supplyVoltage`, {
                    type: 'state',
                    common: {
                        role:  'switch',
                        name:  'Supply voltage',
                        desc:  {
                            en: 'power supply',
                            de: 'Stromversorgung',
                            ru: 'источник питания',
                            pt: 'fonte de energia',
                            nl: 'voeding',
                            fr: 'alimentation électrique',
                            it: 'Alimentazione elettrica',
                            es: 'fuente de alimentación',
                            pl: 'zasilacz',
                            uk: 'джерело живлення',
                           'zh-cn': '电源'
                        },
                        type:  'boolean',
                        read:  true,
                        write: false,
                        def:   false
                    },
                    native: {},
                });
            } else {
                const _supplyVoltage = await adapter.getObjectAsync(`info.supplyVoltage`);
                if (_supplyVoltage) await adapter.delObjectAsync(`info.supplyVoltage`);
            }
            
    
            /* Objekt control.parallelOfMax befüllen */
            maxParallel = parseInt(adapter.config.maximumParallelValves);
            adapter.setStateAsync('control.parallelOfMax', {
                val: `0 : ${adapter.config.maximumParallelValves}`,
                ack: true
            });

            /* Object mainPump und Cistern anlegen, wenn benötigt */
            const objMainPump = {
                type: 'state',
                common: {
                    role:  'indicator',
                    name:  'Main pump',
                    desc:  {
                        en: 'Main pump',
                        de: 'Hauptpumpe',
                        ru: 'Главный насос',
                        pt: 'Bomba principal',
                        nl: 'Hoofdpomp',
                        fr: 'Pompe principale',
                        it: 'Pompa principale',
                        es: 'Bomba principal',
                        pl: 'Główna pompa',
                        uk: 'Головний насос',
                       'zh-cn': '主泵'
                    },
                    type:  'boolean',
                    read:  true,
                    write: false,
                    def:   false
                },
                native: {},
            };
            const objCisternPump = {
                type: 'state',
                common: {
                    role:  'indicator',
                    name:  'Cistern pump',
                    desc:  {
                        en: 'Cistern pump',
                        de: 'Zisternenpumpe',
                        ru: 'Насос для цистерны',
                        pt: 'Bomba da cisterna',
                        nl: 'Cisternpomp',
                        fr: 'Pompe de citerne',
                        it: 'Pompa cisterna',
                        es: 'Bomba de cisterna',
                        pl: 'Pompa zbiornika',
                        uk: 'Насос цистерни',
                       'zh-cn': '水箱泵'
                    },
                    type:  'boolean',
                    read:  true,
                    write: false,
                    def:   false
                },
                native: {},
            };

            switch (adapter.config.pumpSelection) {

                case 'noPump': {
                    currentPumpUse.pumpCistern = false;
                    currentPumpUse.name = 'no pump';
                    currentPumpUse.intBreak = false;
                    currentPumpUse.control.idState = '';
                    currentPumpUse.id = '';
                    currentPumpUse.leadTime = 0;
                    currentPumpUse.pumpPower = parseInt(adapter.config.triggerMainPumpPower) || 0;
                    currentPumpUse.restFlow = parseInt(adapter.config.triggerMainPumpPower) || 0;
                    const _mainPump = await adapter.getObjectAsync(`info.mainPump`);
                    if (_mainPump) await adapter.delObjectAsync(`info.mainPump`);
                    const _cisternPump = await adapter.getObjectAsync(`info.cisternPump`);
                    if (_cisternPump) await adapter.delObjectAsync(`info.cisternPump`);
                    break;
                }

                case 'mainPump': {
                    mainPumpControl = await tools.idStateControl(adapter, adapter.config.triggerMainPump);
                    currentPumpUse.control = mainPumpControl;
                    if (currentPumpUse?.control?.idACK) adapter.subscribeForeignStates(currentPumpUse.control.idACK);
                    currentPumpUse.pumpCistern = false;
                    currentPumpUse.name = 'Main pump';
                    currentPumpUse.intBreak = false;
                    currentPumpUse.id = 'info.mainPump';
                    currentPumpUse.leadTime = (parseInt(adapter.config.mainPumpLeadTime) || 5) * 1000;
                    currentPumpUse.pumpPower = parseInt(adapter.config.triggerMainPumpPower) || 0;
                    currentPumpUse.restFlow = parseInt(adapter.config.triggerMainPumpPower) || 0;
                    // @ts-ignore
                    await adapter.setObjectNotExistsAsync(`info.mainPump`, objMainPump);
                    const _cisternPump = await adapter.getObjectAsync(`info.cisternPump`);
                    if (_cisternPump) await adapter.delObjectAsync(`info.cisternPump`);
                    break;
                }

                case 'cistern': {
                    /*     Füllstand der Zisterne in % holen     */
                    const _actualValueLevel = await adapter.getForeignStateAsync(adapter.config.actualValueLevel);
                    if (_actualValueLevel && _actualValueLevel.val) {
                        if (typeof _actualValueLevel.val === 'number') {
                            fillLevelCistern = _actualValueLevel.val;
                            (_actualValueLevel.val > parseInt(adapter.config.triggerMinCisternLevel)) ? currentPumpUse.intBreak = false : currentPumpUse.intBreak = true;
                        } else if (typeof _actualValueLevel.val === 'boolean') {
                            if (_actualValueLevel.val) {
                                currentPumpUse.intBreak = false;
                                fillLevelCistern = 100;
                            } else {
                                currentPumpUse.intBreak = true;
                                fillLevelCistern = 0;
                            }
                        } else {
                            adapter.log.warn(`level sensor in the cistern => Wrong value: ${_actualValueLevel.val}, Type: ${typeof _actualValueLevel.val}`);
                        }
                    } else {
                        adapter.log.warn(`level sensor in the cistern => Wrong value: ${JSON.stringify(_actualValueLevel)}`);
                        fillLevelCistern = 0;
                        currentPumpUse.intBreak = true;
                    }

                    cisternPumpControl = await tools.idStateControl(adapter, adapter.config.triggerCisternPump);
                    currentPumpUse.control = cisternPumpControl;
                    if (currentPumpUse?.control?.idACK) adapter.subscribeForeignStates(currentPumpUse.control.idACK);
                    currentPumpUse.pumpCistern = false;
                    currentPumpUse.name = 'Cistern pump';
                    currentPumpUse.id = 'info.cisternPump';
                    currentPumpUse.leadTime = (parseInt(adapter.config.cisternPumpLeadTime) || 5) * 1000;
                    currentPumpUse.pumpPower = parseInt(adapter.config.triggerCisternPumpPower) || 0;
                    currentPumpUse.restFlow = parseInt(adapter.config.triggerCisternPumpPower) || 0;
                    // @ts-ignore
                    await adapter.setObjectNotExistsAsync(`info.cisternPump`, objCisternPump);
                    const _mainPump = await adapter.getObjectAsync(`info.mainPump`);
                    if (_mainPump) await adapter.delObjectAsync(`info.mainPump`);
                    break;
                }
                
                case 'pumpAndCistern': {
                    currentPumpUse.enable = false;
                    mainPumpControl = await tools.idStateControl(adapter, adapter.config.triggerMainPump);
                    cisternPumpControl = await tools.idStateControl(adapter, adapter.config.triggerCisternPump);
                    if (mainPumpControl?.idACK) adapter.subscribeForeignStates(mainPumpControl.idACK);
                    if (cisternPumpControl?.idACK) adapter.subscribeForeignStates(cisternPumpControl.idACK);
                    if (adapter.config.actualValueLevel) {
                        /*     Füllstand der Zisterne in % holen     */
                        const _actualValueLevel = await adapter.getForeignStateAsync(adapter.config.actualValueLevel);
                        if (_actualValueLevel && _actualValueLevel.val) {
                            if (typeof _actualValueLevel.val === 'number') {
                                fillLevelCistern = _actualValueLevel.val;
                            } else if (typeof _actualValueLevel.val === 'boolean') {
                                _actualValueLevel.val ? fillLevelCistern = 100 : fillLevelCistern = 0;
                            } else {
                                fillLevelCistern = 0;
                                adapter.log.warn(`level sensor in the cistern => Wrong value: ${_actualValueLevel.val}, Type: ${typeof _actualValueLevel.val}`);
                            }
                        }
                        
                        if (fillLevelCistern > parseInt(adapter.config.triggerMinCisternLevel)) {
                            /*     Zisterne voll     */
                            currentPumpUse.pumpCistern = true;
                            currentPumpUse.name = 'Cistern pump';
                            currentPumpUse.control = { ...cisternPumpControl };
                            currentPumpUse.id = 'info.cisternPump';
                            currentPumpUse.leadTime = (parseInt(adapter.config.cisternPumpLeadTime) || 5) * 1000;
                            currentPumpUse.pumpPower = parseInt(adapter.config.triggerCisternPumpPower) || 0;
                            currentPumpUse.restFlow = parseInt(adapter.config.triggerCisternPumpPower) || 0;
                        } else {
                            /*     Zisterne leer     */
                            currentPumpUse.pumpCistern = false;
                            currentPumpUse.name = 'Main pump';
                            currentPumpUse.control = { ...mainPumpControl };
                            currentPumpUse.id = 'info.mainPump';
                            currentPumpUse.leadTime = (parseInt(adapter.config.mainPumpLeadTime) || 5) * 1000;
                            currentPumpUse.pumpPower = parseInt(adapter.config.triggerMainPumpPower) || 0;
                            currentPumpUse.restFlow = parseInt(adapter.config.triggerMainPumpPower) || 0;
                        }

                        currentPumpUse.intBreak = false;
                    }
                    // @ts-ignore
                    await adapter.setObjectNotExistsAsync(`info.mainPump`, objMainPump);
                    // @ts-ignore
                    await adapter.setObjectNotExistsAsync(`info.cisternPump`, objCisternPump);
                    break;
                }
                default: {
                    currentPumpUse.intBreak = true;
                    adapter.log.error(`In the configuration, under Pump settings, select the Pump selection field.`);
                    const _mainPump = await adapter.getObjectAsync(`info.mainPump`);
                    if (_mainPump) await adapter.delObjectAsync(`info.mainPump`);
                    const _cisternPump = await adapter.getObjectAsync(`info.cisternPump`);
                    if (_cisternPump) await adapter.delObjectAsync(`info.cisternPump`);
                    break;
                }
            }
            /* Objekt control.restFlow befüllen */
            adapter.setStateAsync('control.restFlow', {
                val: `${currentPumpUse.pumpPower} (${currentPumpUse.pumpPower} | ${currentPumpUse.name})`,
                ack: true
            });
    
            /*Pumpe ausschalten*/
            currentPumpUse.enable = false;
            /* Pumpe ausschalter, wenn vorhanden */
            if (adapter.config.triggerMainPump !== '') {
                const _triggerMainPump = await adapter.getStateAsync('adapter.config.triggerMainPump');
                if (_triggerMainPump?.val === true) {
                    await adapter.setStateAsync(adapter.config.triggerMainPump, {
                        val: false,
                        ack: false
                    });
                    await adapter.setStateAsync('info.mainPump', {
                        val:false, 
                        ack:false
                    });
                    await asyncTime.setTimeout(100, undefined, undefined); // kurze Wartezeit, damit die Hauptpumpe sicher ausschalten kann
                }
            }
            /* Pumpe (Zisterne) ausschalter, wenn vorhanden */
            if (adapter.config.triggerCisternPump !== '') {
                const _triggerCisternPump = await adapter.getStateAsync('adapter.config.triggerCisternPump');
                if (_triggerCisternPump?.val === true) {
                    await adapter.setStateAsync(adapter.config.triggerCisternPump, {
                        val: false,
                        ack: false
                    });
                    await adapter.setStateAsync('info.cisternPump', {
                        val:false, 
                        ack:false
                    });
                    await asyncTime.setTimeout(100, undefined, undefined); // kurze Wartezeit, damit die Zisterne sicher ausschalten kann
                }
            }
            /* alle Ventile (.name = "hm-rpc.0.MEQ1234567.3.STATE") in einem definierten Zustand (false) versetzen*/
            const result = adapter.config.events;
            let testMaxFlow;
            if (adapter.config.pumpSelection === 'pumpAndCistern') {
                testMaxFlow = (parseFloat(adapter.config.triggerCisternPumpPower) > parseFloat(adapter.config.triggerMainPumpPower)) ? parseFloat(adapter.config.triggerCisternPumpPower) : parseFloat(adapter.config.triggerMainPumpPower);
            } else {
                testMaxFlow = currentPumpUse.pumpPower;
            }
            if (result) {
                for (const res of result) {
                    const objectName = (res.name !== '') ? res.name.replace(/[.;, ]/g, '_') : res.name.replace(/[.;, ]/g, '_');
                    const _valve = await adapter.getStateAsync(res.name);
                    if (_valve?.val === true) {
                        await adapter.setStateAsync(res.name, {
                            val: false,
                            ack: false
                        });
                        await asyncTime.setTimeout(100, undefined, undefined); // kurze Wartezeit, damit die Ventile sicher ausschalten können
                    }
                    /*Kontrolle Flow Pumpe > Flow Ventil*/
                    if (testMaxFlow < parseInt(res.pipeFlow)) {
                        adapter.log.warn(`The irrigation circuit ${objectName} cannot start! pipeFlow ${res.pipeFlow} > maxFlow ${testMaxFlow}! logicError in the configuration`);
                    }
                }
            }
        } catch (error) {
            adapter.log.error(`initValveControl ERROR: ${error}`);
        }

    },  // End initValveControl

    /**
     *  Add Sprinkle
     * → Sprinkle hinzufügen
     * - auto → Automatik == (true), Handbetrieb == (false)
     * - sprinkleID → zugriff auf myConfig.config[sprinkleID]. xyz
     * - wateringTime → Bewässerungszeit in min
     * 
     * @param {Array.<{auto: boolean, sprinkleID: number, wateringTime: number}>} sprinkleList
     */
    addList: async function (sprinkleList) {
        try {
            // kontrolle bei ausgeschalteter Pumpe, ob die Zisterne zur Bewässerung genutzt werden kann
            if (adapter.config.pumpSelection === 'pumpAndCistern'
                && currentPumpUse.enable === false
                && fillLevelCistern > parseFloat(adapter.config.triggerMinCisternLevel)
            ){
                await setActualPump();
            }
            for await (const res of sprinkleList) {
                const name = myConfig.config[res.sprinkleID].objectName;
                /**
                 * add done
                 * → hinzufügen erledigt (Sprenger bereits aktive)
                 * 
                 */
                let addDone = false;
                // schauen ob der Sprenger schon in der threadList ist
                if (threadList) {
                    for await (const entry of threadList) {
                        if (entry.sprinkleID === res.sprinkleID) {
                            if (entry.wateringTime === res.wateringTime) {
                                return;
                            }
                            // wenn der Sprenger aktiv ist und die Bewässerungszeit verlängert werden muss
                            if (entry.enable === true
                                && adapter.config.switchingBehavior === 'homematic'
                                && entry.wateringTime < res.wateringTime
                            ) {
                                entry.wateringTime = res.wateringTime;
                                const _setValve2 = await setValve(entry, true);
                                if (_setValve2 !== entry.control.idState) throw new Error(`update ID: ${entry.name} => An error occurred while updating the irrigation time for Homematic devices. Please check the connection to the device and the configuration of the switching behavior.`);
                            } else {
                                entry.wateringTime = res.wateringTime;
                                adapter.log.debug(`update ID: ${entry.name} new time: ${tools.addTime(res.wateringTime, '')}`);
                            }
                            entry.autoOn = res.auto; // auto: = true autostart; = false Handbetrieb
                            await adapter.setStateAsync(`sprinkle.${name}.runningTime`, {
                                val: tools.addTime(res.wateringTime, ''),
                                ack: true
                            });
                            addDone = true; // Sprinkle found
                            break;
                        }
                    }
                }

                if (!addDone) {
                    if (res.wateringTime <= 0) {
                        adapter.setState(`sprinkle.${name}.runningTime`, {
                            val: '00:00',
                            ack: true
                        });
                        return;
                    }

                    const newThread = {};
                        newThread.sprinkleID = res.sprinkleID; // Array[0...] 
                        newThread.name = name; // z.B "Blumenbeet"
                        newThread.control = { ...myConfig.config[res.sprinkleID].control }; // {idState:, idON_TIME:, idACK:, maker:}  
                        newThread.wateringTime = res.wateringTime; // Bewässerungszeit 
                        newThread.pipeFlow = myConfig.config[res.sprinkleID].pipeFlow; // Wasserverbrauch 
                        newThread.count = 0; // Zähler im Sekundentakt 
                        newThread.calcOn = (myConfig.config[res.sprinkleID].methodControlSM === 'calculation'); //  Anpassung der Bodenfeuchte true/false
                    if (newThread.calcOn) {
                        newThread.soilMoisture15s = 15 * (myConfig.config[res.sprinkleID].calculation.maxIrrigation - myConfig.config[res.sprinkleID].calculation.triggersIrrigation)
                        / (60 * myConfig.config[res.sprinkleID].wateringTime);
                    }
                    /**  0:"off", 1:"wait", 2:"on", 3:"break", 4:"Boost(on)", 5:"off(Boost)", 6:"Cistern empty", 7:"extBreak" */ 
                        newThread.state = 'wait'; // zustand des Ventils Softwaremäßig 
                        newThread.enable = false; // zustand des Ventil softwaremäßig 
                        newThread.myBreak = false; // meine interne Pause 
                        newThread.extBreak = myConfig.config[res.sprinkleID].extBreak; // extBreak wird über .sprinkle.*.extBreak geschaltet 
                        newThread.killSprinkle = false; // Löschauftrag ausführen am Ende in threadList 
                        newThread.litersPerSecond = myConfig.config[res.sprinkleID].pipeFlow / 3600; // Wasserverbrauchsmenge pro Sekunde 
                        newThread.onOffTimeOff = myConfig.config[res.sprinkleID].wateringIntervalOff; 
                        newThread.onOffTimeOn = myConfig.config[res.sprinkleID].wateringIntervalOn; 
                        newThread.autoOn = res.auto; 
                        newThread.controller = {};   // controlle von Zeiten und Abbruchsignalen 
                        newThread.ac = {};           // object zum speichern des abortController 
                        newThread.id = threadList.length || 0;
                    threadList.push(newThread);
                    /* Zustand des Ventils im Thread < 0 > off, <<< 1 >>> wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost), < 6 > Cistern empty, < 7 > extBreak */
                    newThread.extBreak ? (newThread.state = 'extBreak') : timeBasedRestrictionEn === true ? (newThread.state = 'Irrigation ban') : (newThread.state = 'wait');
                    adapter.setState(`sprinkle.${name}.sprinklerState`, {
                        val: newThread.state,
                        ack: true
                    });
                    adapter.setState(`sprinkle.${name}.runningTime`, {
                        val: tools.addTime(res.wateringTime, ''),
                        ack: true
                    });
                    
                    adapter.log.debug(`ID: ${name} new order created: ${JSON.stringify(threadList[newThread.id])}`);
                }
            }
            updateList();
        } catch (error) {
            adapter.log.warn(`valveControl.addList: ${JSON.stringify(sprinkleList)} => ${error}`);
        }

    }, // End addList

    timeBasedRestriction: async function (enable) {         //Irrigation ban => zeitliche Bewässerungsbeschränkung noch zu bearbeiten ! ! !
        try {            
            timeBasedRestrictionEn = enable;
            if (threadList) {
                if (timeBasedRestrictionEn === true) {      // zeitliche Bewässerungsbeschränkung aktiv
                    for await (const entry of threadList) {
                        if (entry.enable === true) {            // Ventil ist aktiv, dann Ventil ausschalten
                            const _setValve = await setValve(entry, false);
                            if (_setValve === entry.control.idState) {
                                entry.state = 'Irrigation ban';
                                clearInterval(entry.countdown);                // Timer Countdown löschen
                                entry.countdown = null;
                                /* Booster zurücksetzen falls aktiv*/
                                if (myConfig.config[entry.sprinkleID].booster) {
                                    entry.ac.acBoostOnTimer.abort(entry.extBreak);
                                    boostReady = true;
                                    boostOn = false;
                                    adapter.log.debug(`ID: ${entry.name} UpdateList Sprinkle Off: boostReady = ${boostReady}`);
                                }
                            } else {
                                if(!sendMessageText.onlySendError()){
                                    sendMessageText.sendMessage(`The valve, ${entry.name}, could not be deactivated. Please turn it off manually.`);
                                }
                                adapter.log.warn(`The valve, ${entry.name}, could not be deactivated. Please turn it off manually.`);
                                entry.state = 'undefined';
                            }
                        } else {
                            entry.state = 'Irrigation ban';
                        }
                        adapter.setStateAsync(`sprinkle.${entry.name}.sprinklerState`, {
                            val: entry.state,
                            ack: true
                        });
                    }
                } else {
                    for await (const entry of threadList) {     // zeitliche Bewässerungsbeschränkung beendet
                        entry.state = (entry.extBreak === true) ? 'extBreak' : 'wait';
                        adapter.setStateAsync(`sprinkle.${entry.name}.sprinklerState`, {
                            val: entry.state,
                            ack: true
                        });
                    }
                }
            }
            updateList();
            return true;
        } catch (error) {
            adapter.log.warn(`TimeBasedRestriction: ${error}`);
            return false;
        }
    },
    /**
     * extBreak => Spränger unterbrechen bei extBreak
     * 
     * @param {number} sprinkleID
     * @param {boolean} extBreak
     * @returns {Promise<{val: boolean}>} val: true/false = Ventil gefunden / nicht gefunden
     */
    extBreak: async function (sprinkleID, extBreak) {
        try {
            const _found = await tools.findAsync(threadList, async (d) => {
                                return Promise.resolve (d.sprinkleID === sprinkleID);
                            });

            if (_found?.sprinkleID === sprinkleID) {
                _found.extBreak = extBreak;
                if (extBreak === true) {    // extBreak aktiv
                    if (_found.enable === true) {                           // Ventil ist eingeschaltet
                        const _setValve = await setValve(_found, false);
                        if (_setValve === _found.control.idState) {
                            _found.state = 'extBreak';                      // <<< 7 >>> extBreak
                            clearInterval(_found.countdown);                // Timer Countdown löschen
                            _found.countdown = null;
                            /* Booster zurücksetzen */
                            if (myConfig.config[_found.sprinkleID].booster) {
                                _found.ac.acBoostOnTimer.abort(extBreak);
                                boostReady = true;
                                boostOn = false;
                                adapter.log.debug(`ID: ${_found.name} UpdateList Sprinkle Off: boostReady = ${boostReady}`);
                            }
                        }
                    } else {                                                // Ventil ist in bereitschaft, aber extBreak wird aktiviert
                        _found.state = 'extBreak';                          // <<< 7 >>> extBreak
                    }
                } else {
                    // extBreak beendet und Zeit noch nicht abgelaufen?
                    (_found.count < _found.wateringTime) ? (_found.state = 'wait') : (_found.state = 'off');     // (Bewässerung noch nicht erledigt) ? (< 0 > off) : (< 1 > wait)
                }
                /* Zustand des Ventils im Thread < 0 > off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost), < 6 > Cistern empty, <<< 7 >>> extBreak */
                await adapter.setStateAsync(`sprinkle.${_found.name}.sprinklerState`, {
                    val: _found.state,
                    ack: true
                });
                adapter.log.debug(`valveControl.extBreak: ${extBreak}, Name: ${_found.name}, ID: ${_found.sprinkleID}`);   // löschen
                updateList();
                return {
                    name: _found.name,
                    val: true
                };
            } else {
                return {
                    name: null,
                    val: false
                };
            }
        } catch (error) {
            adapter.log.warn(`valveControl.extBreak(${sprinkleID}, ${extBreak}) => ${error}`);
            return {
                name: null,
                val: false
            };
        }
    },

    /**
     * switch off all devices, when close the adapter
     * => Beim Beenden des adapters alles ausschalten
     */
    clearEntireList: async function () {
        try {
            if (controlVoltage?.control?.idState) await setValve(controlVoltage, false);
            if (currentPumpUse?.control?.idState) await setValve(currentPumpUse, false);
            // let bValveFound = false;	// Ventil gefunden
            for (let counter = threadList.length - 1;	// Loop über das Array
                counter >= 0;
                counter--) {
                const entry = threadList[counter];
                /* Zustand des Ventils im Thread <<< 0 >>> off, < 1 > wait, < 2 > on, < 3 > break, < 4 > Boost(on), < 5 > off(Boost) */
                entry.state = 'off';    //0
                if (entry.enable) {
                    await setValve(entry, false);
                    adapter.log.info(`Set Valve (SprinkleControl: off) ID: ${ entry.name }, value: false`);
                } else {
                    adapter.setStateAsync(`sprinkle.${ entry.name}.sprinklerState`, {
                        val: entry.state,
                        ack: true
                    });                    
                }
                adapter.setStateAsync(`sprinkle.${ entry.name }.runningTime`, {
                    val: '00:00',
                    ack: true
                });
                adapter.setStateAsync(`sprinkle.${ entry.name }.countdown`, {
                    val: '0',
                    ack: true
                });
                /* Verbrauchswerte in der Historie aktualisieren */
                addConsumedAndTime(entry);
                /* del timer countdown */
                clearInterval(entry.countdown);
                entry.countdown = null;
                /* Timer abbrechen */
                if (entry?.ac?.acSetValveCancelTimeout?.aborted === false) entry.ac.acSetValveCancelTimeout.abort();   // setValve
                if (entry?.ac?.acBoostOnTimer?.aborted === false) entry.ac.acBoostOnTimer.abort();            // BoostOnTimer
                if (entry?.ac?.acUpdateListPuOff?.aborted === false) entry.ac.acUpdateListPuOff.abort();         // UpdateList Pumpe aus (Leistung zu gering beim Pumpenwechsel)
                if (entry?.ac?.acUpdateListOn?.aborted === false) entry.ac.acUpdateListOn.abort();            // UpdateList Ventile ein
                if (entry?.ac?.acUpdateListBoostOn?.aborted === false) entry.ac.acUpdateListBoostOn.abort();       // UpdateList Ausschalten der Ventile bei BoostOn
                if (entry?.ac?.acOnOffTimeoutOff?.aborted === false) entry.ac.acOnOffTimeoutOff.abort();         // OnOffTimeoutOff Ausschaltdauer bei on-off-Betrieb

                adapter.log.debug(`order deleted Stop all ID: ${ entry.name } ( rest orders: ${ threadList.length } )`);
                threadList.pop();   // del last array
            }
            boostReady = true;
            boostOn = false;
            const _currentConsumption = await currentConsumption(true);
            if (_currentConsumption.parallel > 0) throw new Error(`clearEntireList: Not all valves in the list have been deleted`);        // Nicht alle Ventile in der Liste wurden gelöscht
            return true;
        } catch (error) {
            if (error) {
                adapter.log.warn(`valveControl.clearEntireList() => ${ error }`);
            }
            return false;
        }
        
    }, // End clearEntireList

    /**
     * Änderungen des Füllstands setzen + Vorrang der Pumpe setzen
     * 
     * @param {number|string|boolean} levelCistern
     */
    setFillLevelCistern: function (levelCistern) {
        adapter.log.debug(`setFillLevelCistern: ${levelCistern}`);
        if(typeof levelCistern === 'number') {
            fillLevelCistern = levelCistern;
        }else if(typeof levelCistern === 'string') {
            fillLevelCistern = parseFloat(levelCistern);
        }else if(typeof levelCistern === 'boolean') {
            (levelCistern === true) ? fillLevelCistern = 100 : fillLevelCistern = 0;
        }
        setActualPump();
    },   // End setFillLevelCistern

    /**
     * Abfrage von intBreak der Zisternenpumpe
     * 
     * @returns {boolean} intBreak
     */
    getIntBreakCisternPump: function () {
       return (adapter.config.pumpSelection === 'cistern') ? currentPumpUse.intBreak : false;
    }

};  // End valveControl

/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/

module.exports = {
    valveControl,
    controlVoltage,
    currentPumpUse,
    threadList,
    pressureReliefValve
};