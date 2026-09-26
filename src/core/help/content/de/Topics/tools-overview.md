@source-sha b3112a4bcd7f3ece8567a9bd03137e06a9d65b1484c80d3b8593953f7a218f9e
# Die Werkzeugbereiche

> Werkzeuge, die den geöffneten Dump lesen und sagen, was darin ist.

Das Menü **Werkzeuge** schaltet jeweils ein Panel neben dem Dump ein. Jedes liest die Datei seines Bereichs und zeigt seine eigene Sicht darauf:

- **[[topic:tool-uefi|UEFI-Struktur]]** — die Aufteilung eines Firmware-Images: die Flash-Regionen, die Volumes, die Dateien und Sektionen darin, die NVRAM-Speicher.
- **[[topic:tool-me|ME Analyzer]]** — was für eine Intel-Management-Engine-Firmware im Image steckt: ihre Version, ihre Partitionen, ihre Konfiguration.
- **[[topic:tool-fit|FIT-Tabelle]]** — die Firmware Interface Table und ob ihre Einträge noch auf das zeigen, was sie behaupten.
- **[[topic:tool-zones|Zonen-Skizze]]** — die Bereiche eines unbekannten Images von Hand markieren.

## Was sie gemeinsam haben

- **Ein Panel ist an einen Bereich gebunden.** In einem Vergleich nennt sein Kopf die Datei, die es liest, und dort gibt es ein Klappmenü, um es auf die andere zu bewegen. In den anderen Bereich zu klicken bewegt es **nicht**: ein Werkzeug liest weiter die Datei, für die es geöffnet wurde.
- **Sie lesen im Hintergrund.** Das Zerlegen eines 16-MB-Images blockiert den Arbeitsbereich nie — es läuft in einem eigenen Worker; eine Fortschrittszeile meldet es, und es lässt sich abbrechen.
- **Einen Knoten auszuwählen zeigt seine Bytes.** Klicken Sie eine Zeile, springt der Dump zu den Bytes, für die sie steht, und umreißt sie als **Zone**. Das ist die Verbindung zwischen einem Namen im Panel und einer Adresse in der Hex-Ansicht, und deshalb lohnen sich die Panels am Arbeitsplatz.
- **Sie sagen, worin sie unsicher sind.** Ein Feld, das niemand dokumentiert hat, behält seinen rohen Wert und heißt unbekannt, statt einen selbstsicheren Namen zu bekommen. Siehe [[topic:provenance|Woher dieses Wissen stammt]].
- **Die Zeilenmarkierungen** — die Balken, Abzeichen und Warnzeichen — erklärt der Streifen **Legende** unter der Tabelle jedes Panels.

## Ein Stück herausholen

Klicken Sie einen Knoten mit rechts an, lässt er sich als [[topic:fragments|Fragment-Bereich]] öffnen: die Bytes des Knotens als eigenes Dokument über dem Image, aus dem sie stammen. So wird ein einzelnes Modul, eine Region oder eine entpackte Sektion herausgeholt, untersucht und zurückgeschrieben.
