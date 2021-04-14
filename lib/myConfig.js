'use strict';
/*
 info:  log aufbau myConfig.js: #1.*
 */
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
                    adapter.log.info('#1.0 => Set ID: ' + objectName + '(' + newEntry.sprinkleID + ') hinzugefügt - ' + JSON.stringify(myConfig.config[newEntry.sprinkleID]));
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
                if (adapter.config.debug) {
                    adapter.log.info('#1.1 Set ID: ' + objectName + ' => soilMoisture: ' + entry.soilMoisture.val + ' soilMoisture in %: ' + entry.soilMoisture.pct + ' %');
                }
                adapter.setState(pfadActSoiMoi, {
                    val: entry.soilMoisture.pct,
                    ack: true
                });
            }
        }
    },
    /**
     * Bodenfeuchte (soilMoisture) setzen auf: => pct = 100%; val = maxIrrigation
     * @param {number} mySprinkleID - ID des Bewässerungskreis
     */
    setSoilMoistPct100: (mySprinkleID) => {
        if (adapter.config.debug) {
            adapter.log.info('#1.2 Set ID: '+ myConfig.config[mySprinkleID].objectName + ' setSoilMoistPct100 = 100%');
        }
        myConfig.config[mySprinkleID].soilMoisture.val = myConfig.config[mySprinkleID].soilMoisture.maxIrrigation;
        myConfig.config[mySprinkleID].soilMoisture.pct = 100;
        adapter.setState('sprinkle.' + myConfig.config[mySprinkleID].objectName + '.actualSoilMoisture', {
            val: myConfig.config[mySprinkleID].soilMoisture.pct,
            ack: true
        });
    },
    /**
     * Bodenfeuchte (soilMoisture) erhöhen bis maxRain
     * @param {number} mySprinkleID - ID des Bewässerungskreis
     * @param {number} addVal - soilMoisture.val wird um den Wert addVal erhöht
     */
    addSoilMoistVal: (mySprinkleID, addVal) => {
        if (adapter.config.debug) {
            adapter.log.info('#1.3 Set ID: '+ myConfig.config[mySprinkleID].objectName + ' addVal: (' + addVal + ')');
        }
        myConfig.config[mySprinkleID].soilMoisture.val += addVal;
        if (myConfig.config[mySprinkleID].soilMoisture.val > myConfig.config[mySprinkleID].soilMoisture.maxRain) {myConfig.config[mySprinkleID].soilMoisture.val = myConfig.config[mySprinkleID].soilMoisture.maxRain}
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
     * @param {boolean} requestState - neuer Wert des Sprinkler Ventils
     */
    setValveTimerID: (mySprinkleID, requestState) => {
        myConfig.config[mySprinkleID].objectState = requestState;
        // Wenn das Ventil seinen zustand ändert so wird der Timer + Meldung gelöscht
        myConfig.config[mySprinkleID].updateStateTimerID = setTimeout (() => {
            sendMessageText.sendMessage('Error: Ventil hat nicht geschaltet: ' + myConfig.config[mySprinkleID].objectName + ' (' + requestState + ')');
            adapter.log.warn('#1.4 Achtung ID: ' + myConfig.config[mySprinkleID].objectName + ' not switched to: '  + requestState);
        }, 1000);
    },
    /**
     * clearTimeout der Fehlermeldung eines schaltenden Ventils
     * @param {number} mySprinkleID - ID des Bewässerungskreis
     * @param {boolean} confirmState - neuer Wert des Sprinkler Ventils
     */
    delValveTimerID: (mySprinkleID, confirmState) => {
        if ((myConfig.config[mySprinkleID].objectState === confirmState) && myConfig.config[mySprinkleID].updateStateTimerID) {
            clearTimeout(myConfig.config[mySprinkleID].updateStateTimerID);
        }
    }
};

module.exports = myConfig;