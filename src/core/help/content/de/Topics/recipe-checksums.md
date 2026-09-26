@source-sha 700e7b1f7d94b3dc9c9fcfb8ef794c9bb43511bc47fdb014c77d2d6edce7ab93
# Prüfsummen prüfen und korrigieren

> Eine Struktur, die ihre eigene Prüfsumme trägt, wird abgewiesen, wenn Sie sie ändern und den alten Wert stehen lassen.

Viele Firmware-Strukturen tragen eine [[term:checksum|Prüfsumme]] über ihren eigenen Header oder Rumpf. Ändern Sie ein Byte darin, geht die Prüfsumme nicht mehr auf, und was immer die Struktur liest — die Firmware selbst, ein Flash-Werkzeug, ein Parser — hält sie für beschädigt.

## Im UEFI-Panel

Die [[topic:tool-uefi|UEFI-Struktur]] prüft die Header, während sie sie liest:

- Ein Knoten, dessen Prüfsumme nicht aufgeht, bekommt eine rote Markierung auf seiner Zeile.
- Seine Detailansicht zeigt den Wert, der dort steht, und den, der dort stehen sollte.
- Rechtsklick auf den Knoten ▸ **Prüfsumme korrigieren** schreibt den richtigen Wert. Ein Schreibvorgang, ein Widerrufsschritt, und die Bytes sind rot, bis Sie sichern.

## Was eine nicht aufgehende Prüfsumme wirklich sagt

- **Sie haben innerhalb der Struktur geändert**, was beim Ändern zu erwarten ist — korrigieren Sie sie vor dem Schreiben.
- **Der Dump ist beschädigt**, wenn Sie nichts geändert haben. Eine nicht aufgehende Prüfsumme in einem frischen Dump ist ein Zeichen für ein schlechtes Lesen oder einen wirklich beschädigten Chip. Lesen Sie den Chip erneut, bevor Sie etwas daraus schließen.
- **Die Struktur ist nicht das, wofür der Parser sie hält.** Eine nicht aufgehende Prüfsumme in einer Region, bei der das Panel unsicher ist, kann heißen, dass das Panel sie falsch zugeordnet hat, und nicht, dass die Bytes falsch sind.

## Was „Prüfsumme korrigieren“ nicht kann

Es korrigiert **Prüfsummen** — einfache arithmetische Summen und [[term:crc|CRCs]], die jeder berechnen kann. Es rührt **Signaturen** nicht an: eine kryptografische Signatur über einen Bereich lässt sich ohne den privaten Schlüssel des Herstellers nicht neu berechnen. Liegt der Bereich, den Sie geändert haben, unter [[term:boot-guard|Boot Guard]] oder unter einem ME-[[term:manifest|Manifest]], wird kein Werkzeug die Plattform dazu bringen, Ihre Änderung anzunehmen. Siehe [[topic:bench-safety|Regeln am Arbeitsplatz]].
