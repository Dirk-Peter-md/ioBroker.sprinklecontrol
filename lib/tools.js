'use strict';

/**
 * func addTime (02:12:24 + 00:15) || (807) => 02:12:39
 * 
 * @param time1 {string|number} z.B. 02:12:24 || 807 => 02:12:39
 * @param time2 {string|number|undefined} z.B. 02:12:24 || 807 => 02:12:39 || undef.
 * @returns {string} z.B. mm:ss || hh:mm:ss
 */
function addTime(time1, time2){
    const wert = string2seconds(time1) + string2seconds(time2);
    return seconds2string(wert);

    // private functions
    function seconds2string(n){
        n = Math.abs(n);
        const h = Math.trunc(n / 3600);
        const m = Math.trunc((n / 60 ) % 60);
        const sec = Math.trunc(n % 60);
        return (h === 0)?(`${frmt(m)}:${frmt(sec)}`):(`${frmt(h)}:${m}:${frmt(sec)}`);
    }   //  end function seconds2string

    function string2seconds(n) {
        if(!n || (n === '--:--')) return 0;
        if(Number.isInteger(n)) return n;
        const tmp = n.split(':').reverse();
        if(!tmp.length) tmp[0] = 0;	// Sekunden
        if(tmp.length < 2) tmp[1] = 0;	// Minuten
        if(tmp.length < 3) tmp[2] = 0;	// Stunden
        while(tmp[0] > 59) {
            tmp[0] -= 60;
            ++tmp[1];
        }
        while(tmp[1] > 59) {
            tmp[1] -= 60;
            ++tmp[2];
        }
        return (tmp[2] * 3600 + tmp[1] * 60 + 1 * tmp[0]);
    }   //  string2seconds

    function frmt(n) {
        return n < 10 ? `0${ n }` : n;
    }

}   // end - function addTime


/**
 * func Format Time
 * → hier wird der übergebene Zeitstempel, myDate, in das angegebene Format, timeFormat, umgewandelt.
 * Ist myDate nicht angegeben, so wird die aktuelle Zeit verwendet.
 *
 * @param {Date=} myDate - wenn nicht angegeben; dann wird aktuelles Datum verwendet
 * @returns {{dayNr: number; kW: number; day: number; dayTime: string; past: boolean}}
 * 	- kW: (number) Rückgabe der KW;
 *  - dayNr: (number) Tag des Jahres (Tagesnummer)
 *  - day: (number) Wochentag
 *  - dd.mm. hh:mm: (string) Rückgabe Datum und Zeit
 *  - past: true => (boolean) Heute schon vorbei
 */
function formatTime(myDate) {	// 'kW' 'dd.mm. hh:mm'
    function zweiStellen (s) {
        while (s.toString().length < 2) {
            s = `0${ s }`;
        }
        return s;
    }
    const d = (myDate)? new Date(myDate):new Date();
    const tag = zweiStellen(d.getDate());
    const monat = zweiStellen(d.getMonth() + 1);
    const stunde = zweiStellen(d.getHours());
    const minute = zweiStellen(d.getMinutes());
    const currentThursday = new Date(d.getTime() +(3-((d.getDay()+6) % 7)) * 86400000);
    // At the beginning or end of a year the thursday could be in another year.
    const yearOfThursday = currentThursday.getFullYear();
    // Get first Thursday of the year
    const firstThursday = new Date(new Date(yearOfThursday,0,4).getTime() +(3-((new Date(yearOfThursday,0,4).getDay()+6) % 7)) * 86400000);

    const start = new Date(d.getFullYear(), 0, 0);
    const diff = (+d - +start) + ((start.getTimezoneOffset() - d.getTimezoneOffset()) * 60 * 1000);
    const oneDay = 1000 * 60 * 60 * 24;
    const dayNr = Math.floor(diff / oneDay);

    // +1 we start with week number 1
    // +0.5 an easy and dirty way to round result (in combination with Math.floor)
    const kW = Math.floor(1 + 0.5 + (currentThursday.getTime() - firstThursday.getTime()) / 86400000/7);

    // Wochentag 0:So;1:Mo;...6:Sa
    const day = d.getDay();

    // 'dd.mm. hh:mm':
    const dayTime = `${tag}.${monat} ${stunde}:${minute}`;

    // true → Heute schon vorbei
    const cd = new Date();
    const cStunde = zweiStellen(cd.getHours());
    const cMinute = zweiStellen(cd.getMinutes());
    const past = ((stunde > cStunde) || ((stunde === cStunde) && (minute > cMinute)));

    return {
        dayNr: dayNr,
        kW: kW,
        day: day,
        dayTime: dayTime,
        past: past
    };
}

/**
 * TREND - Zwischenwert ermitteln
 *
 * @param {number} a1 - Istwert a1 der Zeitachse
 * @param {number} a2 - Istwert a2 der Zeitachse
 * @param {number} b1 - Sollwert b1 der Wertachse
 * @param {number} b2 - Sollwert b2 der Wertachse
 * @param {number} sollA3 - Sollwert soll_A3 der Zeitachse
 * @returns {number} Zwischenwert
 */
function trend (a1,a2,b1,b2,sollA3) {
    return (sollA3-a1)*(b2-b1)/(a2-a1)+b1;
}

