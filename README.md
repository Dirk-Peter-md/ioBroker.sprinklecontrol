![Logo](admin/sprinklecontrol.png)
# ioBroker.sprinklecontrol



![Number of Installations](http://iobroker.live/badges/sprinklecontrol-installed.svg) 
![Number of Installations](http://iobroker.live/badges/sprinklecontrol-stable.svg)
[![NPM version](http://img.shields.io/npm/v/iobroker.sprinklecontrol.svg)](https://www.npmjs.com/package/iobroker.sprinklecontrol)
[![Downloads](https://img.shields.io/npm/dm/iobroker.sprinklecontrol.svg)](https://www.npmjs.com/package/iobroker.sprinklecontrol)
[![Known Vulnerabilities](https://snyk.io/test/github/Dirk-Peter-md/ioBroker.sprinklecontrol/badge.svg)](https://snyk.io/test/github/Dirk-Peter-md/ioBroker.sprinklecontrol)
![Test and Release](https://github.com/Dirk-Peter-md/ioBroker.sprinklecontrol/workflows/Test%20and%20Release/badge.svg)
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
### 0.2.15 (2025-06-01)
* (Dirk-Peter-md) Readme updated
* (Dirk-Peter-md) Fixed an error when switching off with autoOnOff
* (Dirk-Peter-md) ioBroker-Bot [W028]

### 0.2.14 (2025-03-15)
* (Dirk-Peter-md) eslint-config added
* (Dirk-Peter-md) Dependencies updated
* (Dirk-Peter-md) Update License
* (Dirk-Peter-md) issue #92 Sprinkler im Gewächshaus solved
* (Dirk-Peter-md) add Button control.autoStart

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

## License
MIT License

Copyright (c) 2020 - 2025     Dirk Peter     <dirk.peter@freenet.de>

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
