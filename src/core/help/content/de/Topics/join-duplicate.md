@source-sha 606ce65ca93c9fb0f287e457607e0243b62b132ba2e8078cc9198cd64156db6c
# Zusammenfügen und Duplizieren

> Die Dumps zweier Bausteine zu einem Image zusammenfügen und ein Image duplizieren, um die Kopie zu bearbeiten.

## Zusammenfügen: die Dumps zweier SPI-Chips zu einem Image

Bei Platinen, deren Firmware in zwei SPI-Flash-Bausteinen liegt, werden beide gelesen und die erste Datei geöffnet. Dann:

- **Ablage ▸ Datei anhängen…** — die Bytes der gewählten Datei kommen hinter den Inhalt des Bereichs.
- **Ablage ▸ Datei am Anfang einfügen…** — sie kommen davor.

Die gesamte Firmware ist dann ein Image, mit dem der Vergleich, die Suche und das [[topic:tool-uefi|UEFI-Werkzeug]] — das ein zusammenhängendes Image erwartet — normal arbeiten.

Die Grenze ist als [[topic:segments|Segmentschnitt]] festgehalten, sodass **Alle als einzelne Dateien sichern** die beiden Hälften genau an dieser Grenze zurückgibt — in einen gewählten Ordner, wo der Browser das erlaubt, und als ZIP, wo nicht.

Daraus folgen zwei Dinge, die gut zu wissen sind:

- **Das zusammengefügte Dokument hat keine Datei.** Es ist unbenannt, ⌘S fragt also, wohin damit, und kann keine der Hälften versehentlich überschreiben.
- **Das Zusammenfügen ist ein Widerrufsschritt.** ⌘Z entfernt die hinzugefügten Bytes *und* bindet den Bereich wieder an die Datei, aus der er geöffnet wurde.

## Duplizieren: eine Kopie des Dumps, wie er war

**Ablage ▸ Duplizieren** kopiert den Inhalt des Bereichs als neues, ungesichertes Dokument in den freien Bereich. Der Befehl steht im Einzeldatei-Modus zur Verfügung, in dem ein freier Bereich vorhanden ist.

Die Kopie wird bearbeitet, während die Ausgangsdatei daneben geöffnet bleibt, und der Vergleich weist jede Änderung beim Tippen als Unterschied aus. Gesichert werden kann jedes der beiden Dokumente.
