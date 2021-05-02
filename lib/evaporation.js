'use strict';
/*
 info:  log aufbau evaporation.js: #3.*
 */
const myConfig = require('./myConfig.js');              // myConfig => Speichern und abrufen von Konfigurationsdaten der Ventile
const formatTime = require('./tools').formatTime;// tools => laden von Hilfsprogrammen

/** @type {ioBroker.Adapter} */
let adapter;

/* calcEvaporation */
/** akt. Temperatur °C
 * - -20 bis 55°C
 * - ts Zeitstempel, wann der Wert aktualisiert wurde (auch ohne Wertänderung)
 *  @type {{val: number, ts: any}} */
let curTemperature = {},
/** akt. LuftFeuchtigkeit in %
 * - 1 bis 99%
 * - lc: Zeitstempel, wann der Wert geändert wurde
 *  @type {{val: number, lc: any}} */
    curHumidity = {},
/** akt. Helligkeit (relativ)
 * - 0 bis 100000
 * - intern Begrenzung  100...7000
 * - lc: Zeitstempel, wann der Wert geändert wurde
 *  @type {{val: number, lc: any}} */
    curIllumination = {},
/** akt. WindGeschwindigkeit in km/h
 * - 0 bis 200 km/h
 * - lc: Zeitstempel, wann der Wert geändert wurde
 *  @type {{val: number, lc: any}} */
    curWindSpeed = {},
/** last rain container => letzter Regencontainer
 *  @type {number} */
    lastRainCounter = 0,
/** current amount of rain => aktuelle Regenmenge
 *  @type {number} */
    curAmountOfRain = 0,
/** Sonnenscheindauer in h
 * @type {number} */
    maxSunshine,	        /**/
/** letzte Aktualisierungszeit des Temperaturwertes
 *  @type {Date} */
    lastChangeEvaPor = new Date();

/** @type {number} */
let ETpTodayNum = 0,
/** Extraterrestrische Tagesstrahlung in W/m²
 * @type {number}  */
    toDayExtraTerStr;

/**
 * Extraterrestrische Strahlung (kurzwelliger Strahlungseinfluss von der Sonne an der Obergrenze der Erdatmosphäre) in W/m²
 * als Tagesmittel, Nordhalbkugel (IQBAL. 1983)
 * @type {{Tag: number[], "46": number[], "47": number[], "48": number[], "49": number[], "50": number[], "51": number[], "52": number[], "53": number[], "54": number[], "55": number[]}}
 */
const ExtraTerStrTab = {
    Tag:[ 21,  52,  80, 111, 141, 172, 202, 233, 264, 294, 325, 355],
    46: [135, 198, 289, 382, 452, 483, 467, 409, 324, 230, 153, 117],
    47: [128, 191, 283, 378, 450, 482, 466, 406, 319, 224, 146, 110],
    48: [121, 184, 277, 375, 449, 482, 465, 403, 314, 217, 139, 103],
    49: [114, 177, 271, 371, 447, 481, 464, 400, 309, 211, 132,  96],
    50: [107, 170, 265, 367, 445, 481, 463, 398, 304, 204, 125,  89],
    51: [100, 163, 259, 363, 443, 480, 462, 394, 298, 197, 118,  83],
    52: [ 93, 156, 253, 358, 441, 480, 461, 391, 293, 191, 111,  76],
    53: [ 86, 149, 247, 354, 439, 479, 459, 388, 287, 184, 104,  70],
    54: [ 79, 142, 240, 350, 437, 478, 458, 384, 282, 177,  97,  63],
    55: [ 73, 135, 234, 345, 435, 478, 457, 381, 276, 170,  90,  56]
};

/*-----------------------------------------------------------  interne Funktionen  -----------------------------------------------------------*/

/**
 * TREND - Zwischenwert ermitteln
 * @param {number} a1 - Istwert a1 der Zeitachse
 * @param {number} a2 - Istwert a2 der Zeitachse
 * @param {number} b1 - Sollwert b1 der Wertachse
 * @param {number} b2 - Sollwert b2 der Wertachse
 * @param {number} soll_A3 - Sollwert soll_A3 der Zeitachse
 * @returns {number} Zwischenwert
 */
function trend (a1,a2,b1,b2,soll_A3) {
    return (soll_A3-a1)*(b2-b1)/(a2-a1)+b1;
}

/**
 * Ermittlung der heutigen extraterrestrischen Strahlung
 * anhand der Tabelle "ExtraTerStrTab"
 */
