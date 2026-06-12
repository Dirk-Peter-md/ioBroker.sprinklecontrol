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

### **WORK IN PROGRESS**
 * (Dirk-Peter-md) Fixed error in "Command without response"
 * (Dirk-Peter-md) Water Pressure Control Revised
 * (Dirk-Peter-md) ioBroker-Bot [E6004], [W1127], [W1133], [W1134], [S6022] completed

### 1.0.7 (2026-05-24)
* (Dirk-Peter-md) Added pressure monitoring.

### 1.0.6 (2026-05-10)
* (Dirk-Peter-md) Cistern Control Optimized
* (Dirk-Peter-md) Translation revised

### 1.0.5 (2026-05-03)
* (Copilot) Adapter benötigt jetzt node.js >= 22
* (Dirk-Peter-md) Second start time added
* (Dirk-Peter-md) bug fixed in sprinklerState

### 1.0.4 (2026-04-26)
* (Dirk-Peter-md) GitHub error message #274

### 1.0.3 (2026-04-25)
* (Dirk-Peter-md) Pressure relief valve added after irrigation.

### CHANGELOG_OLD
[CHANGELOG_OLD.md](CHANGELOG_OLD.md)

*************************************************************************************************************************************

## License
[MIT License](LICENSE)

Copyright (c) 2020-2026       Dirk-Peter-md     <dirk.peter@freenet.de>

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
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.