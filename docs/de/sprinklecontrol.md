## Sprinklercontrol ist ein Adapter zur automatischen Steuerung der Gartenbewässerung.
# Grundlegendes


In Sprinklecontroll werden die Umweltdaten (Temperatur, Luftfeuchtigkeit, Helligkeit, Windgeschwindigkeit, Regenmenge) ausgewertet.
Die so ermittelte Verdunstung dient der Ermittlung der theoretischen Bodenfeuchte, der einzelnen Bewässerungskreise.
Zu einer unter "Zeit-Einstellungen" festgelegten Zeit, werden die Bewässerungskreise aktiviert die einen festgelegten prozentualen Wert unterschreiten.
Diese verschiedenen Bewässerungskreise werden dann so angesteuert, das die max. Pumpenleistung (l/h) und die max. Anzahl der Bewässerungskreise nicht überschritten wird.
Beides ist individuell anpassbar.
      
Meine Bewässerung arbeitet mit dem Homematic IP Wettersensor plus (HmIP-SWO-PL) und wurde nur mit diesem getestet.




## Installation
Der Adapter befindet sich auf GitHub (https://github.com/Dirk-Peter-md/ioBroker.sprinklecontrol). Von hier kann er heruntergeladen werden. 
Um ihn installieren zu können muss man in den Adapter von ioBroker gehen und dort "Installieren aus eigener URL" anklicken. 
Unter beliebig kann dann der URL Pfad (https://github.com/Dirk-Peter-md/ioBroker.sprinklecontrol) eingegeben werden.


Spätestens nach Refresh der Adapterliste steht der Adapter **Sprinklecontrol** zur Verfügung.

Nach anklicken des (+) wird eine Instanz angelegt und die notwendigen Daten des Adapters vom Repository geladen:

# Konfiguration - Haupteinstellungen
Sollte in dem Installationsfenster die Checkbox "***schließen wenn fertig***" nicht angehakt sein muss man dieses natürlich noch schließen.

Das Konfigurationsfenster besteht aus drei Reitern:
* Haupteinstellungen
* Pumpeneinstellungen
* Zeit-Einstellungen
* Extra-Einstellungen

Das Konfigurationsfenster öffnet sich automatisch mit den Haupteinstellungen

![main.png](img/main.png)

Auf dieser Seite ist eine Beispiel-ID abgelegt.
Diese bitte löschen und anschließend die eigenen IDs durch anklicken des (+) links oben über der Tabelle die eigenen Sprinkleraktoren hinzufügen.

Dabei bitte die Datenpunkte mit STATE (o.ä.) auswählen. NICHT das Gerät als solches.


![Select_ID.jpg](img/Select_ID.jpg)

Nach Abschluß der ID-Auswahl ist der Adapter bereits betriebsbereit, aber noch nicht an die eigenen Wünsche angepasst.

### Aufbau der Tabelle

![main_tab.jpg](img/main_tab.jpg)

**Nr**:  fortlaufende Nummer der gelisteten Bewässerungskreise

**Aktiv**: Checkbox zur Aktivierung der Steuerung des entsprechenden Bewässerungskreises

**Name**: Name des Aktors; wird bei der Auswahl der ID automatisch aus den Objekten eingelesen. Dieser Name des Aktors kann individuell angepasst werden. Es dürfen aber keine Duplikate vorkommen.

**Objekt-ID-Sprinkler**: Eindeutige ID des zu steuernden Datenpunkts in den Objekten

**(+)**: Hinzufügen/Ändern der ID

**Bleistift**: spezifische Konfiguration des jeweiligen Rollladens

**Pfeile**: verändern der Reihenfolge der verschiedenen Rollläden

**Mülleimer**: Löschen der ID mit allen Konfigurierten Daten!


## individuelle Konfiguration eines Bewässerungskreises
Auch diese Konfigurationsebene besteht aus zwei Reitern: **Haupteinstellungen** und **Pumpeneinstellungen**

---

### Haupteinstellungen

![Vertil-Haupteinstellung.jpg](img/Vertil-Haupteinstellung.jpg)

* **Bewässerungsdauer:** Einstellung der Zeit zum Bewässern (diese wird verlängert je weiter der Trigger "niedrigster Prozentsatz der Bodenfeuchte" unterschritten wurde) 
* **maximale Bewässerungsverlängerung in %:** Begrenzung der Bewässerungsdauer in Prozent (100 % = Bewässerungsdauer wird nicht verlängert )
* **Bewässerungsintervall:** Die Bewässerungsdauer wird in einem Intervall aufgeteilt. (z.B. 5 min an, 5 min aus, 5 min an, usw.)
    * **Tipp:** Bei mir habe ich ein Rasengitter bei der Autoauffahrt. Hier läuft das Wasser beim Bewässern einfach nur die Schräge herunter. Durch die Bewässerung in Intervallen konnte ich dem entgegenwirken. 
* **niedrigster Prozentsatz der Bodenfeuchte:** Auslösetrigger: Wenn dieser Wert unterschritten wird, so beginnt zum Startzeitpunkt die Bewässerung.
* **Bedenfeuchte = 100 % nach der Bewässerung:** Bei Aktivierung, wird die Bodenfeuchte nach der Bewässerung auf 100 % gesetzt. Ansonsten bleibt sie knapp darunter Aufgrund der Verdunstung während der Bewässerung.
* **maximale Bewässerung nach der Bewässerung:** Max. Wassergehalt im Boden nach der Bewässerung.
    * **Tipp:** Rasengitter: 5; Blumenbeet: 8; Rasenfläche: 12
* **maximale Bodenfeuchte nach einem Regen:** Max. Wassergehalt im Boden nach einem kräftigen Regen.
    * **Tipp** Rasengitter: 6; Blumenbeet: 10; Rasenfläche: 15
    
---

### Pumpeneinstellungen

![Ventil-Pumpeneinstellung.jpg](img/Ventil-Pumpeneinstellung.jpg)

* **Durchflussmenge:** Ermittelte Durchflussmenge des aktuellen Bewässerungskreises.
    * **Tipp:** Steht oft in der Bedienungsanleitung bzw. im Internet.
* **Booster:** Nimmt alle aktiven Bewässerungskreise für 15 s vom Netz und schaltet sie danach wieder zu. 
    * **Tipp:** Meine Pumpe liefert max. 1800 l/h und meine Rasenspränger benötigen 1400 l/h, aber den vollen Druck zum herausfahren. Mit der Boosterfunktion kann ich nebenbei noch die Koniferen bewässern die nur 300 l/h benötigen. 
    * **Achtung:** Mit dieser Funktion sollte man sehr sparsam umgehen, da immer nur ein Bewässerungskreis mit aktiven Booster bewässern kann.    

---
---

# Konfiguration - Pumpen-Einstellungen
Hier werden die Einstellung der Hauptpumpe und der Spannungsversorgung der Regelkreise vorgenommen.

![Pumpeneinstellung.jpg](img/Pumpeneinstellung.jpg)

* **Einstellung der Ventile**

    * **Rollladenhöhe beim runterfahren:**
    * **Maximaler Parallelbetrieb der Ventile**
    
* **Einstellung der Pumpe:**
    * **Hauptpumpe**
    * **maximale Pumpenleistung der Hauptpumpe in  l/h**

* **Zisternenpumpe als Prioritätspumpe hinzufügen** (noch nicht programmiert, aber in Planung)
    * **Zisternenpumpe** (noch nicht programmiert, aber in Planung)
    * **maximale Pumpenleistung der Zisterne in l / h** (noch nicht programmiert, aber in Planung)
    * **Höhe der Zisterne** (noch nicht programmiert, aber in Planung)
    * **Mindestfüllstand der Zysten in%** (noch nicht programmiert, aber in Planung)

---
---

# Konfiguration - Zeit-Einstellungen
In diesem Abschnitt werden die Startzeiten von Sprinklercontrol festgelegt

![Zeiteinstellung.jpg](img/Zeiteinstellung.jpg)

## Startzeit für die Bewässerung

* **Beginnen Sie mit einer festen Startzeit**
    * **Startzeit in der Woche**
* **Startzeit bei Sonnenaufgang**
    * **Zeitverschiebung**
* **Startzeit am Ende der goldenen Stunde**

---
* **andere Startzeit am Wochenende**
    * **Startzeit am Wochenende**
    * **Startzeit der Feiertage wie am Wochenende**
        * **Feiertage Instanz**

---
---

# Konfiguration - Zusätzliche-Einstellungen

In den Extra-Einstellungen werden verschiedene Einstellungen eingegeben, die bei der Berechnung der Verdunstung unerlässlich sind.

![Extraeinstellungen.jpg](img/Extraeinstellungen.jpg)

## Astro-Einstellungen
Diese Einstellungen sind eigentlich selbsterklärend: Breiten- und Längengrad des Wohnorts um den Sonnenstand korrekt berechnen zu können.

* **Breitengrad:** Hier kann ein Offset eingegeben werden um den sich die Rollladenfahrten für hoch bzw. runter von den später ausgewählten Astro-Events verschieben soll.

* **Längengrad** Damit nicht alle Rollläden gleichzeitig fahren, kann hier eine Zeit in Sekunden für eine Verzögerung eingestellt werden.


## Debug-Einstellungen

* **debuggen** 

## Verdunstungsberechnungssensoren

* **Temperatursensor**
* **Feuchtigkeitssensor**
* **Windgeschwindigkeitssensor**
* **Helligkeitssensor**
* **Regensensor**