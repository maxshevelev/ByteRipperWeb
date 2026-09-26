@source-sha 8fb40b8c6a23271db11ca502cf2a2452dd12857bb919fc073b72bd8ef8430096
# Wofür ByteRipper da ist

> Ein Hex-Editor rund um die eine Frage, die ein Reparaturplatz den ganzen Tag stellt: worin unterscheidet sich der Inhalt dieses Chips von dem, der funktioniert?

ByteRipper öffnet eine oder zwei Binärdateien und zeigt jedes Byte darin. Sind zwei Dateien offen, vergleicht es sie **Byte für Byte an derselben Adresse** und färbt jede Stelle, an der sie auseinandergehen.

Das ist die ganze Idee. Am Reparaturplatz ist die Datei meist ein **Dump** — der Inhalt eines BIOS-Chips, eines EC-Chips oder einer ME-Region, mit einem Programmer von der Platine gelesen. Die Frage lautet fast nie „was bedeutet diese Datei“, sondern „was ist an dieser anders als an einer, die startet“.

## Worin es gut ist

- Den Dump einer toten Platine mit dem einer laufenden vergleichen, oder mit einer Spenderdatei aus dem Netz.
- Die paar Bytes finden, die sich zwischen zwei Firmware-Versionen tatsächlich unterscheiden.
- Ein paar Bytes von Hand korrigieren und die Datei für den Programmer wieder ausgeben.
- Ein Firmware-Image auseinandernehmen — seine Regionen, seine Volumes, seine Intel-ME-Partitionen — um zu sehen, was darin ist und ob es unversehrt ist.
- Ein Stück aus einem Dump schneiden (eine Region, ein Modul) und als eigene Datei sichern.

## Was es mit Absicht nicht tut

ByteRipper vergleicht nur nach Adresse. Es sucht nie denselben Byte-Block an einer anderen Adresse und verschiebt nie eine Datei gegen die andere, damit die Unterschiede kleiner aussehen.

Das ist Absicht. Ein Flash-Dump hat eine feste Aufteilung: eine Adresse ist eine Position auf dem Chip, und ein verschobenes Byte ist ein Byte an der falschen Stelle, kein übereinstimmendes. Ein Werkzeug, das zwei Dumps „ausrichtet“, verbirgt genau die Fehler, die zu finden sind.

! ByteRipper spricht nie mit einem Programmer und schreibt nie auf Hardware. Es bearbeitet Dateien. Den Chip zu lesen und wieder zu beschreiben ist Sache Ihres Programmers.

## Wie Sie dieses Buch öffnen

Das **?** in der Symbolleiste öffnet dieselbe kurze Liste wie der Block **Hilfe** in seinem Menü: diese Seite, den ersten Vergleich, die Regeln am Arbeitsplatz und die Glossare. **F1** und **⌘/** öffnen das Buch von überall aus — auch ohne offene Datei und gleich, was die Tastatur hält.

## Wie es weitergeht

- [[topic:first-comparison|Ihr erster Vergleich]] — die fünf Minuten, die zeigen, was dieses Programm ist.
- [[topic:hex-view|Die Hex-Ansicht lesen]] und [[topic:colors|Was die Farben bedeuten]].
- [[topic:tools-overview|Die Werkzeugbereiche]], sobald Sie wissen wollen, was im Image steckt und nicht nur, was sich geändert hat.
- [[topic:bench-safety|Regeln am Arbeitsplatz]] — Wege, einen Dump zu ruinieren, und wie man sie vermeidet.
