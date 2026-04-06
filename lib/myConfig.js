/* @ts-nocheck */
'use strict';

/*
 info:  log aufbau myConfig.js: #1.*
 */
const trend = require('./tools').trend;     // tools => laden von Hilfsfunktionen
const formatTime = require('./tools').formatTime;   // tools => laden von Hilfsfunktionen
const idStateControl = require('./tools').idStateControl;   // tools => laden der Hilfsfunktionen idStateControl

/**
 * The adapter instance
 */
let adapter;

const myConfig = {
    /*
     * @type {{enabled:boolean; state:{val:boolean; ack:boolean}; booster:boolean; autoOn:boolean; autoOnID:string; extBreak:boolean; extBreakID:string; objectName:string; objectID:string; idState:string; triggerSM:string;
     * updateStateTimerID:any; sprinkleID:number; wateringTime:number; wateringAdd:number; wateringIntervalOff:number; wateringIntervalOn:number; addWateringTime:number; pipeFlow:number;
     * methodControlSM:'calculation'|'bistable'|'analog'|'fixDay'; inGreenhouse:boolean;
     * calculation:{pct:number; val:number; min:number; maxIrrigation:number; maxRain:number; triggersIrrigation:number; pctTriggerIrrigation:number; pctAddTriggersIrrigation:number; endIrrigation:boolean};
     * bistable:{bool:boolean};
     * analog:{pctTriggerIrrigation:number; pctAddTriggersIrrigation:number; pct:number; analogZPct:number; analogOHPct:number};
     * fixDay:{startDay:'threeRd'|'twoNd'|'fixDay'; startFixDay:boolean[]};
     * }[] | []}
     */
    config: [],
    /**
     *
     * @param {ioBroker.Adapter} myAdapter - Kopie von Adapter main.js
     */
    createConfig: async  (myAdapter) => {
        adapter = myAdapter;
        const result = adapter.config.events;
        if (result) {
            for (const res of result) {
                /* Bewässerungskreis in der Config "enabled" aktiviert */
                if (res.enabled) {
                    /*     Name des Bewässerungskreises     */
                    const objectName = (res.sprinkleName !== '') ? res.sprinkleName.replace(/[.;, ]/g, '_') : res.name.replace(/[.;, ]/g, '_');

                    const newEntry = {
                        // Schaltzustand des Ventils
                        enabled: res.enabled || false,                                                                                              
                        booster: res.booster,
                        autoOn: true,
                        // sprinklecontrol.0.sprinkle.Rasenumrandung.autoOnID
                        autoOnID: `${ adapter.namespace }.sprinkle.${ objectName }.autoOn`,		                                                    
                        // extern break single (unterbrechung eines Kanals)
                        extBreak: false,                                                                                                            
                        // sprinklecontrol.0.sprinkle.Rasenumrandung.breakID
                        extBreakID: `${ adapter.namespace }.sprinkle.${ objectName }.extBreak`,		                                                
                        // z.B. Rasenumrandung
                        objectName: objectName,		                                                                                                
                        // sprinklecontrol.0.sprinkle.Rasenumrandung.runningTime
                        objectID: `${ adapter.namespace }.sprinkle.${ objectName }.runningTime`,	                                                     
                        // Sensor für die Bodenfeuchte
                        triggerSM: res.triggerSM,                                                                                                   
                        // Timer wird gelöscht wenn Rückmeldung erfolgte
                        updateStateTimerID: null,                                                                                                   
                        // Array[0...]
                        sprinkleID: myConfig.config.length,		                                                                                    
                        // ...min
                        wateringTime: parseInt(res.wateringTime),		                                                                            
                        // 0 ... 200%
                        wateringAdd: parseInt(res.wateringAdd),		                                                                                
                        // 5,10,15min Ausschaltzeit
                        wateringIntervalOff: ((60 * parseInt(res.wateringIntervalOff)) || 0),		                                                
                        // 5,10,15min Einschaltzeit
                        wateringIntervalOn: ((60 * parseInt(res.wateringIntervalOn)) || 0),		                                                    
                        // ...min Zusatzbewässerung bei hohen Temperaturen
                        addWateringTime: (parseInt(res.addWateringTime) || 0),                                                                      
                        // Wasserverbrauch des sprinkler-Kreises
                        pipeFlow: parseInt(res.pipeFlow),                                                                                           
                        // Art der Kontrolle der Bodenfeuchte ('calculation'; 'bistable'; 'analog'; fixDay)
                        methodControlSM: res.methodControlSM,                                                                                       
                        // keine Wettervorhersage verwenden (Gewächshaus)
                        inGreenhouse: res.inGreenhouse || false                                                                                     
                    };

                    switch (res.methodControlSM) {
                        case 'calculation': {
                            newEntry.calculation = {
                                pct: 50,                                                                                                                            // Bodenfeuchte in % zB. 50% = maxSoilMoistureIrrigation) / 2
                                val: parseFloat(res.maxSoilMoistureIrrigation) / 2,                                                                                 // Bodenfeuchte / Wassergehalt der oberen Bodenschicht (zB. 5 mm == 50%)
                                min: parseFloat(res.maxSoilMoistureIrrigation) / 100,                                                                               // (zB. 0,02 mm)
                                maxIrrigation: parseFloat(res.maxSoilMoistureIrrigation),                                                                           // (zB. 10 mm)
                                maxRain: parseFloat(res.maxSoilMoistureIrrigation) /100 * (parseFloat(res.maxSoilMoistureRainPct) || 120),    // (zB. 12 mm)
                                triggersIrrigation: parseFloat(res.maxSoilMoistureIrrigation) * parseInt(res.triggersIrrigation) / 100,                             // (zB. 50 % ==> 5 mm)
                                pctTriggerIrrigation: parseFloat(res.triggersIrrigation),                                                                           // Auslöser der Bewässerung in % (zB. 50%)
                                pctAddTriggersIrrigation: (parseFloat(res.addTriggersIrrigation) < parseFloat(res.triggersIrrigation)) ? parseFloat(res.addTriggersIrrigation) : parseFloat(res.triggersIrrigation),
                                endIrrigation: res.endIrrigation                                                                                                    // nach der Bewässerung 100%
                            };
                            break;
                        }
                        case 'bistable': {  // bistable (Bodenfeuchte-Sensor)
                        //newEntry.triggerSM = res.triggerSM;                                                                                                     // Sensor für die Bodenfeuchte
                            adapter.subscribeForeignStates(res.triggerSM);
                            newEntry.bistable = {
                                bool: false                                                                                                                         // Bodenfeuchtezustand trocken/feucht === true/false
                            };
                            break;
                        }
                        case 'analog': {
                        //newEntry.triggerSM = res.triggerSM;                                                                                                     // Sensor für die Bodenfeuchte
                            adapter.subscribeForeignStates(res.triggerSM);
                            newEntry.analog = {
                                pctTriggerIrrigation: parseFloat(res.triggersIrrigation),   // Schaltpunkt Bodenfeuchte (30%...80%)
                                pctAddTriggersIrrigation: (parseFloat(res.addTriggersIrrigation) < parseFloat(res.triggersIrrigation)) ? parseFloat(res.addTriggersIrrigation) : parseFloat(res.triggersIrrigation),
                                pct: 0,                                                     // Bodenfeuchte vom Sensor in %
                                analogZPct: parseFloat(res.analogZPct),                     // analoger Sensor Wert bei 0% (analog zero percent)
                                analogOHPct: parseFloat(res.analogOHPct)                    // analoger Sensor Wert bei 100% (analog one hundert percent)
                            };
                            break;
                        }
                        case 'fixDay': {
                            const startFixDay = [false, false, false, false, false, false, false]; // Sun, Mon, Tue, Wed, Thur, Fri, Sat
                            if (res.startDay === 'fixDay') {
                                startFixDay[0] = res.sun;
                                startFixDay[1] = res.mon;
                                startFixDay[2] = res.tue;
                                startFixDay[3] = res.wed;
                                startFixDay[4] = res.thur;
                                startFixDay[5] = res.fri;
                                startFixDay[6] = res.sat;
                            }
                            newEntry.fixDay = {
                                startDay: res.startDay,                                     // Auswahl (threeRd = Start im 3-Tages-Rhythmus,twoNd = Start im 2-Tages-Rhythmus, fixDay = Start an festen Tagen Sun-Sat)
                                startFixDay: startFixDay                                    // Sontag, Sunday (Sun)// Montag, Monday (Mon)// Dienstag, Tuesday (Tue) (Tues)// Mittwoch, Wednesday (Wed)// Donnerstag, Thursday (Thur) (Thurs)// Freitag, Friday (Fri)// Samstag, Saturday (Sat)
                            };
                            break;
                        }
                        default: {adapter.log.error(`No watering type was selected in the "${objectName}" watering circuit.`);}
                    }

                    // abonnieren der Statusänderungen des Objekts (reagiert auf Änderung des 'Ventils' der einzelnen Bewässerungskreise zur Fehlerkontrolle bzw. Verbrauchsermittlung)
                    newEntry.control = await idStateControl(adapter, res.name);

                    /* Abonnieren der Statusänderungen des Objekts (reagieren auf Änderung des 'Ventils' 
                    der einzelnen Bewässerungskreise zur Fehlerkontrolle bzw. Verbrauchsermittlung) */
                    adapter.subscribeForeignStates(newEntry.control.idACK);

                    // @ts-ignore
                    myConfig.config.push(newEntry);

                    if (newEntry.enabled) {
                    // Report a change in the status of the trigger IDs (.runningTime; .name) => Melden einer Änderung des Status der Trigger-IDs
                        adapter.subscribeStates(newEntry.objectID);	// abonnieren der Statusänderungen des Objekts (reagieren auf 'runningTime' der einzelnen Bewässerungskreise)
                        adapter.subscribeStates(newEntry.autoOnID); // abonnieren der Statusänderungen des Objekts (reagieren auf 'autoOn' der einzelnen Bewässerungskreise)
                        adapter.subscribeStates(newEntry.extBreakID); // abonnieren der Statusänderungen des Objekts (reagieren auf 'autoOn' der einzelnen Bewässerungskreise) 
                    }
                    adapter.log.debug(`Config ${objectName} created (${newEntry.sprinkleID}) - ${JSON.stringify(myConfig.config[newEntry.sprinkleID])}`);
                }
            }

        }
    },
    /**
     * apply Evaporation
     * → Verdunstung anwenden auf die einzelnen Sprenger kreise
     * 
     * @param {number} eTP - pot. Evapotranspiration nach Penman ETp in mm/d
     */
    applyEvaporation: async (eTP) => {
        if (myConfig.config) {
            for(const entry of myConfig.config) {
                if (entry.methodControlSM === 'calculation'
                    && !(entry.inGreenhouse && (eTP < 0))) {    // nicht anwenden im Gewächshaus und Regen
                    const objectName = entry.objectName;
                    const pfadActSoiMoi = `sprinkle.${ objectName }.actualSoilMoisture`;

                    entry.calculation.val -= eTP;		// Abfrage => entry.calculation.val
                    if (entry.calculation.val < entry.calculation.min) {
                        entry.calculation.val = entry.calculation.min;
                    } else if (entry.calculation.val > entry.calculation.maxRain) {
                        entry.calculation.val = entry.calculation.maxRain;
                    }
                    entry.calculation.pct = Math.round(1000 * entry.calculation.val / entry.calculation.maxIrrigation) / 10;	// Berechnung in %
                    adapter.log.debug(`apply Evaporation: ${objectName} => soilMoisture: ${entry.calculation.val} soilMoisture: ${entry.calculation.pct} %`);
                    adapter.setState(pfadActSoiMoi, {
                        val: entry.calculation.pct,
                        ack: true
                    });
                }
            }
        }
    },
    /**
     * Bodenfeuchte (soilMoisture) setzen auf: => pct = 100%; val = maxIrrigation
     * 
     * @param {number} mySprinkleID - ID des Bewässerungskreises
     */
    setSoilMoistPct100: async (mySprinkleID) => {
        myConfig.config[mySprinkleID].calculation.val = myConfig.config[mySprinkleID].calculation.maxIrrigation;
        myConfig.config[mySprinkleID].calculation.pct = 100;
        adapter.setState(`sprinkle.${ myConfig.config[mySprinkleID].objectName }.actualSoilMoisture`, {
            val: myConfig.config[mySprinkleID].calculation.pct,
            ack: true
        });
    },
    /**
     * Speichern der Bodenfeuchtigkeit = bistabil (Bodenfeuchte-Sensor)
     * 
     * @param {number} mySprinkleID - ID des Bewässerungskreis
     * @param {boolean} newVal - neuer Wert vom Bodenfeuchte-Sensor
     */
    setSoilMoistBool: async (mySprinkleID, newVal) => {
        if (myConfig.config[mySprinkleID].methodControlSM === 'bistable') {
            if (typeof newVal === 'boolean') {
                myConfig.config[mySprinkleID].bistable.bool = newVal;
                adapter.setState(`sprinkle.${ [myConfig.config[mySprinkleID].objectName] }.actualSoilMoisture`, {
                    val: myConfig.config[mySprinkleID].bistable.bool,
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
     * @param {number} mySprinkleID - ID des Bewässerungskreis
     * @param {string|number} newVal - neuer Wert vom Bodenfeuchte-Sensor
     */
    setSoilMoistPct: async (mySprinkleID, newVal) => {
        if (typeof newVal === 'string') {
            newVal = parseFloat(newVal);
        }
        if (myConfig.config[mySprinkleID].methodControlSM === 'analog') {
            if (typeof newVal === 'number') {
                /**aktueller Wert des Bodenfeuchte-Sensor
                 * @type {number} myVal
                 */
                let myVal;
                /**Reversible Eingang des Bodenfeuchte sensors
                 * @type {boolean} reverse -Eingang analogOHPct < analogZPct
                 *
                 */
                const reverse = (myConfig.config[mySprinkleID].analog.analogOHPct < myConfig.config[mySprinkleID].analog.analogZPct);
                if (myConfig.config[mySprinkleID].analog.analogOHPct === myConfig.config[mySprinkleID].analog.analogZPct) {
                    adapter.log.warn(`${myConfig.config[mySprinkleID].objectName}: analog soil moisture sensor at 0% and at 100% => the values are the same`);
                }

                if ((!reverse && newVal < myConfig.config[mySprinkleID].analog.analogZPct)
                    || (reverse && myConfig.config[mySprinkleID].analog.analogZPct < newVal)) {
                    myVal = myConfig.config[mySprinkleID].analog.analogZPct;
                    adapter.log.warn(`${myConfig.config[mySprinkleID].objectName} (${newVal}): analog soil moisture sensor at 0 % => ${reverse} ? 'The range of values has been exceeded (reverse)' : 'The value range was undercut'}`);
                } else if ((!reverse && newVal > myConfig.config[mySprinkleID].analog.analogOHPct)
                    || (reverse && myConfig.config[mySprinkleID].analog.analogOHPct > newVal)) {
                    myVal = myConfig.config[mySprinkleID].analog.analogOHPct;
                    adapter.log.warn(`${myConfig.config[mySprinkleID].objectName} (${newVal}): analog soil moisture sensor at 100 % => ${reverse} ? 'The value range was undercut (reverse)' : 'The range of values has been exceeded'}`);
                } else {
                    myVal = newVal;
                }

                myConfig.config[mySprinkleID].analog.pct = Math.round(10 * trend(myConfig.config[mySprinkleID].analog.analogZPct, myConfig.config[mySprinkleID].analog.analogOHPct, 0, 100, myVal)) / 10;
                adapter.setState(`sprinkle.${ [myConfig.config[mySprinkleID].objectName] }.actualSoilMoisture`, {
                    val: myConfig.config[mySprinkleID].analog.pct,
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
     * @param {number} mySprinkleID - ID des Bewässerungskreis
     * @param {number} addVal - soilMoisture.val wird um den Wert addVal erhöht
     */
    addSoilMoistVal: async (mySprinkleID, addVal) => {
        if (myConfig.config[mySprinkleID].calculation.val < myConfig.config[mySprinkleID].calculation.maxIrrigation) {
            myConfig.config[mySprinkleID].calculation.val += addVal;
            if (myConfig.config[mySprinkleID].calculation.val > myConfig.config[mySprinkleID].calculation.maxIrrigation) {
                myConfig.config[mySprinkleID].calculation.val = myConfig.config[mySprinkleID].calculation.maxIrrigation;
            }
        }

        myConfig.config[mySprinkleID].calculation.pct = Math.round(1000 * myConfig.config[mySprinkleID].calculation.val
            / myConfig.config[mySprinkleID].calculation.maxIrrigation) / 10;	// Berechnung in %
        adapter.setState(`sprinkle.${ myConfig.config[mySprinkleID].objectName }.actualSoilMoisture`, {
            val: myConfig.config[mySprinkleID].calculation.pct,
            ack: true
        });
    },
    postponeByOneDay: async (mySprinkleID) => {
        if (myConfig.config[mySprinkleID].fixDay.startDay === 'threeRd' ||          // Next Start in 3 Tagen
            myConfig.config[mySprinkleID].fixDay.startDay === 'twoNd') {             // Next Start in 2 Tagen
            try {
                const today = await formatTime().day;
                const id = `${adapter.namespace}.sprinkle.${myConfig.config[mySprinkleID].objectName}.actualSoilMoisture`;
                let curDay, nextDay;
                /**     Wert von actualSoilMoisture auslesen     */
                const _curDay = await adapter.getStateAsync(id);
                if (_curDay) {
                    curDay = ((+_curDay.val >= 0) && (+_curDay.val <= 6) && (typeof _curDay.val === 'number') ? _curDay.val : today);
                    myConfig.config[mySprinkleID].fixDay.startFixDay[curDay] = false;
                    nextDay = (+ curDay + 1 > 6) ? (+ curDay-6) : (+ curDay + 1);
                    myConfig.config[mySprinkleID].fixDay.startFixDay[nextDay] = true;
                    adapter.setStateAsync(`${id}`, {
                        val: nextDay, 
                        ack: true
                    });
                } else {
                    adapter.log.warn(`postponeByOneDay: ${id} => current day: ${_curDay.val} - No value found`);
                }
            } catch (error) {
                adapter.log.warn(`postponeByOneDay setStateAsync: ${error}`);
            }    

        }
    }
};

module.exports = myConfig;