function extraTerStr () { // latitude Breitengrad
    const dayNr = formatTime(adapter,'','dayNr');
        /** @type {number} */
    let lowerLatitude = parseInt(adapter.config.latitude, 10),
        /** @type {number} */
        upperLatitude = parseInt(adapter.config.latitude, 10) + 1,
        /** @type {number} */
        currentMonth,
        /** @type {number} */
        followMonth;

    for(let i = 0; i < 12; i++) {
        if (ExtraTerStrTab.Tag[i] > dayNr) {
            followMonth = i;
            currentMonth = (i === 0) ? 11 : (i - 1);
            break;
        } else if (i === 11) {
            followMonth = 0;
            currentMonth = 11
        }
    }

    toDayExtraTerStr = trend(
        lowerLatitude,
        upperLatitude,
        trend(ExtraTerStrTab.Tag[currentMonth], ExtraTerStrTab.Tag[followMonth], ExtraTerStrTab[lowerLatitude][currentMonth], ExtraTerStrTab[lowerLatitude][followMonth], dayNr),
        trend(ExtraTerStrTab.Tag[currentMonth], ExtraTerStrTab.Tag[followMonth], ExtraTerStrTab[upperLatitude][currentMonth], ExtraTerStrTab[upperLatitude][followMonth], dayNr),
        adapter.config.latitude
    );
}

/**
 * evaporation calculation
 * => Berechnung der Verdunstung
 * @param {number} timeDifference
 */
function calcEvaporation (timeDifference) {
    if (adapter.config.debug) {adapter.log.info('calcEvaporation => gestartet TimeDifferenz: ' + timeDifference);}
    //	Sonnenscheindauer in %
    const curSunshineDuration = (curIllumination.val < 100) ? (0) : (curIllumination.val > 7000) ? (1) : ((curIllumination.val - 100) / (6900));

    const RE = 45.8 * maxSunshine - 293;

    /**
     * Sättigungsdampfdruck Es in hPa
     * @type {number} m1
     */
    const m1 = 6.11 * ( 10 ** (( 7.48 * curTemperature.val ) / ( 237 + curTemperature.val )));
    /**
     * Dampfdruck Ea
     * @type {number} m2
     */
    const m2 = m1 * curHumidity.val / 100;
    /**
     * Globalstrahlung RG
     * @type {number} m3
     */
    const m3 = (0.19 + 0.55 * curSunshineDuration) * toDayExtraTerStr;
    /**
     * Abstrahlung I in W/m²
     * @type {number} m4
     */
    const m4 = 5.67E-8 * (( curSunshineDuration + 273 ) ** 4 ) * ( 0.56 - 0.08 * ( m2 ** 0.5 )) * ( 0.1 + ( 0.9 * curSunshineDuration));
    /**
     * Strahlungsäquivalent EH in mm/d
     * @type {number} m5
     */
    const m5 = ( m3 * ( 1 - 0.2 ) - m4 ) / 28.3;
    /**
     * Steigung der Sättigungsdampfdruckkurve Delta in hPa/K
     * @type {number} m6
     */
    const m6 = ( m1 * 4032 ) / (( 237 + curTemperature.val ) ** 2 );
    /**
     * Windfunktion f(v) in mm/d hPa
     * @type {number} m7
     */
    const m7 = 0.13 + 0.14 * curWindSpeed.val / 3.6;
    /**
     * pot. Evapotranspiration nach Penman ETp in mm/d
     * @type {number} eTp
     */
    const eTp = (( m6 * m5 + 0.65 * m7 * ( m1 - m2 )) / ( m6 + 0.65 )) - 0.5;

    if (adapter.config.debug) {adapter.log.info('RE: ' + RE + ' ETp:' + eTp);}
    adapter.setState('evaporation.ETpCurrent', { val: Math.round(eTp * 10000) / 10000, ack: true });

    // Verdunstung des heutigen Tages
    const curETp = (eTp * timeDifference) - curAmountOfRain;
    curAmountOfRain = 0;	// auf 0 setzen damit nicht doppelt abgezogen wird.
    if (curETp < 2) {       // um Fehler in der Auswertung beim Neustart zu löschen
        ETpTodayNum += curETp;
    }
    if (adapter.config.debug) {adapter.log.info('ETpTodayNum = ' + ETpTodayNum + ' ( ' + curETp + ' )');}
    adapter.setState('evaporation.ETpToday', { val: Math.round(ETpTodayNum * 10000) / 10000, ack: true });

    myConfig.applyEvaporation (curETp);
}

