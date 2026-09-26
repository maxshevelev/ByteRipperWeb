@source-sha 23abc9023c1f7afb854f2549bf79a5c1e7a35b483a2bd32132679acd7066c164
# Regeln am Arbeitsplatz

> Wege, einen Dump zu ruinieren (und wie man sie vermeidet).

## Bewahren Sie das Original

Sichern Sie den ursprünglichen Dump, vom Chip gelesen, genau so, wie er vom Programmer kam, und ändern Sie diese Datei nie. Arbeiten Sie mit einer Kopie — oder nehmen Sie **Ablage ▸ Duplizieren** und ändern Sie das Duplikat. Ein Chip, der einen Fehler in der Spannungsversorgung hinter sich hat, übersteht ein zweites Lesen vielleicht nicht.

## Ändern Sie nie die Länge eines Flash-Images

Die Kapazität eines Chips ist fest. Jede Adresse in einem Firmware-Image ist absolut: der Descriptor nennt Regionsgrenzen, die [[term:fit|FIT]] zeigt über Adressen auf Microcode, eine Signatur deckt einen festen Bereich ab.

Überschreiben und Füllen sind vergleichsweise sicher: Sie ändern die Länge nicht. „Einsetzen mit Verschieben“, „Bytes löschen“ und der Einfügemodus sind es bei einem Dump nicht — deshalb fragt das Programm vor jedem davon. Prüfen Sie vor dem Flashen die Dateigröße in der Statuszeile gegen die Kapazität des Chips.

## Denken Sie an das, was platinenspezifisch ist

Ein Spenderdump aus dem Netz kann die Identität des Spenders tragen. Schreiben Sie ihn roh, kommt die Platine mit fremder MAC-Adresse, fremder Seriennummer und fremder Maschinen-UUID hoch. Er kann sie aber auch gar nicht tragen: In Dumps, die im Netz geteilt werden, ist der [[term:dmi|DMI]]-Bereich oft gelöscht, damit keine fremden Daten mitreisen — und mit leeren Feldern funktionieren Garantieabfrage und OEM-Aktivierung nicht mehr. Siehe [[topic:recipe-board-data|Platinenspezifische Daten bewahren]].

## Signierte und gesperrte Regionen

Moderne Intel-Plattformen prüfen Teile des Images, bevor die CPU sie ausführt, und der Descriptor kann Regionen gegen Schreiben sperren.

- Hat das Image geschützte Bereiche von [[term:boot-guard|Boot Guard]], sagt das [[topic:tool-uefi|UEFI-Panel]] es in seiner Übersichtszeile. Bytes darin lassen sich nicht ändern, ohne dass die Plattform den Start verweigert: die Signaturprüfung schlägt fehl, und die Signatur neu berechnen können Sie nicht.
- Die [[term:me-region|ME-Region]] prüft die Engine selbst, auf dem Die des [[term:pch|Chipsatzes]]. Sie von Hand zu ändern bringt nichts: die Engine nimmt die geänderte Region nicht an, und statt einer Platine mit geänderter ME bekommen Sie eine, die hängt oder im Takt neu startet.
- Die [[term:flash-master|Master]]-Rechte im Descriptor entscheiden, was **über den Chipsatz** geschrieben werden kann — von einem Werkzeug wie Intel FPT (Flash Programming Tool) oder einem BIOS-Update des Herstellers. Ein Programmer, der am Chip selbst hängt, geht am Chipsatz vorbei und wird nicht gefragt. Ausführlich: [[topic:flash-writes|Wer in den Flash schreibt]].

Das vor dem Ändern zu wissen ist der Unterschied zwischen einer Fünf-Minuten-Reparatur und einem Briefbeschwerer.

## Prüfen Sie vor dem Schreiben

1. Kein Rot mehr — jede Änderung ist gesichert ([[topic:saving|Sichern]]).
2. Die Dateigröße entspricht exakt der Kapazität des Chips.
3. Haben Sie einen Header geändert, stimmt seine Prüfsumme; das [[topic:tool-uefi|UEFI-Panel]] markiert falsche und kann sie korrigieren.
4. Vergleichen Sie die geänderte Datei ein letztes Mal mit dem ursprünglichen Dump ([[topic:first-comparison|Vergleich]]) und sehen Sie sich jeden Unterschied an. Jeder sollte eine Änderung sein, die Sie so wollten.
