![Logo](admin/sprinklecontrol.png)
# ioBroker.sprinklecontrol



![Number of Installations](http://iobroker.live/badges/sprinklecontrol-installed.svg) 
![Number of Installations](http://iobroker.live/badges/sprinklecontrol-stable.svg)
[![NPM version](http://img.shields.io/npm/v/iobroker.sprinklecontrol.svg)](https://www.npmjs.com/package/iobroker.sprinklecontrol)
[![Downloads](https://img.shields.io/npm/dm/iobroker.sprinklecontrol.svg)](https://www.npmjs.com/package/iobroker.sprinklecontrol)
[![Known Vulnerabilities](https://snyk.io/test/github/Dirk-Peter-md/ioBroker.sprinklecontrol/badge.svg)](https://snyk.io/test/github/Dirk-Peter-md/ioBroker.sprinklecontrol)
[![NPM](https://nodei.co/npm/iobroker.sprinklecontrol.png?downloads=true)](https://nodei.co/npm/iobroker.sprinklecontrol/)


## sprinklecontrol adapter for ioBroker

This adapter controls individual irrigation circuits in the garden. Depending on the weather and soil conditions, they start working at a specific time or at sunrise, as specified in the configuration.

Wetterabhängige automatische Steuerung der Gartenbewässerung

[Deutsche Beschreibung hier](docs/de/sprinklecontrol.md)

[English Description here](docs/en/sprinklecontrol.md)

[Deutsche Beschreibung auf GitHub](https://github.com/Dirk-Peter-md/ioBroker.sprinklecontrol/blob/master/docs/de/sprinklecontrol.md)

*************************************************************************************************************************************


## Changelog

<!--
  Placeholder for the next version (at the beginning of the line):
  ### **WORK IN PROGRESS**
-->
### 0.2.13 (2022-09-06)
* (Dirk-Peter-md) various bugs fixed
* (Dirk-Peter-md) Preparing the stable release

### 0.2.12 (2022-07-17)
* (Dirk-Peter-md) fixDay(twoNd,threeRd) => postpone by one day
* (Dirk-Peter-md) Bug fixed => autoOn
* (Dirk-Peter-md) Additional post-watering => in case of high evaporation / switchable externally

### 0.2.11 (2022-05-22)
* (Dirk-Peter-md) Bug fixed => analog soil moisture sensor with negative characteristic
* (Dirk-Peter-md) Attention => maximum soil moisture in rain now in %

### 0.2.10 (2022-05-15)
* (Dirk-Peter-md) manual watering limited to a maximum of 100%
* (Dirk-Peter-md) Error whatsapp message fixed

### 0.2.9 (2022-04-10)
* (Dirk-Peter-md) Bug-Initialisierungsroutine

### 0.2.8 (2022-03-20)
* (Dirk-Peter-md) Adaptation for js controller 4
* (Dirk-Peter-md) switched main.js to async

### 0.2.7 (16.10.2021)
* (Dirk-Peter-md) zusätzliche Testnachrichten gelöscht, Readme aktualisiert

### 0.2.6 (03.10.2021)
* (Dirk-Peter-md) inGreenhouse in Bewässerungsverfahren "Calculation" hinzugefügt

### 0.2.5 (18.08.2021)
* (Dirk-Peter-md) Mehrfachverwendung von Bodenfeuchte-Sensoren
* (Dirk-Peter-md) Objekte mit \"def\": ... überarbeitet

### 0.2.4 (16.08.2021)
* (Dirk-Peter-md) Triggerpunktanzeige hinzufügen
* (Dirk-Peter-md) Fehler in der Bodenfeuchteanalyse behoben

### 0.2.3 (15.08.2021)
* (Dirk-Peter-md) index_m-Fehler behoben
* (Dirk-Peter-md) timeExtension (FixDay, bistabil) Fehler behoben

### 0.2.2 (27.07.2021)
* (Dirk-Peter-md) Fehler FixDay behoben
* (Dirk-Peter-md) Anzeige actualSoilMoisture überarbeitet
* (Dirk-Peter-md) Infomeldungen überarbeitet

### 0.2.1 (13.07.2021)
* (Dirk-Peter-md) Start an festen Wochentagen (ohne Sensoren) hinzugefügt
* (Dirk-Peter-md) Fehler behoben

### 0.2.0 (03.07.2021)
* (Dirk-Peter-md) Bodenfeuchte-Sensor hinzugefügt
* (Dirk-Peter-md) Schwellwert für Wettervorhersage hinzugefügt

### 0.1.7 (22.05.2021)
* (Dirk-Peter-md) Beschreibung in englischer Sprache hinzugefügt
* (Dirk-Peter-md) bereit für stable

### 0.1.5 (05.05.2021)
* (Dirk-Peter-md) Zurücksetzen der Regenmenge im 24-Stunden-Modus hinzugefügt

### 0.1.4 (21.04.2021)
* (Dirk-Peter-md) Fehler bei deaktivierter Wettervorhersage behoben

### 0.1.2 (30.12.2020)
* (Dirk-Peter-md) Beschreibung von SprinkleControl überarbeitet

### 0.0.12 (10.10.2020)
* (Dirk-Peter-md) Bewässerung über eine 2. Pumpe (Zisterne mit Vorrangschaltung) in abhängigkeit vom Füllstand hinzugefügt.


*************************************************************************************************************************************

## License
MIT License

Copyright (c) 2022 Dirk Peter <dirk.peter@freenet.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NON INFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
