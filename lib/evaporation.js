'use strict';
/*
 info:  log aufbau evaporation.js: #3.*
 */
 const myConfig = require('./myConfig.js');          // myConfig → Speichern und abrufen von Konfigurationsdaten der Ventile
 const formatTime = require('./tools').formatTime;   // tools => laden von Hilfsfunktionen
 const trend = require('./tools').trend;             // tools => laden von Hilfsfunktionen

let adapter;

/* calcEvaporation */
/**
 * akt. Temperatur °C
 * - -20 bis 55°C
 * - ts Zeitstempel, wann der Wert aktualisiert wurde (auch ohne Wertänderung)
 */
const curTemperature = {
        val: 0,
        ts: undefined
    };
/**
 * akt. LuftFeuchtigkeit in %
 * - 1 bis 99%
 * - lc: Zeitstempel, wann der Wert geändert wurde
 */
const curHumidity = {
        val: 0,
        lc: undefined
    };
/**
 * akt. Helligkeit (relativ)
 * - 0 bis 100000
 * - intern Begrenzung 100...7000
 * - lc: Zeitstempel, wann der Wert geändert wurde
 */
const curIllumination = {
        val: 0,
        lc: undefined
    };
/**
 * akt. WindGeschwindigkeit in km/h
 * - 0 bis 200 km/h
 * - lc: Zeitstempel, wann der Wert geändert wurde
 */
const curWindSpeed = {
        val: 0,
        lc: undefined
    };
/**
 * last rain container => letzter Regencontainer in mm 
 */ 
let lastRainCounter = 0;
/**
 *  letzte Aktualisierungszeit des Temperaturwertes
 */
let lastChangeEvaPor = new Date();
let ETpTodayNum = 0;
/**
 * Extraterrestrische Tagesstrahlung in W/m²
 * - berechneter tabellarischer Tageswert
 */
let toDayExtraTerStr;
/**
 * kleinste extraterrestrische Tagesstrahlung im Jahr in W/m²
 * - berechneter tabellarischer Mindestwert
 */
let minExtraTerStr;
/**
 * größter extraterrestrische Tagesstrahlung im Jahr in W/m²
 * - berechneter tabellarischer Maximalwert
 */
let maxExtraTerStr;
     
/**
 * Extraterrestrische Strahlung (kurzwelliger Strahlungseinfluss von der Sonne an der Obergrenze der Erdatmosphäre) in W/m²
 * als Tagesmittel, Nordhalbkugel (IQBAL. 1983)
 *
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
 * Ermittlung der heutigen extraterrestrischen Strahlung
 * anhand der Tabelle "ExtraTerStrTab"
 */
function extraTerStr () { // latitude Breitengrad
    const dayNr = formatTime(adapter,'','dayNr');
     // - unterer Tabellenwert der Latitude
    const lowerLatitude = ((parseInt(adapter.config.latitude, 10) < 46 ) ? 46 : ((parseInt(adapter.config.latitude, 10) > 55) ? 55 : (parseInt(adapter.config.latitude, 10)))) || 52,
         // - oberer Tabellenwert der Latitude
        upperLatitude = ((lowerLatitude + 1) > 55) ? 55 : (lowerLatitude + 1);
    let currentMonth,
        followMonth;

    for(let i = 0; i < 12; i++) {
        if (ExtraTerStrTab.Tag[i] > dayNr) {
            followMonth = i;
            currentMonth = (i === 0) ? 11 : (i - 1);
            break;
        } else if (i === 11) {
            followMonth = 0;
            currentMonth = 11;
            break;
        }
    }

    toDayExtraTerStr = trend(
        lowerLatitude,
        upperLatitude,
        trend(ExtraTerStrTab.Tag[currentMonth], ExtraTerStrTab.Tag[followMonth], ExtraTerStrTab[lowerLatitude.toString()][currentMonth], ExtraTerStrTab[lowerLatitude.toString()][followMonth], dayNr),
        trend(ExtraTerStrTab.Tag[currentMonth], ExtraTerStrTab.Tag[followMonth], ExtraTerStrTab[upperLatitude.toString()][currentMonth], ExtraTerStrTab[upperLatitude.toString()][followMonth], dayNr),
        +adapter.config.latitude
    );

    minExtraTerStr = trend(
        lowerLatitude,
        upperLatitude,
        ExtraTerStrTab[lowerLatitude.toString()][11],
        ExtraTerStrTab[upperLatitude.toString()][11],
        +adapter.config.latitude
    );

    maxExtraTerStr = trend(
        lowerLatitude,
        upperLatitude,
        ExtraTerStrTab[lowerLatitude.toString()][5],
        ExtraTerStrTab[upperLatitude.toString()][5],
        +adapter.config.latitude
    );
}

/**
 * evaporation calculation
 * => Berechnung der Verdunstung
 *
 * @param timeDifference
 */
