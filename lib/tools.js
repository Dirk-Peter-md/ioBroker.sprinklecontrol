'use strict';


/**
 * func addTime (02:12:24 + 00:15) || (807) => 02:12:39
 * @param time1 {string|number} z.B. 02:12:24 || 807 => 02:12:39
 * @param time2 {string|number|undefined} z.B. 02:12:24 || 807 => 02:12:39 || undef.
 * @returns {string}
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
        return (h === 0)?(frmt(m) + ':' + frmt(sec)):(frmt(h) + ':' + frmt(m) + ':' + frmt(sec));
    }   //  end function seconds2string

    function string2seconds(n) {
        if(!n || (n === "--:--")) return 0;
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

    function frmt(n) { return n < 10 ? '0' + n : n;}

}   // end - function addTime


/**
 * func Format Time
 * → hier wird der übergebene Zeitstempel, myDate, in das angegebene Format, timeFormat, umgewandelt.
 *   Ist myDate nicht angegeben, so wird die aktuelle Zeit verwendet.
 * @param {ioBroker.Adapter} adapter
 * @param {date|any} myDate
 * @param {string} timeFormat   - 'kW': Rückgabe der KW;
 *                              - 'dayNr': Tag des Jahres (Tagesnummer)
 *                              - 'day': Wochentag
 *                              - 'dd.mm. hh:mm': Rückgabe Datum und Zeit
 *                              - 'past': true => Heute schon vorbei
 * @returns {string|number|boolean}
 */
function formatTime(adapter, myDate, timeFormat) {	// 'kW' 'dd.mm. hh:mm'
    function zweiStellen (s) {
        while (s.toString().length < 2) {s = '0' + s;}
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


    switch (timeFormat) {
        case 'dayNr':   // Berechnung der Tagesnummer
            let start = new Date(d.getFullYear(), 0, 0);
            let diff = (d - start) + ((start.getTimezoneOffset() - d.getTimezoneOffset()) * 60 * 1000);
            let oneDay = 1000 * 60 * 60 * 24;
            return  Math.floor(diff / oneDay);

        case 'kW':	// formatTime('','kW');
            // +1 we start with week number 1
            // +0.5 an easy and dirty way to round result (in combination with Math.floor)
            return Math.floor(1 + 0.5 + (currentThursday.getTime() - firstThursday.getTime()) / 86400000/7);

        case 'day': // Wochentag 0:So;1:Mo;...6:Sa
            return d.getDay();

        case 'dd.mm. hh:mm':
            return tag + '.' + monat + ' ' + stunde + ':' + minute;

        case 'past': // true → Heute schon vorbei
            const cd = new Date();
            const cStunde = zweiStellen(cd.getHours());
            const cMinute = zweiStellen(cd.getMinutes());
            return ((stunde > cStunde) || ((stunde === cStunde) && (minute > cMinute)));

        default:
            adapter.log.info('function formatTime: falsches Format angegeben');
            break;
    }
}

/**
 * TREND - Zwischenwert ermitteln
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


module.exports = {
    addTime,
    formatTime,
    trend
};
