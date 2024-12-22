'use strict';

/*
 info:  log aufbau myConfig.js: #1.*
 */
const {formatTime} = require('./tools');
const trend = require('./tools').trend;     // tools => laden von Hilfsfunktionen
// const formatTime = require('./tools').formatTime;   // tools => laden von Hilfsfunktionen

let adapter;

//**
// * Ermittlung der Bewässerungsmethode und der dazugehörigen Parameter
// * Sensorabfrage für Bodenfeuchte-Sensoren beantragen (subscribeStates)
// * 
// * @param   {object}        res                         - Objekt mit den Ventildaten aus der Config
// *  @param  {string}        res.methodControlSM             - methodControlSM [Auswahlfeld in der Config].
// *  @param  {string}        res.triggerSM                   - triggerSM [Bodenfeuchte-Sensor in der Config].
// *  @param  {string}        res.analogZPct                  - analog Zero Percent [Auswahlfeld in der Config des Sprinklers > Bodenfeuchte-Sensor > analog > Wert bei 0 %].
// *  @param  {string}        res.analogOHPct                 - analog One Hundert Percent [Auswahlfeld in der Config des Sprinklers > Bodenfeuchte-Sensor > analog > Wert bei 100 %].
// *  @param  {string}        res.maxSoilMoistureIrrigation   - maximale Bodenfeuchte nach der Bewässerung [Auswahlfeld in der Config des Sprinklers].
// *  @param  {string}        res.startDay                    - Auswahl (threeRd = Start im 3-Tages-Rhythmus,twoNd = Start im 2-Tages-Rhythmus, fixDay = Start an festen Tagen Sun-Sat).
// *  @param  {boolean}       res.sun                         - Sontag, Sunday (Sun).
// *  @param  {boolean}       res.mon                         - Montag, Monday (Mon).
// *  @param  {boolean}       res.tue                         - Dienstag, Tuesday (Tue) (Tues).
// *  @param  {boolean}       res.wed                         - Mittwoch, Wednesday (Wed).
// *  @param  {boolean}       res.thur                        - Donnerstag, Thursday (Thur) (Thurs).
// *  @param  {boolean}       res.fri                         - Freitag, Friday (Fri).
// *  @param  {boolean}       res.sat                         - Samstag, Saturday (Sat).
// * @returns {{setMetConSM: string, setPct: (number|null), setStartDay: (string|null), setStartFixDay: boolean[]|null, setAnalogZPct: (number|null), setAnalogOHPct: (number|null), setTrigSM: (string|null), setVal: (number|null), setBool: (boolean|null)}}
// */
function getMetConSM(res) {

    if (res.methodControlSM === 'bistable') {
        // bistable (Bodenfeuchte-Sensor)
        adapter.subscribeForeignStates(res.triggerSM);
        return {
            setStartDay: null,
            setStartFixDay: null,
            setMetConSM: 'bistable',
            setTrigSM: res.triggerSM,
            setAnalogZPct: null,
            setAnalogOHPct: null,
            setPct: null,
            setVal: null,
            setBool: null
        };


    } else if (res.methodControlSM === 'analog') {
        // analog (Bodenfeuchte-Sensor)
        adapter.subscribeForeignStates(res.triggerSM);
        return {
            setStartDay: null,
            setStartFixDay: null,
            setMetConSM: 'analog',
            setTrigSM: res.triggerSM,
            setAnalogZPct: parseFloat(res.analogZPct),
            setAnalogOHPct: parseFloat(res.analogOHPct),
            setPct: null,
            setVal: null,
            setBool: null
        };
    } else if (res.methodControlSM === 'fixDay') {
        // start zur festen Zeit und Wochentag (ohne-Sensoren)
        /**
         * Wochentage an denen gestartet wird
         *
         */
        const startFixDay = [false, false, false, false, false, false, false]; // Sun, Mon, Tue, Wed, Thur, Fri, Sat

        if(res.startDay === 'threeRd' || res.startDay === 'twoNd') {
            //let today = formatTime(adapter,'', 'day');
            //let nextStartDay = ((today + 1) > 6) ? 0 : (today + 1);
            //startFixDay[nextStartDay] = true; // Start am nächsten Tag
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
            setVal: null,
            setBool: null
        };
    } else if (res.methodControlSM === 'calculation') {
        // interne (Berechnung der Verdunstung)
        return {
            setStartDay: null,
            setStartFixDay: null,
            setMetConSM: 'calculation',
            setTrigSM: '',
            setAnalogZPct: null,
            setAnalogOHPct: null,
            setPct: 50,
            setVal: parseFloat(res.maxSoilMoistureIrrigation) / 2,
            setBool: null
        };
    } else {
        adapter.log.warn('Emergency program! No irrigation type is selected in the SprinkleControl configuration! Please adjust.');
        return {
            setStartDay: 'twoNd',
            setStartFixDay: [false, false, false, false, false, false, false], // Sun, Mon, Tue, Wed, Thur, Fri, Sat
            setMetConSM: 'fixDay',
            setTrigSM: '',
            setAnalogZPct: null,
            setAnalogOHPct: null,
            setPct: null,
            setVal: null,
            setBool: null
        };
    }
}