function calcEvaporation (timeDifference) {
    adapter.log.debug(`calcEvaporation => gestartet TimeDifferenz: ${timeDifference}`);
    //	Sonnenscheindauer in %
    const curSunshineDuration = (curIllumination.val < 100) ? (0) : (curIllumination.val > 7000) ? (1) : ((curIllumination.val - 100) / (6900));

    /**
     * Sättigungsdampfdruck 'Es' in hPa
     *
     */
    const m1 = 6.11 * ( 10 ** (( 7.48 * curTemperature.val ) / ( 237 + curTemperature.val )));
    /**
     * Dampfdruck Ea
     *
     */
    const m2 = m1 * curHumidity.val / 100;
    /**
     * Globalstrahlung RG
     *
     */
    const m3 = (0.19 + 0.55 * curSunshineDuration) * toDayExtraTerStr;
    /**
     * Abstrahlung I in W/m²
     *
     */
    const m4 = 5.67E-8 * (( curSunshineDuration + 273 ) ** 4 ) * ( 0.56 - 0.08 * ( m2 ** 0.5 )) * ( 0.1 + ( 0.9 * curSunshineDuration));
    /**
     * Strahlungsäquivalent EH in mm/d
     *
     */
    const m5 = ( m3 * ( 1 - 0.2 ) - m4 ) / 28.3;
    /**
     * Steigung der Sättigungsdampfdruckkurve Delta in hPa/K
     *
     */
    const m6 = ( m1 * 4032 ) / (( 237 + curTemperature.val ) ** 2 );
    /**
     * Windfunktion f(v) in mm/d hPa
     *
     */
    const m7 = 0.13 + 0.14 * curWindSpeed.val / 3.6;
    /**
     * pot. Evapotranspiration nach Penman ETp in mm/d
     *
     */
    const eTp = (( m6 * m5 + 0.65 * m7 * ( m1 - m2 )) / ( m6 + 0.65 )) - 0.5;

    adapter.setState('evaporation.ETpCurrent', { val: Math.round(eTp * 10000) / 10000, ack: true });

    addEvaporation(eTp * timeDifference);
}

function addEvaporation (value) {
    if (value < 2) {       // um Fehler in der Auswertung beim Neustart zu löschen
        ETpTodayNum += value;
    }
    adapter.setState('evaporation.ETpToday', { val: Math.round(ETpTodayNum * 10000) / 10000, ack: true });

    myConfig.applyEvaporation (value);
}

/*
-----------------------------------------------------------  externe Funktionen  -----------------------------------------------------------
*/

/**
 * externe Funktionen
 *
 */
