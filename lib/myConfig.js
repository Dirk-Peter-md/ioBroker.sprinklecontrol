'use strict';

/*
 info:  log aufbau myConfig.js: #1.*
 */
const trend = require('./tools').trend;// tools => laden von Hilfsfunktionen

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;

/**
 * Ermittlung der Bewässerungsmethode und der dazugehörigen Parameter
 * Sensorabfrage für Bodenfeuchte-Sensoren beantragen (subscribeStates)
 * @param   {Object}        res - Objekt mit den Ventildaten aus der Config
 *  @param  {string}        res.methodControlSM             - methodControlSM [Auswahlfeld in der Config]
 *  @param  {string}        res.triggerSM                   - triggerSM [Bodenfeuchte-Sensor in der Config]
 *  @param  {string}        res.analogZPct                  - analog Zero Percent [Auswahlfeld in der Config des Sprinklers > Bodenfeuchte-Sensor > analog > Wert bei 0 %]
 *  @param  {string}        res.analogOHPct                 - analog One Hundert Percent [Auswahlfeld in der Config des Sprinklers > Bodenfeuchte-Sensor > analog > Wert bei 100 %]
 *  @param  {string}        res.maxSoilMoistureIrrigation   - maximale Bodenfeuchte nach der Bewässerung [Auswahlfeld in der Config des Sprinklers]
 *  @param  {string}        res.startDay                    - Auswahl (threeRd = Start im 3 Tages Rhythmus,twoNd = Start im 2 Tages Rhythmus, fixDay = Start an festen Tagen Sun-Sat)
 *  @param  {boolean}       res.sun                         - Sontag, Sunday (Sun)
 *  @param  {boolean}       res.mon                         - Montag, Monday (Mon)
 *  @param  {boolean}       res.tue                         - Dienstag, Tuesday (Tue) (Tues)
 *  @param  {boolean}       res.wed                         - Mittwoch, Wednesday (Wed)
 *  @param  {boolean}       res.thur                        - Donnerstag, Thursday (Thur) (Thurs)
 *  @param  {boolean}       res.fri                         - Freitag, Friday (Fri)
 *  @param  {boolean}       res.sat                         - Samstag, Saturday (Sat)
 *  @param  {string}        objectName                      - zur StableVersion löschen
 * @returns {{setMetConSM: string, setPct: (number|null), setStartDay: (string|null), setStartFixDay: (Array|null) setAnalogZPct: (number|null), setAnalogOHPct: (number|null), setTrigSM: (string|null), setVal: (number|null)}}
 */