const myConfig = {
    /**@type {object} */
    config: [],
    /**
     *
     * @param myAdapter - Kopie von Adapter main.js
     */
    createConfig: (myAdapter) => {
        adapter = myAdapter;
        const result = adapter.config.events;
        if (result) {
            for (const res of result) {
                /** Name des Bewässerungskreises */
                let objectName = '';
                if(res.sprinkleName !== '') {
                    objectName = res.sprinkleName.replace(/[.;, ]/g, '_');
                } else if (res.sprinkleName === '') {
                    objectName = res.name.replace(/[.;, ]/g, '_');
                }
                const metConSM = getMetConSM(res);
                const newEntry = {
                    /**
                     * Starttage in der Woche
                     * - 0(Sun); 1(Mon); 2(Tue); 3(Wed); 4(Thur); 5(Fri); 6(Sat)
                     */
                    startFixDay: metConSM.setStartFixDay, // Sontag, Sunday (Sun)// Montag, Monday (Mon)// Dienstag, Tuesday (Tue) (Tues)// Mittwoch, Wednesday (Wed)// Donnerstag, Thursday (Thur) (Thurs)// Freitag, Friday (Fri)// Samstag, Saturday (Sat)
                    /**
                     * - Auswahl:
                     * - threeRd = Start im 3 Tages Rhythmus,
                     * - twoNd = Start im 2 Tages Rhythmus
                     * - fixDay = Start an festen Tagen Sun-Sat
                     */
                    startDay: metConSM.setStartDay,
                    enabled: res.enabled || false,
                    booster: res.booster,
                    endIrrigation: res.endIrrigation,
                    autoOn: true,
                    autoOnID: `${adapter.namespace  }.sprinkle.${  objectName  }.autoOn`,                                           // sprinklecontrol.0.sprinkle.Rasenumrandung.autoOnID
                    objectName: objectName,		                                                                                    // z.B. Rasenumrandung 
                    objectID: `${adapter.namespace  }.sprinkle.${  objectName  }.runningTime`,	                                    // sprinklecontrol.0.sprinkle.Rasenumrandung.runningTime 
                    idState: res.name,                                                                                               // "hm-rpc.0.MEQ1234567.3.STATE" updateStateTimerID: null,                                                                                        // Timer wird gelöscht wenn Rückmeldung erfolgte 
                    sprinkleID: myConfig.config.length,		                                                                        // Array[0...] wateringTime: parseInt(res.wateringTime),		                                                                // ...min wateringAdd: parseInt(res.wateringAdd),		                                                                    // 0 ... 200% wateringInterval: ((60 * parseInt(res.wateringInterval)) || 0),		                                            // 5,10,15min addWateringTime: (parseInt(res.addWateringTime) || 0),                                                           // ...min Zusatzbewässerung bei hohen Temperaturen pipeFlow: parseInt(res.pipeFlow),                                                                                // Wasserverbrauch des sprinkler-Kreises methodControlSM: metConSM.setMetConSM,                                                                           // Art der Kontrolle der Bodenfeuchte ('calculation'; 'bistable'; 'analog'; fixDay) 
                    triggerSM: metConSM.setTrigSM,                                                                                   // Sensor für die Bodenfeuchte
                    inGreenhouse: res.inGreenhouse || false,                                                                         // keine Wettervorhersage verwenden (Gewächshaus) 
                    analogZPct: metConSM.setAnalogZPct,                                                                              // analoger Sensor Wert bei 0% (analog zero percent) 
                    analogOHPct: metConSM.setAnalogOHPct,                                                                            // analoger Sensor Wert bei 100% (analog one hundert percent)
                    soilMoisture: { 
                        val: metConSM.setVal,                                                                                         // Bodenfeuchte / Wassergehalt der oberen Bodenschicht (zB. 5 mm == 50%) 
                        pct: metConSM.setPct,                                                                                         // Bodenfeuchte in % zB. 50% = maxSoilMoistureIrrigation) / 2 
                        bool: metConSM.setBool,                                                                                      // Bodenfeuchtezustand trocken/feucht === true/false min: parseFloat(res.maxSoilMoistureIrrigation) / 100,                                                         // (zB. 0,02 mm) maxIrrigation: parseFloat(res.maxSoilMoistureIrrigation),                                                     // (zB. 10 mm) maxRain: parseFloat(res.maxSoilMoistureIrrigation) /100 * (parseFloat(res.maxSoilMoistureRainPct) || 120),            // (zB. 12 mm) triggersIrrigation: parseFloat(res.maxSoilMoistureIrrigation) * parseInt(res.triggersIrrigation) / 100,       // (zB. 50 % ==> 5 mm) pctTriggerIrrigation: parseFloat(res.triggersIrrigation),                                                     // Auslöser der Bewässerung in % (zB. 50%) pctAddTriggersIrrigation: (parseFloat(res.addTriggersIrrigation) < parseFloat(res.triggersIrrigation)) ? parseFloat(res.addTriggersIrrigation) : parseFloat(res.triggersIrrigation)
                    }
                };
                myConfig.config.push(newEntry);

                if (newEntry.enabled) {
                    // Report a change in the status of the trigger IDs (.runningTime; .name) => Melden einer Änderung des Status der Trigger-IDs
                    adapter.subscribeStates(newEntry.objectID);	// abonnieren der Statusänderungen des Objekts (reagieren auf 'runningTime' der einzelnen Bewässerungskreise)
                    adapter.subscribeStates(newEntry.autoOnID); // abonnieren der Statusänderungen des Objekts (reagieren auf 'autoOn' der einzelnen Bewässerungskreise)
                    // adapter.subscribeForeignStates(newEntry.idState); // abonnieren der Statusänderungen des Objekts (reagiert auf Änderung des 'Ventils' der einzelnen Bewässerungskreise zur Fehlerkontrolle bzw. Verbrauchsermittlung)
                }
                adapter.log.debug(`Config ${objectName} created (${newEntry.sprinkleID}) - ${JSON.stringify(myConfig.config[newEntry.sprinkleID])}`);
            }
        }
    },
    /**
     * apply Evaporation
     * → Verdunstung anwenden auf die einzelnen Sprenger kreise
     *
     * @param eTP - pot. Evapotranspiration nach Penman ETp in mm/d
     */
    applyEvaporation: (eTP) => {
        if (myConfig.config) {
            for(const entry of myConfig.config) {
                if (entry.methodControlSM === 'calculation'
                    && !(entry.inGreenhouse && (eTP < 0))) {    // nicht anwenden im Gewächshaus und Regen
                    const objectName = entry.objectName;
                    const pfadActSoiMoi = `sprinkle.${  objectName  }.actualSoilMoisture`;

                    entry.soilMoisture.val -= eTP;		// Abfrage => entry.soilMoisture.val
                    if (entry.soilMoisture.val < entry.soilMoisture.min) {
                        entry.soilMoisture.val = entry.soilMoisture.min;
                    } else if (entry.soilMoisture.val > entry.soilMoisture.maxRain) {
                        entry.soilMoisture.val = entry.soilMoisture.maxRain;
                    }
                    entry.soilMoisture.pct = Math.round(1000 * entry.soilMoisture.val / entry.soilMoisture.maxIrrigation) / 10;	// Berechnung in %
                    adapter.log.debug(`apply Evaporation: ${objectName} => soilMoisture: ${entry.soilMoisture.val} soilMoisture: ${entry.soilMoisture.pct} %`);
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
     *
     * @param mySprinkleID - ID des Bewässerungskreises
     */
    setSoilMoistPct100: (mySprinkleID) => {
        myConfig.config[mySprinkleID].soilMoisture.val = myConfig.config[mySprinkleID].soilMoisture.maxIrrigation;
        myConfig.config[mySprinkleID].soilMoisture.pct = 100;
        adapter.setState(`sprinkle.${  myConfig.config[mySprinkleID].objectName  }.actualSoilMoisture`, {
            val: myConfig.config[mySprinkleID].soilMoisture.pct,
            ack: true
        });
    },
    /**
     * Speichern der Bodenfeuchtigkeit = bistabil (Bodenfeuchte-Sensor)
     *
     * @param mySprinkleID - ID des Bewässerungskreis
     * @param newVal - neuer Wert vom Bodenfeuchte-Sensor
     */
    setSoilMoistBool: (mySprinkleID, newVal) => {
        if (myConfig.config[mySprinkleID].methodControlSM === 'bistable') {
            if (typeof newVal === 'boolean') {
                myConfig.config[mySprinkleID].soilMoisture.bool = newVal;
                adapter.setState(`sprinkle.${  [myConfig.config[mySprinkleID].objectName]  }.actualSoilMoisture`, {
                    val: myConfig.config[mySprinkleID].soilMoisture.bool,
                    ack: true
                });
            } else {
                adapter.log.warn(`The ${myConfig.config[mySprinkleID].objectName} soil moisture sensor does not provide a Boolean signal`);
            }
        } else {
            adapter.log.warn(`Please check the signals and settings of the ${myConfig.config[mySprinkleID].objectName} soil moisture sensor`);
        }
    },
    /**
     * Speichern der Bodenfeuchtigkeit = analog (Bodenfeuchte-Sensor)
     *
     * @param mySprinkleID - ID des Bewässerungskreis
     * @param newVal - neuer Wert vom Bodenfeuchte-Sensor
     */
    setSoilMoistPct: (mySprinkleID, newVal) => {
        if (myConfig.config[mySprinkleID].methodControlSM === 'analog') {
            if (typeof parseFloat(newVal) === 'number') {
                /**aktueller Wert des Bodenfeuchte-Sensor
                 * @type {number} myVal
                 */
                let myVal;
                /**Reversible Eingang des Bodenfeuchte sensors
                 * @type {boolean} reverse -Eingang analogOHPct < analogZPct
                 *
                 */
                const reverse = (myConfig.config[mySprinkleID].analogOHPct < myConfig.config[mySprinkleID].analogZPct);
                if (myConfig.config[mySprinkleID].analogOHPct === myConfig.config[mySprinkleID].analogZPct) {
                    adapter.log.warn(`${myConfig.config[mySprinkleID].objectName}: analog soil moisture sensor at 0% and at 100% => the values are the same`);
                }
                newVal = parseFloat(newVal);

                if ((!reverse && newVal < myConfig.config[mySprinkleID].analogZPct)
                    || (reverse && myConfig.config[mySprinkleID].analogZPct < newVal)) {
                    myVal = myConfig.config[mySprinkleID].analogZPct;
                    adapter.log.warn(`${myConfig.config[mySprinkleID].objectName} (${newVal}): analog soil moisture sensor at 0 % => ${reverse ? 'The range of values has been exceeded (reverse)' : 'The value range was undercut'}`);
                } else if ((!reverse && newVal > myConfig.config[mySprinkleID].analogOHPct)
                    || (reverse && myConfig.config[mySprinkleID].analogOHPct > newVal)) {
                    myVal = myConfig.config[mySprinkleID].analogOHPct;
                    adapter.log.warn(`${myConfig.config[mySprinkleID].objectName} (${newVal}): analog soil moisture sensor at 100 % => ${reverse ? 'The value range was undercut (reverse)' : 'The range of values has been exceeded'}`);
                } else {
                    myVal = newVal;
                }

                myConfig.config[mySprinkleID].soilMoisture.pct = Math.round(10 * trend(myConfig.config[mySprinkleID].analogZPct, myConfig.config[mySprinkleID].analogOHPct, 0, 100, myVal)) / 10;
                adapter.setState(`sprinkle.${  [myConfig.config[mySprinkleID].objectName]  }.actualSoilMoisture`, {
                    val: myConfig.config[mySprinkleID].soilMoisture.pct,
                    ack: true
                });
            } else {
                adapter.log.warn(`The ${myConfig.config[mySprinkleID].objectName} soil moisture sensor does not provide a Number signal`);
            }
        } else {
            adapter.log.warn(`Please check the signals and settings of the ${myConfig.config[mySprinkleID].objectName} soil moisture sensor`);
        }
    },
    /**
     * Bodenfeuchte (soilMoisture) erhöhen bis maxIrrigation (100%)
     *
     * @param mySprinkleID - ID des Bewässerungskreis
     * @param addVal - soilMoisture.val wird um den Wert addVal erhöht
     */
    addSoilMoistVal: (mySprinkleID, addVal) => {
        if (myConfig.config[mySprinkleID].soilMoisture.val < myConfig.config[mySprinkleID].soilMoisture.maxIrrigation) {
            myConfig.config[mySprinkleID].soilMoisture.val += addVal;
            if (myConfig.config[mySprinkleID].soilMoisture.val > myConfig.config[mySprinkleID].soilMoisture.maxIrrigation) {
                myConfig.config[mySprinkleID].soilMoisture.val = myConfig.config[mySprinkleID].soilMoisture.maxIrrigation;
            }
        }

        myConfig.config[mySprinkleID].soilMoisture.pct = Math.round(1000 * myConfig.config[mySprinkleID].soilMoisture.val
            / myConfig.config[mySprinkleID].soilMoisture.maxIrrigation) / 10;	// Berechnung in %
        adapter.setState(`sprinkle.${  myConfig.config[mySprinkleID].objectName  }.actualSoilMoisture`, {
            val: myConfig.config[mySprinkleID].soilMoisture.pct,
            ack: true
        });
    },
    postponeByOneDay: async (mySprinkleID) => {
        if (myConfig.config[mySprinkleID].startDay === 'threeRd' ||          // Next Start in 3 Tagen
            myConfig.config[mySprinkleID].startDay === 'twoNd') {             // Next Start in 2 Tagen
            const today = await formatTime(adapter,'', 'day');
            const id = `${adapter.namespace}.sprinkle.${myConfig.config[mySprinkleID].objectName}.actualSoilMoisture`;
            let curDay, nextDay;
            /**
             * Wert von actualSoilMoisture auslesen
             *
             */
            const _curDay = await adapter.getStateAsync(id).catch((e) => adapter.log.warn(`postponeByOneDay getStateAsync: ${e}`));
            if (_curDay) {
                curDay = ((_curDay.val >= 0) && (_curDay.val <= 6) && (typeof _curDay.val === 'number') ? _curDay.val : today);
                myConfig.config[mySprinkleID].startFixDay[curDay] = false;
                nextDay = (+ curDay + 1 > 6) ? (+ curDay-6) : (+ curDay+1);
                myConfig.config[mySprinkleID].startFixDay[nextDay] = true;
                adapter.setStateAsync(
                    `${id}`,
                    nextDay,
                    true
                ).catch((e) => adapter.log.warn(`postponeByOneDay setStateAsync: ${e}`));
            }
        }
    }
};

module.exports = myConfig;