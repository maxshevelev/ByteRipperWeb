@source-sha 2042298c2c5ff5e27f8902bc71ca57ac1395409c4402236a8fd7f65d60d74c0c
# UEFI-Struktur

> Die Karte eines Firmware-Images: welche Region, welches Volume, welche Datei und wo.

**Werkzeuge ▸ UEFI-Struktur** liest den geöffneten Dump als Intel/UEFI-Flash-Image und zeigt ihn als Baum. Die Titelzeile über dem Baum sagt, was das Image als Ganzes ist.

## Der Baum

Die oberste Ebene ist die Aufteilung des Chips selbst. Auf einer Intel-Plattform sind das der [[term:flash-descriptor|Flash Descriptor]] und die von ihm definierten [[term:region|Regionen]] — [[term:bios-region|BIOS]], [[term:me-region|ME]], [[term:gbe-region|GbE]], [[term:pdr-region|PDR]], EC. In der BIOS-Region liegen [[term:volume|Firmware-Volumes]], darin [[term:ffs-file|FFS-Dateien]] und darin [[term:section|Sektionen]]. Ein Zweig wird decodiert, wenn er geöffnet wird, und nicht im Voraus.

Die Spalten **Typ** und **Subtyp** benennen jeden Knoten so, wie der Referenz-Parser ihn benennt. Die Spalte **Name** zeigt den Gemeinschaftsnamen für die [[term:guid|GUID]] eines Knotens, sofern es einen gibt, und sonst die GUID selbst.

Die Zeile der **ME-Region** öffnet sich in dieselbe Analyse, die der [[topic:tool-me|ME Analyzer]] liefert — so lässt sich ein Image in einem Baum von vorn bis hinten lesen. Sie öffnet sich, sobald die Region gelesen ist; Werte, die auf eine Datenbank warten, zeigen dort wie im ME Analyzer **Wird geladen…**.

**Die Schaltfläche in Form einer Zielscheibe im rechten Teil der Titelzeile** zeigt im Baum den Knoten unter der Einfügemarke im Dump — den Anfang einer Auswahl, wo es eine gibt. Sie öffnet die Zweige auf dem Weg; ein Zweig, der noch nicht decodiert ist, wird für die Anzeige decodiert, und die Anzeige kann so lange dauern wie das Lesen. Ausgewählt wird der innerste Knoten, dessen Bereich das Byte enthält. Ein Byte der ME-Region wird in einer Zeile ihres Unterbaums gezeigt; die Region wird für die Anzeige geöffnet, wenn sie noch nicht gelesen ist. Der Dump bewegt sich nicht: die Anzeige führt den Baum zum Byte, nicht das Byte zum Baum.

## Was das Werkzeug prüft

- **Prüfsummen.** Ein Header, dessen Prüfsumme nicht aufgeht, wird in seiner Zeile rot markiert, und die Detailliste nennt den gespeicherten und den richtigen Wert. **Prüfsumme korrigieren** im Kontextmenü des Knotens schreibt den richtigen Wert als einen Schreibvorgang und einen Widerrufsschritt.
- **Geschützte Bereiche.** Deklariert das Image geschützte Bereiche von [[term:boot-guard|Boot Guard]], nennt die Übersichtszeile ihre Anzahl. Die Signatur eines solchen Bereichs lässt sich ohne den privaten Schlüssel des Herstellers nicht neu berechnen; siehe [[topic:recipe-checksums|Prüfsummen]].

## Was sich herausholen lässt

Rechtsklick auf einen Knoten:

- Den Knoten **öffnen**, oder nur seinen Rumpf, als [[topic:fragments|Fragment-Bereich]].
- **… sichern unter…** — den Knoten oder nur seinen Rumpf in eine Datei schreiben: dieselben Bytes, die das Öffnen zeigt, unter demselben Namen — dem des Dumps, gefolgt von dem des Knotens. Wohin die Datei gelangt, bestimmt der Browser wie bei jedem Download: in den Download-Ordner oder an die Stelle, nach der er fragt.
- **Entpackten Rumpf öffnen** / **Entpackten Rumpf exportieren…** bei einer komprimierten Sektion — das, wozu diese Bytes sich tatsächlich entfalten. Ein Knoten darin bietet dasselbe für seine eigenen **Bytes**.
- **Zur Top-Swap-Kopie** / **Zum Original** bei einem Knoten in einem der beiden Blöcke eines Images mit [[term:top-swap|Top-Swap]]-Kopie — wählt denselben Knoten im anderen Block aus und zeigt seine Bytes im Dump, sodass sich jedem Teil der Kopie der Teil des obersten Blocks zuordnen lässt, den er wiederholt.

Ein vom Werkzeug erkanntes [[term:picture|Bild]] — JPEG, PNG, GIF oder BMP, im Padding oder als Datenteil einer Raw-Section — erscheint als eigene Zeile; wird sie ausgewählt, zeichnet das Werkzeug das Bild unter den Details: höchstens so breit wie die Liste und nie größer als seine eigene Pixelgröße. Die Vorschau entsteht aus den Bytes des Dumps, wie sie vorliegen, und zwar mit dem Bilddecoder des Browsers, nicht mit dem der Firmware; sie zeigt daher den gespeicherten Inhalt, nicht zwingend genau das, was die Platine daraus macht. Kann der Browser ein Format nicht decodieren, bleiben die Details ohne Vorschau. Ein feiner Rahmen zeigt, wo das Bild endet, damit ein weißes oder transparentes Logo nicht im Hintergrund des Panels verschwindet. Ein Klick auf das Bild wechselt den Hintergrund dahinter: der des Panels, ein Schachbrettmuster oder Schwarz (im dunklen Erscheinungsbild Weiß). Ein Bild mit Transparenz erscheint zunächst auf dem Schachbrett, eines ohne auf dem Hintergrund des Panels.

## Padding

Zwischen den Strukturen eines Dumps liegt gelöschter Raum. Der Baum lässt ihn weg, solange im Filtermenü **Leeres Padding anzeigen** nicht abgehakt ist. Das Menü öffnet das Trichtersymbol in der Titelzeile, links neben **der Schaltfläche in Form einer Zielscheibe**. Solange der Baum etwas anzeigt, das er standardmäßig weglässt, ist das Symbol farbig hervorgehoben. Padding mit Daten wird in jedem Fall aufgeführt, ebenso der freie Speicher eines Volumes, der angibt, wie viel Platz darin noch frei ist.

## Variablenkopien

[[term:vss|VSS]], [[term:nvar|NVAR]] und [[term:dvar|DVAR]] — die [[term:nvram|NVRAM]]-Formate, deren Einträge der Baum zu je einer Zeile pro Variable zusammenfasst — behalten die früheren Kopien einer Variable, bis die Firmware den Speicher bereinigt; auf einem Board, das eine Variable bei jedem Start schreibt, machen sie den größten Teil der Zeilen aus. Die Zeile ist die aktuelle Kopie der Variable oder, für eine Variable, die der Speicher nicht mehr enthält, die Kopie, als die sie gelöscht wurde —, solange im selben Menü **Ersetzte Einträge anzeigen** nicht abgehakt ist. Die übrigen Kopien stehen unter **Verlauf der Variable** in den Details dieser Zeile; ein Klick auf eine Kopie zeigt ihre eigenen Details und ihre Bytes im Dump, und im Baum bleibt die Zeile der geltenden Kopie ausgewählt. Dasselbe geschieht, wenn der Cursor im Dump in einer Kopie steht, die der Baum weglässt, und sie im Baum angezeigt wird.

Siehe auch: [[topic:tool-fit|FIT-Tabelle]], [[term:vss|NVRAM-Speicher]], [[topic:recipe-checksums|Prüfsummen]].