function getMetConSM(res, objectName) {

    if (res.methodControlSM === 'bistable' && res.triggerSM.length > 5) {
        // bistable (Bodenfeuchte-Sensor)
        adapter.subscribeForeignStates(res.triggerSM);
        return {
            setStartDay: null,
            setStartFixDay: null,
            setMetConSM: 'bistable',
            setTrigSM: res.triggerSM,
            setAnalogZPct: null,
            setAnalogOHPct: null,
            setPct: 50,
            setVal: null
        };


    } else if (res.methodControlSM === 'analog' && res.triggerSM.length > 5) {
        // analog (Bodenfeuchte-Sensor)
        adapter.subscribeForeignStates(res.triggerSM);
        return {
            setStartDay: null,
            setStartFixDay: null,
            setMetConSM: 'analog',
            setTrigSM: res.triggerSM,
            setAnalogZPct: parseFloat(res.analogZPct),
            setAnalogOHPct: parseFloat(res.analogOHPct),
            setPct: 50,
            setVal: null
        };
    } else if (res.methodControlSM === 'fixDay') {
        // start zur festen Zeit und Wochentag (ohne-Sensoren)
        /**
         * Wochentage an denen gestartet wird
         * @type {boolean[]}
         */
        const startFixDay = [false, false, false, false, false, false, false]; // Sun, Mon, Tue, Wed, Thur, Fri, Sat

        if(res.startDay === 'threeRd' || res.startDay === 'twoNd') {
            /** @type {number} */
            let today = formatTime(adapter,'', 'day');
            /** @type {number} */
            let nextStartDay = ((today + 1) > 6) ? 0 : (today + 1);
            startFixDay[nextStartDay] = true; // Start am nächsten Tag
        } else if (res.startDay === 'fixDay') {
            startFixDay[0] = res.sun;
            startFixDay[1] = res.mon;
            startFixDay[2] = res.tue;
            startFixDay[3] = res.wed;
            startFixDay[4] = res.thur;
            startFixDay[5] = res.fri;
            startFixDay[6] = res.sat;
        }
        return {
            setStartDay: res.startDay,
            setStartFixDay: startFixDay,
            setMetConSM: 'fixDay',
            setTrigSM: '',
            setAnalogZPct: null,
            setAnalogOHPct: null,
            setPct: null,
            setVal: null
        };
    } else {
        // interne (Berechnung der Verdunstung)
        return {
            setStartDay: null,
            setStartFixDay: null,
            setMetConSM: 'calculation',
            setTrigSM: '',
            setAnalogZPct: null,
            setAnalogOHPct: null,
            setPct: 50,
            setVal: parseFloat(res.maxSoilMoistureIrrigation) / 2
        };
    }
}

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
                /** Name des Bewässerungskreises
                 *  @type {string}
                 */
                const objectName = res.sprinkleName.replace(/[.;, ]/g, '_');
                const metConSM = getMetConSM(res, objectName);
                const newEntry = {
                    /** Starttage in der Woche
                     * - 0(Sun); 1(Mon); 2(Tue); 3(Wed); 4(Thur); 5(Fri); 6(Sat)
                     * @type {Array.<boolean>} startFixDay */
                    startFixDay: metConSM.setStartFixDay, // Sontag, Sunday (Sun)// Montag, Monday (Mon)// Dienstag, Tuesday (Tue) (Tues)// Mittwoch, Wednesday (Wed)// Donnerstag, Thursday (Thur) (Thurs)// Freitag, Friday (Fri)// Samstag, Saturday (Sat)
                    /** - Auswahl:
                     * - threeRd = Start im 3 Tages Rhythmus,
                     * - twoNd = Start im 2 Tages Rhythmus
                     * - fixDay = Start an festen Tagen Sun-Sat
                     *  @type {string}  */ startDay: metConSM.setStartDay,
                    /** @type {boolean} */ enabled: res.enabled || false,
                    /** @type {boolean} */ booster: res.booster,
                    /** @type {number}  */ endIrrigation: res.endIrrigation,
                    /** @type {boolean} */ autoOn: true,
                    /** @type {string}  */ autoOnID: adapter.namespace + '.sprinkle.' + objectName + '.autoOn',		// sprinklecontrol.0.sprinkle.Rasenumrandung.autoOnID
                    /** @type {string}  */ objectName: objectName,		                                            // z.B. Rasenumrandung
                    /** @type {string}  */ objectID: adapter.namespace + '.sprinkle.' + objectName + '.runningTime',	// sprinklecontrol.0.sprinkle.Rasenumrandung.runningTime
                    /** @type {string}  */ idState: res.name,                                                         // "hm-rpc.0.MEQ1234567.3.STATE"
                    /** @type {any}     */ updateStateTimerID: null,                                                  // Timer wird gelöscht wenn Rückmeldung erfolgte
                    /** @type {number}  */ sprinkleID: myConfig.config.length,		                                // Array[0...]
                    /** @type {number}  */ wateringTime: parseInt(res.wateringTime),		                            // ...min
                    /** @type {number}  */ wateringAdd: parseInt(res.wateringAdd),		                            // 0 ... 200%
                    /** @type {number}  */ wateringInterval: ((60 * parseInt(res.wateringInterval)) || 0),		    // 5,10,15min
                    /** @type {number}  */ pipeFlow: parseInt(res.pipeFlow),                                          // Wasserverbrauch des sprinkler-Kreises
                    /** @type {string}  */ methodControlSM: metConSM.setMetConSM,                                     // Art der Kontrolle der Bodenfeuchte ('calculation'; 'bistable'; 'analog')
                    /** @type {string}  */ triggerSM: metConSM.setTrigSM,                                             // Sensor für die Bodenfeuchte
                    /** @type {boolean} */ inGreenhouse: res.inGreenhouse || false,                                    // keine Wettervorhersage verwenden (Gewächshaus)
                    /** @type {number}  */ analogZPct: metConSM.setAnalogZPct,                                        // analoger Sensor Wert bei 0% (analog zero percent)
                    /** @type {number}  */ analogOHPct: metConSM.setAnalogOHPct,                                      // analoger Sensor Wert bei 100% (analog one hundert percent)
                    'soilMoisture': {
                        /** @type {number} */ val: metConSM.setVal,                                                     // Bodenfeuchte / Wassergehalt der oberen Bodenschicht (zB. 5 mm == 50%)
                        /** @type {number} */ pct: metConSM.setPct,                                                     // Bodenfeuchte in % zB. 50% = maxSoilMoistureIrrigation) / 2
                        /** @type {number} */ min: parseFloat(res.maxSoilMoistureIrrigation) / 100,                     // (zB. 0,02 mm)
                        /** @type {number} */ maxIrrigation: parseFloat(res.maxSoilMoistureIrrigation),                 // (zB. 10 mm)
                        /** @type {number} */ maxRain: parseFloat(res.maxSoilMoistureRain),                             // (zB. 12 mm)
                        /** @type {number} */ triggersIrrigation: parseFloat(res.maxSoilMoistureIrrigation) * parseInt(res.triggersIrrigation) / 100,           // (zB. 50 % ==> 5 mm)
                        /** @type {number} */ pctTriggerIrrigation: parseFloat(res.triggersIrrigation),                 // Auslöser der Bewässerung in % (zB. 50%)
                    }
                };
                myConfig.config.push(newEntry);

                if (newEntry.enabled) {
                    // Report a change in the status of the trigger IDs (.runningTime; .name) => Melden einer Änderung des Status der Trigger-IDs
                    adapter.subscribeStates(newEntry.objectID);	// abonnieren der Statusänderungen des Objekts (reagieren auf 'runningTime' der einzelnen Bewässerungskreise)
                    adapter.subscribeStates(newEntry.autoOnID); // abonnieren der Statusänderungen des Objekts (reagieren auf 'autoOn' der einzelnen Bewässerungskreise)
                    // adapter.subscribeForeignStates(newEntry.idState); // abonnieren der Statusänderungen des Objekts (reagiert auf Änderung des 'Ventils' der einzelnen Bewässerungskreise zur Fehlerkontrolle bzw. Verbrauchsermittlung)
                }
                //if (adapter.config.debug) {
                    adapter.log.info('#1.0 => Set ID: ' + objectName + '(' + newEntry.sprinkleID + ') hinzugefügt - ' + JSON.stringify(myConfig.config[newEntry.sprinkleID]));
                //}
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
                if (entry.methodControlSM === 'calculation') {
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
     *
     * @param {number} mySprinkleID - ID des Bewässerungskreis
     * @param {string|number|boolean} newVal - neuer Wert vom Bodenfeuchte-Sensor
     */
    setSoilMoistPct: (mySprinkleID, newVal) => {
        if (myConfig.config[mySprinkleID]) {
            // bistabil (Bodenfeuchte-Sensor)
            if (myConfig.config[mySprinkleID].methodControlSM === 'bistable') {
                adapter.log.info('setSoilMoistPct, ' + myConfig.config[mySprinkleID].objectName + ' => bistable, newVal: ' + newVal);
                if (typeof newVal === "boolean") {
                    myConfig.config[mySprinkleID].soilMoisture.pct = newVal ? 0 : 100;
                    adapter.setState('sprinkle.' + [myConfig.config[mySprinkleID].objectName] + '.actualSoilMoisture', {
                        val: myConfig.config[mySprinkleID].soilMoisture.pct,
                        ack: true
                    });
                    adapter.log.info('setSoilMoistPct - bistable: ' + myConfig.config[mySprinkleID].objectName + ' .pst: ' + myConfig.config[mySprinkleID].soilMoisture.pct);
                } else {
                    adapter.log.warn('The ' + myConfig.config[mySprinkleID].objectName + ' soil moisture sensor does not provide a Boolean signal');
                }

            // analog (Bodenfeuchte-Sensor)
            } else if (myConfig.config[mySprinkleID].methodControlSM === 'analog') {
                adapter.log.info('setSoilMoistPct, ' + myConfig.config[mySprinkleID].objectName + ' => analog, newVal: ' + newVal);
                if (typeof parseFloat(newVal) === 'number') {
                    let myVal;
                    newVal = parseFloat(newVal);
                    if (newVal < myConfig.config[mySprinkleID].analogZPct) {
                        myVal = myConfig.config[mySprinkleID].analogZPct;
                        adapter.log.warn(myConfig.config[mySprinkleID].objectName + ': analog soil moisture sensor at 0 % => The value range was undercut');
                    } else if (newVal > myConfig.config[mySprinkleID].analogOHPct) {
                        myVal = myConfig.config[mySprinkleID].analogOHPct;
                        adapter.log.warn(myConfig.config[mySprinkleID].objectName + ': analog soil moisture sensor at 100 % => The range of values has been exceeded');
                    } else {
                        myVal = newVal;
                    }
                    myConfig.config[mySprinkleID].soilMoisture.pct = (trend(myConfig.config[mySprinkleID].analogZPct, myConfig.config[mySprinkleID].analogOHPct, 0, 100, myVal));
                    adapter.setState('sprinkle.' + [myConfig.config[mySprinkleID].objectName] + '.actualSoilMoisture', {
                        val: Math.round(10 *  myConfig.config[mySprinkleID].soilMoisture.pct) / 10,
                        ack: true
                    });
                    adapter.log.info('setSoilMoistPct - analog: ' + myConfig.config[mySprinkleID].objectName + ' .pst: ' + myConfig.config[mySprinkleID].soilMoisture.pct);
                } else {
                    adapter.log.warn('The ' + myConfig.config[mySprinkleID].objectName + ' soil moisture sensor does not provide a Number signal');
                }
            } else {
                adapter.log.warn('Please check the signals and settings of the ' + myConfig.config[mySprinkleID].objectName + ' soil moisture sensor');
            }
        }
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
    }
};

module.exports = myConfig;