/**
 * ID Homematic
 * Hiermit kann die ID-Adresse State, ON_TIME, WORKING, PROCESS eines Homematic-Schaltaktors 
 * ermittelt werden, wenn die ID des Geräts bekannt ist.
 * 
 * @param {object} adapter - Der ioBroker-Adapter, der die Funktion aufruft
 * @param {string} id - ID des Geräts
 * @returns {Promise} Promise, die die ID-Adresse zurückgibt
 */
async function idStateControl(adapter, id) {
    // "hm-rpc.0.MEQ1234567.3.STATE" => "hm-rpc.0.MEQ1234567.3"
    const pfad = id.substring(0, id.lastIndexOf('.'));  

    switch (adapter.config.switchingBehavior) {

        case "standard": {
            // standard => "hm-rpc.0.MEQ1234567.3.STATE"
            return {
                idState: id,
                idON_TIME: null,
                idACK: id,
                maker: "standard"
            };   
        }

        case "homematic": {
            try {
                const _state = await adapter.getForeignStateAsync(`${pfad}.STATE`);
                const _ON_TIME = await adapter.getForeignStateAsync(`${pfad}.ON_TIME`);
                const _WORKING = await adapter.getForeignStateAsync(`${pfad}.WORKING`);
                const _PROCESS = await adapter.getForeignStateAsync(`${pfad}.PROCESS`);
                if (typeof _state?.val !== 'boolean')  throw new Error(`idStateControl: State ${pfad}.STATE nicht gefunden`); 
                
                if (_WORKING) {
                    return {
                        idState: _state ? `${pfad}.STATE` : null,
                        idON_TIME: _ON_TIME ? `${pfad}.ON_TIME` : null,
                        idACK: _WORKING ? `${pfad}.WORKING` : null,
                        maker: 'HM'
                    };
                } else if (_PROCESS) {
                    return {
                        idState: _state ? `${pfad}.STATE` : null,
                        idON_TIME: _ON_TIME ? `${pfad}.ON_TIME` : null,
                        idACK: _PROCESS ? `${pfad}.PROCESS` : null,
                        maker: 'HmIP'
                    };
                } else {
                    return {
                        idState: _state ? `${pfad}.STATE` : null,
                        idON_TIME: null,
                        idACK: _state ? `${pfad}.STATE` : null,
                        maker: 'standard'
                    };
                }
            } catch (error) {
                adapter.log.error(`idStateControl: Fehler bei der Ermittlung der ID-Adresse für ${id}: ${error.message}`);
                return {
                    idState: id,
                    idON_TIME: null,
                    idACK: id,
                    maker: 'unknown'
                };
            }
        }

        case "noResponse": {
            // standard => "hm-rpc.0.MEQ1234567.3.STATE"
            return {
                idState: id,
                idON_TIME: null,
                idACK: null,
                maker: "noResponse"
            }; 
        }
        
        default: {
            adapter.log.error(`No switching behavior was selected for the "${id}" watering circuit.`);
        }
    }
}


// Signature of the callback
// type CallBackFind<T> = (
//     value: T,
//     index?: number,
//     collection?: T[]
//   ) => Promise<boolean>;

/**
 * Async Find function
 *
 * You can use as follows
 * const array = [1, 2, 3, 4];
 * const output = await findAsync<number>(array, async (i) => {
 * return Promise.resolve(i === 2);
 * });
 *
 * @template T
 * @param {T[]} elements
 * @param {any} cb
 * @returns {Promise<T | undefined>}
 */

async function findAsync( elements, cb) {
    for (const [index, element] of elements.entries()) {
        if (await cb(element, index, elements)) {
            return element;
        }
    }

    return undefined;
}

// You can use as follows
// const array = [1, 2, 3, 4];

// const output = await findAsync<number>(array, async (i) => {
//  return Promise.resolve(i === 2);
// });


/**
 * sleep Funktion mit .cancel bzw .continues Token
 *
 * @param {number} ms - Zeit in Millisekunden
 * @param {object} cancellationToken Objekt zur ansteuerung der inneren Funktion
 * @returns {Promise <string>}
 */
function sleep(ms, cancellationToken) {
    return new Promise((resolve) => {
        cancellationToken.clearEntireList = function() {
            clearTimeout(timeout);
            resolve('clearEntireList');
        };
        cancellationToken.boostKill = function() {
            clearTimeout(timeout);
            resolve('boostKill');
        };
        cancellationToken.ack = function() {
            clearTimeout(timeout);
            resolve('ack');
        };
        const timeout = setTimeout(() => {
            resolve('resolved');
        }, ms);
    });
}
// async function beginTest() {
//     try {
//         const token = {};
//         const promise = sleep(5000, token);
//         await promise;
//           // ... test code ...
//           // ... return whatever;
//      }
//      catch(error) {
//          console.log(error.message);
//          // If button was clicked before the 5000 ms has expired,
//          // and no other error has been thrown,
//          // then the log will show "sleep() cancelled".
//          throw error; // rethrow error to keep beginTest's caller informed.
//      }

const tools = {
    /**
     * laterThanTime Funktion
     *
     * @param {string} time - Zeit im Format "HH:MM"
     * @returns {boolean} true, wenn die angegebene Zeit noch in der Zukunft liegt, andernfalls false die Zeitliegt in der Vergangenheit
     */
    laterThanTime: function (time) {
        const now = new Date();
        const [hours, minutes] = time.split(':').map(Number);
        const targetTime = new Date();
        targetTime.setHours(hours, minutes, 0, 0);
        return now < targetTime;
    }
}

module.exports = {
    addTime,
    formatTime,
    idStateControl,
    trend,
    findAsync,
    sleep,
    tools
};
