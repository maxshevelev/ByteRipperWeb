@source-sha 5c1ee17e97274e59e90d978e000f0f4c8649489fa83f1f8202f8183f4ce4abf3
# UEFI-Struktur

> Die Karte eines Firmware-Images: welche Region, welches Volume, welche Datei und wo.

**Werkzeuge ▸ UEFI-Struktur** liest den geöffneten Dump als Intel/UEFI-Flash-Image und zeigt ihn als Baum. Die Titelzeile über dem Baum sagt, was das Image als Ganzes ist.

## Der Baum

Die oberste Ebene ist die Aufteilung des Chips selbst. Auf einer Intel-Plattform sind das der [[term:flash-descriptor|Flash Descriptor]] und die von ihm definierten [[term:region|Regionen]] — [[term:bios-region|BIOS]], [[term:me-region|ME]], [[term:gbe-region|GbE]], [[term:pdr-region|PDR]], EC. In der BIOS-Region liegen [[term:volume|Firmware-Volumes]], darin [[term:ffs-file|FFS-Dateien]] und darin [[term:section|Sektionen]]. Ein Zweig wird decodiert, wenn er geöffnet wird, und nicht im Voraus.

Die Spalten **Typ** und **Subtyp** benennen jeden Knoten so, wie der Referenz-Parser ihn benennt. Die Spalte **Name** zeigt den Gemeinschaftsnamen für die [[term:guid|GUID]] eines Knotens, sofern es einen gibt, und sonst die GUID selbst.

Die Zeile der **ME-Region** öffnet sich in dieselbe Analyse, die der [[topic:tool-me|ME Analyzer]] liefert — so lässt sich ein Image in einem Baum von vorn bis hinten lesen.

## Was das Werkzeug prüft

- **Prüfsummen.** Ein Header, dessen Prüfsumme nicht aufgeht, wird in seiner Zeile rot markiert, und die Detailliste nennt den gespeicherten und den richtigen Wert. **Prüfsumme korrigieren** im Kontextmenü des Knotens schreibt den richtigen Wert als einen Schreibvorgang und einen Widerrufsschritt.
- **Geschützte Bereiche.** Deklariert das Image geschützte Bereiche von [[term:boot-guard|Boot Guard]], nennt die Übersichtszeile ihre Anzahl. Die Signatur eines solchen Bereichs lässt sich ohne den privaten Schlüssel des Herstellers nicht neu berechnen; siehe [[topic:recipe-checksums|Prüfsummen]].

## Was sich herausholen lässt

Rechtsklick auf einen Knoten:

- Den Knoten **öffnen**, oder nur seinen Rumpf, als [[topic:fragments|Fragment-Bereich]].
- **Entpackten Rumpf öffnen** / **Entpackten Rumpf exportieren…** bei einer komprimierten Sektion — das, wozu diese Bytes sich tatsächlich entfalten. Ein Knoten darin bietet dasselbe für seine eigenen **Bytes**.

## Padding

Zwischen den Strukturen eines Dumps liegt gelöschter Raum. Der Baum lässt ihn weg, solange **Leeres Padding anzeigen** nicht angekreuzt ist. Padding mit Daten wird in jedem Fall aufgeführt, ebenso der freie Speicher eines Volumes, der angibt, wie viel Platz darin noch frei ist.

Siehe auch: [[topic:tool-fit|FIT-Tabelle]], [[term:vss|NVRAM-Speicher]], [[topic:recipe-checksums|Prüfsummen]].
