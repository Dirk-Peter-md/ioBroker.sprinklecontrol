'use strict';
/*
 info:  log aufbau evaporation.js: #3.*
 */
const myConfig = require('./myConfig.js');                         // myConfig => Speichern und abrufen von Konfigurationsdaten der Ventile

/* calcEvaporation */
/** @type {number} */
let curTemperature;		/* akt. Temperatur*/
/** @type {number} */
let curHumidity;		/* akt. LuftFeuchtigkeit*/
/** @type {number} */
let curIllumination;	/* akt. Helligkeit*/
/** @type {number} */
let curWindSpeed;		/* akt. WindGeschwindigkeit*/
/** @type {number} */
let lastRainCounter = 0;	/*last rain container => letzter Regencontainer*/
/** @type {number} */
let curAmountOfRain = 0;	/*current amount of rain => aktuelle Regenmenge*/
/** @type {number} */
let maxSunshine;	        /*(Sonnenscheindauer in Stunden)*/
/** @type {Date} letzte Aktualisierungszeit des Temperaturwertes*/
let lastChangeEvaPor = new Date();	/*letzte Aktualisierungszeit*/

/** @type {number} */
let ETpTodayNum = 0;

/**
 * evaporation calculation
 * => Berechnung der Verdunstung
 * @param {ioBroker.Adapter} adapter
 * @param {number} timeDifference
 */
function calcEvaporation (adapter, timeDifference) {
    if (adapter.config.debug) {adapter.log.info('calcEvaporation => gestartet TimeDifferenz: ' + timeDifference);}
    //	Sonnenscheindauer in %
    const curSunshineDuration = (curIllumination < 100) ? (0) : (curIllumination > 7000) ? (1) : ((curIllumination - 100) / (6900));

    /*
    Extraterrestrische Strahlung in W/m³
    let ExStra = [86,149,247,354,439,479,459,388,287,184,104,70];   // "53NB"
    let my m = strftime("%m", localtime);
    let my RE = ExStra[$m];
    */

    const RE = 45.8 * maxSunshine - 293;

    /**
     * Sättigungsdampfdruck Es in hPa
     * @type {number} m1
     */
    const m1 = 6.11 * ( 10 ** (( 7.48 * curTemperature ) / ( 237 + curTemperature )));
    /**
     * Dampfdruck Ea
     * @type {number} m2
     */
    const m2 = m1 * curHumidity / 100;
    /**
     * Globalstrahlung RG
     * @type {number} m3
     */
    const m3 = (0.19 + 0.55 * curSunshineDuration) * RE;
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
    const m6 = ( m1 * 4032 ) / (( 237 + curTemperature ) ** 2 );
    /**
     * Windfunktion f(v) in mm/d hPa
     * @type {number} m7
     */
    const m7 = 0.13 + 0.14 * curWindSpeed / 3.6;
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

const evaporation = {
    /**
     * akt. Temperatur
     * @param {ioBroker.Adapter} adapter
     * @param {number} value curTemperature
     * @param {Date | number} curTime ts (akt. Zeit)
     */
    setCurTemperature: (adapter, value, curTime) => {
        curTemperature = value;
        const timeDifference = (curTime - lastChangeEvaPor) / 86400000;		// 24/h * 60/min * 60/s * 1000/ms = 86400000 ms
        if (adapter.config.debug) {
            adapter.log.info('ts: ' + curTime + ' - lastChangeEvaPor: ' + lastChangeEvaPor + ' = timeDifference: ' + timeDifference);
        }
        if (timeDifference) {
            setTimeout(() => {
                calcEvaporation(adapter, timeDifference);
            }, 500);
        }
        lastChangeEvaPor = curTime;
    },
    /**
     * akt. LuftFeuchtigkeit in %
     * @param {number} value
     */
    setCurHumidity: (value) => {
        curHumidity = value;
    },
    /**
     * akt. Helligkeit wird auf 0 bis 7000 begrenzt
     * @param {number} value
     */
    setCurIllumination: (value) => {
        curIllumination = value;
    },
    /**
     * akt. Windgeschwindigkeit
     * @param {number} value Windgeschwindigkeit in km/h
     */
    setCurWindSpeed: (value) => {
        curWindSpeed = value;
    },
    /**
     * akt. Regenmengenzähler
     * => Bei einer Änderungen über 10 mm wird der Wert nur intern gespeichert,
     * es findet aber keine Anwendung statt!
     * @param {ioBroker.Adapter} adapter
     * @param {number} value akt. Wert des Regenmengenzählers in mm
     */
    setCurAmountOfRain: (adapter, value) => {
        if (Math.abs(lastRainCounter - value) > 10) {
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
     * @param adapter
     */
    setNewDay: (adapter) => {
        setTimeout(() => {
            adapter.setState('evaporation.ETpYesterday', { val: Math.round(ETpTodayNum * 10000) / 10000, ack: true });
            ETpTodayNum = 0;
            adapter.setState('evaporation.ETpToday', { val: '0', ack: true });
        }, 100);
    }
};

module.exports = evaporation;