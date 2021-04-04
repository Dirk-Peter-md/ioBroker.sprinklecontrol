'use strict';

const sendMessageText = require('./sendMessageText.js');            // sendMessageText

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;

const myConfig = {
    config: [],
    /**
     *
     * @param {ioBroker.Adapter} myAdapter - Kopie von Adapter main.js
     */
    createConfig: (myAdapter) => {
        adapter = myAdapter;
        const result = adapter.config.events;
        if (result) {
            for (const res of result) {
                const objectName = res.sprinkleName.replace(/[.;, ]/g, '_');
                const newEntry = {
                    /** @type {boolean} */ 'enabled': res.enabled || false,
                    /** @type {boolean} */ 'booster': res.booster,
                    /** @type {number}  */ 'endIrrigation': res.endIrrigation,
                    /** @type {boolean} */ 'autoOnOff': true,
                    /** @type {string}  */ 'objectName': objectName,		// z.B. Rasenumrandung
                    /** @type {string}  */ 'objectID': adapter.namespace + '.sprinkle.' + objectName + '.runningTime',		// sprinklecontrol.0.sprinkle.Rasenumrandung.runningTime
                    /** @type {string}  */ 'idState': res.name,                                                     // "hm-rpc.0.MEQ1234567.3.STATE"
                    /** @type {boolean} */ 'objectState': false,                                                    // Zustand des Ventils auf deren Rückmeldung gewartet wirt
                    /** @type {any}     */ 'updateStateTimerID': null,                                              // Timer wird gelöscht wenn Rückmeldung erfolgte
                    /** @type {number}  */ 'sprinkleID': myConfig.config.length,		                            // Array[0...]
                    /** @type {number}  */ 'wateringTime': parseInt(res.wateringTime),		                        // ...min
                    /** @type {number}  */ 'wateringAdd': parseInt(res.wateringAdd),		                        // 0 ... 200%
                    /** @type {number}  */ 'wateringInterval': ((60 * parseInt(res.wateringInterval)) || 0),		// 5,10,15min
                    /** @type {number}  */ 'pipeFlow': parseInt(res.pipeFlow),
                    'soilMoisture': {
                        /** @type {number} */ 'val': parseInt(res.maxSoilMoistureIrrigation) / 2,                   // (zB. 5 mm)
                        /** @type {number} */ 'pct': 50,                                                            //  50% = maxSoilMoistureIrrigation) / 2
                        /** @type {number} */ 'min': parseInt(res.maxSoilMoistureIrrigation) / 100,                 // (zB. 0,02 mm)
                        /** @type {number} */ 'maxIrrigation': parseInt(res.maxSoilMoistureIrrigation),             // (zB. 10 mm)
                        /** @type {number} */ 'maxRain': parseInt(res.maxSoilMoistureRain),                         // (zB. 12 mm)
                        /** @type {number} */ 'triggersIrrigation': parseInt(res.maxSoilMoistureIrrigation) * parseInt(res.triggersIrrigation) / 100,           // (zB. 50 % ==> 5 mm)
                        /** @type {number} */ 'pctTriggerIrrigation': parseInt(res.triggersIrrigation),             // (zB. 50%)
                    }
                };
                myConfig.config.push(newEntry);

                if (newEntry.enabled) {
                    // Report a change in the status of the trigger IDs (.runningTime; .name) => Melden einer Änderung des Status der Trigger-IDs
                    adapter.subscribeStates(newEntry.objectID);	// abonnieren der Statusänderungen des Objekts (reagieren auf 'runningTime' der einzelnen Bewässerungskreise)
                    adapter.subscribeForeignStates(newEntry.idState); // abonnieren der Statusänderungen des Objekts (reagiert auf änderung des 'Ventils' der einzelnen Bewässerungskreise zur Fehlerkontrolle)
                }
                if (adapter.config.debug) {
                    adapter.log.info('main => resConfigChange add: ' + objectName + '(' + newEntry.sprinkleID + ')   ' + JSON.stringify(myConfig.config[newEntry.sprinkleID]));
                }
            }
        }
    },
    /**
     * apply Evaporation
     * => Verdunstung anwenden auf die einzelnen Sprenger kreise
     * @param {number} eTP - pot. Evapotranspiration nach Penman ETp in mm/d
     */
    applyEvaporation: (eTP) => {
        if (myConfig.config) {
            for(const entry of myConfig.config) {
                const objectName = entry.objectName;
                const pfadActSoiMoi = 'sprinkle.' + objectName + '.actualSoilMoisture';

                entry.soilMoisture.val -= eTP;		// Abfrage => entry.soilMoisture.val
                if (entry.soilMoisture.val < entry.soilMoisture.min) {
                    entry.soilMoisture.val = entry.soilMoisture.min;
                } else if (entry.soilMoisture.val > entry.soilMoisture.maxRain) {
                    entry.soilMoisture.val = entry.soilMoisture.maxRain;
                }
                entry.soilMoisture.pct = Math.round(1000 * entry.soilMoisture.val / entry.soilMoisture.maxIrrigation) / 10;	// Berechnung in %
                if (adapter.config.debug) {adapter.log.info(objectName + ' => soilMoisture: ' + entry.soilMoisture.val + ' soilMoisture in %: ' + entry.soilMoisture.pct + ' %');}
                adapter.setState(pfadActSoiMoi, {
                    val: entry.soilMoisture.pct,
                    ack: true
                });
            }
        }
    },
    /**
     *
     * @param {number} mySprinkleID
     */
    setSoilMoistPct100: (mySprinkleID) => {
        adapter.log.info('setSoilMoistPct100: (' + mySprinkleID + ') + Name: ' + myConfig.config[mySprinkleID].objectName );
        myConfig.config[mySprinkleID].soilMoisture.val = myConfig.config[mySprinkleID].soilMoisture.maxIrrigation;
        myConfig.config[mySprinkleID].soilMoisture.pct = 100;
        adapter.setState('sprinkle.' + myConfig.config[mySprinkleID].objectName + '.actualSoilMoisture', {
            val: myConfig.config[mySprinkleID].soilMoisture.pct,
            ack: true
        });
    },
    /**
     *
     * @param {number} mySprinkleID - ID des Bewässerungskreis
     * @param {number} addVal - soilMoisture.val wird um den Wert addVal erhöht
     */
    addSoilMoistVal: (mySprinkleID, addVal) => {
        adapter.log.info('addSoilMoistVal: (' + mySprinkleID + ', ' + addVal + ') + Name: ' + myConfig.config[mySprinkleID].objectName );
        myConfig.config[mySprinkleID].soilMoisture.val += addVal;
        myConfig.config[mySprinkleID].soilMoisture.pct = Math.round(1000 * myConfig.config[mySprinkleID].soilMoisture.val
            / myConfig.config[mySprinkleID].soilMoisture.maxIrrigation) / 10;	// Berechnung in %
        adapter.setState('sprinkle.' + myConfig.config[mySprinkleID].objectName + '.actualSoilMoisture', {
            val: myConfig.config[mySprinkleID].soilMoisture.pct,
            ack: true
        });
    },
    /**
     * setTimeout zur Fehlermeldung eines Ventils, wenn dieses nicht schaltet
     * @param {number} mySprinkleID - ID des Bewässerungskreis
     * @param {boolean} newState - neuer Wert des Sprinkler Ventils
     */
    setValveTimerID: (mySprinkleID, newState) => {
        myConfig.config[mySprinkleID].objectState = newState;
        // Wenn das Ventil seinen zustand ändert so wird der Timer + Meldung gelöscht
        adapter.log.info('setValveTimerID #0: ' + myConfig.config[mySprinkleID].objectName + ', TimerID: ' + myConfig.config[mySprinkleID].updateStateTimerID + ', state: ' + newState);
        myConfig.config[mySprinkleID].updateStateTimerID = setTimeout (() => {
            sendMessageText.sendMessage('Error: Ventil hat nicht geschaltet: ' + myConfig.config[mySprinkleID].objectName + ' (' + newState + ')');
            adapter.log.info('setValveTimerID #2: ' + myConfig.config[mySprinkleID].objectName + ' TimerID: '  + myConfig.config[mySprinkleID].updateStateTimerID);
        }, 1000);
    },
    /**
     * clearTimeout der Fehlermeldung eines schaltenden Ventils
     * @param {number} mySprinkleID - ID des Bewässerungskreis
     * @param {boolean} newState - neuer Wert des Sprinkler Ventils
     */
    delValveTimerID: (mySprinkleID, newState) => {
        adapter.log.info('delValveTimerID #1: ' + myConfig.config[mySprinkleID].objectName + ' TimerID: '  + myConfig.config[mySprinkleID].updateStateTimerID + ', state: ' + newState + ', if (' + (myConfig.config[mySprinkleID].objectState === newState && myConfig.config[mySprinkleID].updateStateTimerID) + ')');
        if ((myConfig.config[mySprinkleID].objectState === newState) && myConfig.config[mySprinkleID].updateStateTimerID) {
            clearTimeout(myConfig.config[mySprinkleID].updateStateTimerID);
        }
    }
};

module.exports = myConfig;