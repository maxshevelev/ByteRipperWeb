@source-sha c87a2b736d8c6c768a558080adc45e6ebb135996ad622774f258b795983a112c
# Zusammenfügen und Duplizieren

> Die Dumps zweier Chips zu einem Image, und eine Vorher-Kopie zum Ändern.

## Zusammenfügen: die Dumps zweier SPI-Chips zu einem Image

Bei vielen Platinen ist das BIOS auf zwei SPI-Flash-Chips verteilt. Lesen Sie beide, dann:

- **Ablage ▸ Datei anhängen…** — die Bytes der gewählten Datei kommen hinter den Inhalt des Bereichs.
- **Ablage ▸ Datei am Anfang einfügen…** — sie kommen davor.

Jetzt ist das ganze BIOS ein Image, und alles arbeitet damit normal: der Vergleich, die Suche, das [[topic:tool-uefi|UEFI-Panel]], das ein zusammenhängendes Image erwartet.

Die Naht ist als [[topic:segments|Segmentschnitt]] festgehalten, sodass **Alle als einzelne Dateien sichern** Ihnen die beiden Hälften an derselben Grenze zurückgibt, bereit für je ihren Chip. — in einen gewählten Ordner, wo der Browser das erlaubt, und als ZIP, wo nicht.

Daraus folgen zwei Dinge, die gut zu wissen sind:

- **Das zusammengefügte Dokument hat keine Datei.** Es ist unbenannt, ⌘S fragt also, wohin damit, und kann keine der Hälften versehentlich überschreiben.
- **Das Zusammenfügen ist ein Widerrufsschritt.** ⌘Z entfernt die hinzugefügten Bytes *und* bindet den Bereich wieder an die Datei, aus der er geöffnet wurde.

## Duplizieren: eine Kopie des Dumps, wie er war

**Ablage ▸ Duplizieren** kopiert den Inhalt des Bereichs als neues, ungesichertes Dokument in den freien Bereich. Verfügbar im Einzeldatei-Modus, wo es einen freien Bereich gibt.

Das ist der schnellste Weg, mit Netz zu arbeiten: duplizieren, die Kopie ändern und beim Tippen zusehen, wie die Unterschiede neben dem Original erscheinen. Am Ende sichern Sie die Hälfte, die stimmt.
