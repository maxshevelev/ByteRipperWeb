@source-sha 63a3a5f1d3517e3162f59a8e99a2c47cbc98ee9ccf33138c121c349cd2a72757
# UEFI-Struktur

> Die Karte eines Firmware-Images: welche Region, welches Volume, welche Datei und wo.

**Werkzeuge ▸ UEFI-Struktur** liest den geöffneten Dump als Intel/UEFI-Flash-Image und zeigt ihn als Baum. Die Titelzeile über dem Baum sagt, was das Image als Ganzes ist.

## Der Baum

Die oberste Ebene ist die Aufteilung des Chips selbst. Auf einer Intel-Plattform sind das der [[term:flash-descriptor|Flash Descriptor]] und die von ihm definierten [[term:region|Regionen]] — [[term:bios-region|BIOS]], [[term:me-region|ME]], [[term:gbe-region|GbE]], [[term:pdr-region|PDR]], EC. In der BIOS-Region liegen [[term:volume|Firmware-Volumes]], darin [[term:ffs-file|FFS-Dateien]], darin [[term:section|Sektionen]]; der Baum öffnet einen Zweig, sobald Sie danach fragen.

Die Spalten **Typ** und **Subtyp** benennen jeden Knoten so, wie der Referenz-Parser ihn benennt. Die Spalte **Name** zeigt den Gemeinschaftsnamen für die [[term:guid|GUID]] eines Knotens, sofern es einen gibt, und sonst die GUID selbst.

Die Zeile der **ME-Region** öffnet sich in dieselbe Analyse, die der [[topic:tool-me|ME Analyzer]] liefert — so lässt sich ein Image in einem Baum von vorn bis hinten lesen.

## Was das Panel prüft

- **Prüfsummen.** Ein Header, dessen Prüfsumme nicht aufgeht, bekommt eine rote Markierung, und die Detailansicht sagt, welchen Wert er haben sollte. Rechtsklick auf den Knoten für **Prüfsumme korrigieren** — ein Schreibvorgang, ein Widerrufsschritt.
- **Geschützte Bereiche.** Deklariert das Image geschützte Bereiche von [[term:boot-guard|Boot Guard]], sagt die Übersichtszeile, wie viele. Die Bytes darin gehören nicht Ihnen.

## Was sich herausholen lässt

Rechtsklick auf einen Knoten:

- Den Knoten **öffnen**, oder nur seinen Rumpf, als [[topic:fragments|Fragment-Bereich]].
- **Entpackten Rumpf öffnen** / **Entpackten Rumpf exportieren…** bei einer komprimierten Sektion — das, wozu diese Bytes sich tatsächlich entfalten. Ein Knoten darin bietet dasselbe für seine eigenen **Bytes**.

## Padding

Ein Dump ist voll gelöschten Raums zwischen den Strukturen. Der Baum lässt ihn weg, bis Sie **Leeres Padding anzeigen** ankreuzen: Padding mit Daten wird immer aufgeführt, und der freie Speicher eines Volumes ebenso, denn er sagt, wie viel Platz noch darin ist.

Siehe auch: [[topic:tool-fit|FIT-Tabelle]], [[term:vss|NVRAM-Speicher]], [[topic:recipe-checksums|Prüfsummen prüfen und korrigieren]].