const evaporation = {
    /**
     * Initialisierung von evaporation
     * - Bereitstellen von Umweltdaten
     *
     * @param myAdapter
     */
    initEvaporation (myAdapter) {
        adapter = myAdapter;
        /**
         *  - Sensors to calculate the evaporation are required
         *  - Sensoren zur Berechnung der Evaporation werden benötigt
         *
         * @returns
         */
        function fCalculationOn () {
            const found = myConfig.config.find(d => d.methodControlSM === 'calculation');
            return (!(typeof found === 'undefined'));
        }
        const calculationOn = fCalculationOn();
        extraTerStr();
        if (adapter.config.sensorOutsideTemperature !== '') {
            adapter.subscribeForeignStates(adapter.config.sensorOutsideTemperature);
            adapter.getForeignState(adapter.config.sensorOutsideTemperature, (err, state) => {
                if (typeof state !== undefined && state != null) {
                    if (!Number.isNaN(Number.parseFloat(state.val))) {
                        curTemperature.val = (parseFloat(state.val));
                        curTemperature.ts = state.ts;
                    } else {
                        adapter.log.warn(`sensorOutsideTemperature => Wrong value: ${state.val}, Type: ${typeof state.val}`);
                    }
                }
            });
        } else if (calculationOn) {
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
                        adapter.log.warn(`sensorOutsideHumidity => Wrong value: ${state.val}, Type: ${typeof state.val}`);
                    }
                }
            });
        } else if (calculationOn) {
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
                        adapter.log.warn(`sensorBrightness => Wrong value: ${ state.val  }, Type: ${  typeof state.val}`);
                    }
                }
            });
        } else if (calculationOn) {
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
                        adapter.log.warn(`sensorWindSpeed => Wrong value: ${state.val}, Type: ${typeof state.val}`);
                    }
                }
            });
        } else if (calculationOn) {
            adapter.log.warn('The sensor "sensorWindSpeed" is not saved in the configuration! The adapter cannot work like this!');
        }

        if (adapter.config.sensorRainfall !== '') {
            adapter.subscribeForeignStates(adapter.config.sensorRainfall);
            adapter.getForeignState(adapter.config.sensorRainfall, (err, state) => {
                if (typeof state !== undefined && state != null) {
                    if (!Number.isNaN(Number.parseFloat(state.val))) {
                        lastRainCounter = (parseFloat(state.val));
                    } else {
                        adapter.log.warn(`sensorRainfall => Wrong value: ${state.val}, Type: ${typeof state.val}`);
                    }
                }
            });
        }
    },
    /**
     * aktuelle Temperatur
     * 
     * @param value - aktuelle Temperatur
     * @param curTime - aktuelle Zeit der Temperaturerfassung
     */
    setCurTemperature (value, curTime) {
        curTemperature.val = value;
        curTemperature.ts = curTime;

        /**
         * Abbruch bei inkorrekten Umweltdaten
         *
         */
        let abbruch = false;
        if((curTemperature.val < -20) && (curTemperature.val > 55)){
            adapter.log.warn('Temperature outside the range of -20 ... 55 [°C]'); abbruch = true;
        }
        if((curHumidity.val < 1) && (curHumidity.val > 99)) {
            adapter.log.warn('Humidity outside the range of 1 ... 99 [%]'); abbruch = true;
        }
        if((curIllumination.val < 0) && (curIllumination.val > 100000)) {
            adapter.log.warn('Brightness out of range von 0 ... 100.000'); abbruch = true;
        }
        if((curWindSpeed.val < 0) && (curWindSpeed.val > 200)) {
            adapter.log.warn('Wind speed outside the range of 0 ... 200 km/h'); abbruch = true;
        }
        if (abbruch) {
            return;
        }

        /**
         * Zeitdifferenz in ms
         */
        // @ts-ignore
        const timeDifference = (curTime - lastChangeEvaPor) / 86400000;		// 1Tag === 24/h * 60/min * 60/s * 1000/ms === 86400000 ms
        adapter.log.debug(`ts: ${curTime} - lastChangeEvaPor: ${lastChangeEvaPor} = timeDifference: ${timeDifference}`);

        if (timeDifference) {
            setTimeout(() => {
                calcEvaporation(timeDifference);
            }, 100);
        }
        lastChangeEvaPor = curTime;
    },
    /**
     * akt. LuftFeuchtigkeit in %
     *
     * @param value
     * @param lc
     */
    setCurHumidity (value, lc) {
        curHumidity.val = value;
        curHumidity.lc =lc;
    },
    /**
     * akt. Helligkeit wird auf 0 bis 7000 begrenzt
     *
     * @param value
     * @param lc
     */
    setCurIllumination (value, lc) {
        curIllumination.val = value;
        curIllumination.lc = lc;
    },
    /**
     * akt. Windgeschwindigkeit
     *
     * @param value Windgeschwindigkeit in km/h
     * @param lc
     */
    setCurWindSpeed (value, lc) {
        curWindSpeed.val = value;
        curWindSpeed.lc = lc;
    },
    /**
     * akt. Regenmengenzähler
     * → Bei einer Änderung über 20 mm wird der Wert nur intern gespeichert,
     * es findet aber keine Anwendung statt!
     *
     * @param value current rain counter → aktueller Regencontainer in mm
     */
    setCurAmountOfRain (value) {
        if ((value > lastRainCounter)               // es regnet
            && ((value - lastRainCounter) < 20)     // && Plausibilitätskontrolle (Regenmenge unter 10mm)
        ) {
            addEvaporation(lastRainCounter - value);
        }
        lastRainCounter = value;
        adapter.log.debug(`lastRainCounter: ${lastRainCounter} curAmountOfRain: ${(lastRainCounter - value)} state.val: ${value}`);
    },
    /**
     * Summe der heutigen Verdunstung
     *
     * @param value
     */
    setETpTodayNum (value) {
        ETpTodayNum = value;
    },
    /**
     * ETpToday und ETpYesterday in evaporation aktualisieren da ein neuer Tag beginnt
     */
    setNewDay () {
        extraTerStr();
        setTimeout(() => {
            adapter.setState('evaporation.ETpYesterday', { val: Math.round(ETpTodayNum * 10000) / 10000, ack: true });
            ETpTodayNum = 0;
            adapter.setState('evaporation.ETpToday', { val: 0, ack: true });
        }, 100);
    },
    /**
     *
     * @param maxExtension - Wert aus der Konfiguration (wateringAdd 100...300%) des Bewässerungskreises
     * @returns - Erweiterung/Multiplikator (1...3) der Bewässerungszeit
     */
    timeExtension (maxExtension) {
        return trend(minExtraTerStr, maxExtraTerStr,1, maxExtension / 100, toDayExtraTerStr);
    },
    /**Output of the current evaporation =>
     * Ausgabe der aktuellen Verdunstung
     * @returns {number}
     */
    getETpTodayNum () {
        return ETpTodayNum;
    }
};

module.exports = evaporation;