/*-----------------------------------------------------------  externe Funktionen  -----------------------------------------------------------*/
/**
 * externe Funktionen
 * @type {{setCurTemperature: evaporation.setCurTemperature, setCurIllumination: evaporation.setCurIllumination, initEvaporation: evaporation.initEvaporation, setCurAmountOfRain: evaporation.setCurAmountOfRain, setMaxSunshine: evaporation.setMaxSunshine, setNewDay: evaporation.setNewDay, setCurHumidity: evaporation.setCurHumidity, setCurWindSpeed: evaporation.setCurWindSpeed, setExtraTerStr: evaporation.setExtraTerStr, setETpTodayNum: evaporation.setETpTodayNum}}
 */
const evaporation = {
    /**
     * Initialisierung von evaporation
     * - Bereitstellen von Umweltdaten
     * @param {ioBroker.Adapter} myAdapter
     */
    initEvaporation: (myAdapter) => {
        adapter = myAdapter;
        extraTerStr();
        if (adapter.config.sensorOutsideTemperature !== '') {
            adapter.subscribeForeignStates(adapter.config.sensorOutsideTemperature);
            adapter.getForeignState(adapter.config.sensorOutsideTemperature, (err, state) => {
                if (typeof state !== undefined && state != null) {
                    if (!Number.isNaN(Number.parseFloat(state.val))) {
                        curTemperature.val = (parseFloat(state.val));
                        curTemperature.ts = state.ts;
                    } else {
                        adapter.log.warn('sensorOutsideTemperature => Wrong value: '+ state.val + ', Type: ' + typeof state.val)
                    }
                }
            });
        } else {
            adapter.log.warn('The sensor "sensorOutsideTemperature" is not saved in the configuration! The adapter cannot work like this!');
        }

        if (adapter.config.sensorOutsideHumidity !== '') {
            adapter.subscribeForeignStates(adapter.config.sensorOutsideHumidity);
            adapter.getForeignState(adapter.config.sensorOutsideHumidity, (err, state) => {
                if (typeof state !== undefined && state != null) {
                    if (!Number.isNaN(Number.parseFloat(state.val))) {
                        curHumidity.val = (parseFloat(state.val));
                        curHumidity.lc = state.lc;
                    } else {
                        adapter.log.warn('sensorOutsideHumidity => Wrong value: '+ state.val + ', Type: ' + typeof state.val)
                    }
                }
            });
        } else {
            adapter.log.warn('The sensor "sensorOutsideHumidity" is not saved in the configuration! The adapter cannot work like this!');
        }

        if (adapter.config.sensorBrightness !== '') {
            adapter.subscribeForeignStates(adapter.config.sensorBrightness);
            adapter.getForeignState(adapter.config.sensorBrightness, (err, state) => {
                if (typeof state !== undefined && state != null) {
                    if (!Number.isNaN(Number.parseFloat(state.val))) {
                        curIllumination.val = (parseFloat(state.val));
                        curIllumination.lc = state.lc;
                    } else {
                        adapter.log.warn('sensorBrightness => Wrong value: '+ state.val + ', Type: ' + typeof state.val)
                    }
                }
            });
        } else {
            adapter.log.warn('The sensor "sensorBrightness" is not saved in the configuration! The adapter cannot work like this!');
        }

        if (adapter.config.sensorWindSpeed !== '') {
            adapter.subscribeForeignStates(adapter.config.sensorWindSpeed);
            adapter.getForeignState(adapter.config.sensorWindSpeed, (err, state) => {
                if (typeof state !== undefined && state != null) {
                    if (!Number.isNaN(Number.parseFloat(state.val))) {
                        curWindSpeed.val = (parseFloat(state.val));
                        curWindSpeed.lc = state.lc;
                    } else {
                        adapter.log.warn('sensorWindSpeed => Wrong value: '+ state.val + ', Type: ' + typeof state.val)
                    }
                }
            });
        } else {
            adapter.log.warn('The sensor "sensorWindSpeed" is not saved in the configuration! The adapter cannot work like this!');
        }

        if (adapter.config.sensorRainfall !== '') {
            adapter.subscribeForeignStates(adapter.config.sensorRainfall);
            adapter.getForeignState(adapter.config.sensorRainfall, (err, state) => {
                if (typeof state !== undefined && state != null) {
                    if (!Number.isNaN(Number.parseFloat(state.val))) {
                        lastRainCounter = (parseFloat(state.val));
                    } else {
                        adapter.log.warn('sensorRainfall => Wrong value: '+ state.val + ', Type: ' + typeof state.val)
                    }
                }
            })
        }
    },
    /**
     * akt. Temperatur
     * @param {number} value curTemperature
     * @param {Date | number} curTime ts (akt. Zeit)
     */
    setCurTemperature: (value, curTime) => {
        curTemperature.val = value;
        curTemperature.ts = curTime;

        /**
         * Abbruch bei inkorrekten Umweltdaten
         * @type {boolean}
         */
        let abbruch = false;
        if((curTemperature.val < -20) && (curTemperature.val > 55)){adapter.log.warn(''); abbruch = true;}
        if((curHumidity.val < 1) && (curHumidity.val > 99)) {adapter.log.warn(''); abbruch = true;}
        if((curIllumination.val < 0) && (curIllumination.val > 100000)) {adapter.log.warn(''); abbruch = true;}
        if((curWindSpeed.val < 0) && (curWindSpeed > 200)) {adapter.log.warn(''); abbruch = true;}
        if (abbruch) {return;}

        /**
         * Zeitdifferenz in ms
         * @type {number}
         */
        const timeDifference = (curTime - lastChangeEvaPor) / 86400000;		// 1Tag === 24/h * 60/min * 60/s * 1000/ms === 86400000 ms
        if (adapter.config.debug) {
            adapter.log.info('ts: ' + curTime + ' - lastChangeEvaPor: ' + lastChangeEvaPor + ' = timeDifference: ' + timeDifference);
        }

        if (timeDifference) {
            setTimeout(() => {
                calcEvaporation(timeDifference);
            }, 500);
        }
        lastChangeEvaPor = curTime;
    },
    /**
     * akt. LuftFeuchtigkeit in %
     * @param {number} value
     * @param {any} lc
     */
    setCurHumidity: (value, lc) => {
        curHumidity.val = value;
        curHumidity.lc =lc;
    },
    /**
     * akt. Helligkeit wird auf 0 bis 7000 begrenzt
     * @param {number} value
     * @param {any} lc
     */
    setCurIllumination: (value, lc) => {
        curIllumination.val = value;
        curIllumination.lc = lc;
    },
    /**
     * akt. Windgeschwindigkeit
     * @param {number} value Windgeschwindigkeit in km/h
     * @param {any} lc
     */
    setCurWindSpeed: (value, lc) => {
        curWindSpeed.val = value;
        curWindSpeed.lc = lc;
    },
    /**
     * akt. Regenmengenzähler
     * => Bei einer Änderungen über 10 mm wird der Wert nur intern gespeichert,
     * es findet aber keine Anwendung statt!
     * @param {number} value akt. Wert des Regenmengenzählers in mm
     */
    setCurAmountOfRain: (value) => {
        if ((value > lastRainCounter)               // es regnet
            && ((value - lastRainCounter) < 10)     // && Plausibilitätskontrolle (Regenmenge unter 10mm)
        ) {
            curAmountOfRain = value - lastRainCounter;
        } else {
            curAmountOfRain = 0;
        }
        /*
        if ((Math.abs(lastRainCounter - value) > 10) || (value === 0)) {   // Zähler zurücksetzen
            curAmountOfRain = 0;
            if (adapter.config.debug) {
                adapter.log.info('if => Math.abs: ' + Math.abs(lastRainCounter - value) + ' curAmountOfRain: ' + curAmountOfRain);
            }
        } else {
            curAmountOfRain = value - lastRainCounter;
            if (adapter.config.debug) {
                adapter.log.info('else => Math.abs: ' + Math.abs(lastRainCounter - value) + ' curAmountOfRain: ' + curAmountOfRain);
            }
        }
        */
        lastRainCounter = value;
        if (adapter.config.debug) {
            adapter.log.info('lastRainCounter: ' + lastRainCounter + ' curAmountOfRain: ' + curAmountOfRain + ' state.val: ' + value);
        }
    },
    /**
     * max. Sonnenscheindauer des Tages
     * @param {number} value maxSunshine => maximal mögliche Sonnenscheindauer des Tages
     */
    setMaxSunshine: (value) => {
        maxSunshine = value;
    },
    setETpTodayNum: (value) => {
        ETpTodayNum = value;
    },
    /**
     * ETpToday und ETpYesterday in evaporation aktualisieren da ein neuer Tag beginnt
     */
    setNewDay: () => {
        setTimeout(() => {
            adapter.setState('evaporation.ETpYesterday', { val: Math.round(ETpTodayNum * 10000) / 10000, ack: true });
            ETpTodayNum = 0;
            adapter.setState('evaporation.ETpToday', { val: '0', ack: true });
        }, 100);
    },
    setExtraTerStr: () => {
        extraTerStr();
    }
};

module.exports = evaporation;