@source-sha bb483b0a4c80935c9bb4e9f2ad2a3880e23b9f14f48cac1f420c8a483405999c
# UEFI-Struktur

> Die Karte eines Firmware-Images: welche Region, welches Volume, welche Datei und wo.

**Werkzeuge ▸ UEFI-Struktur** liest den geöffneten Dump als Intel/UEFI-Flash-Image und zeigt ihn als Baum. Die Titelzeile über dem Baum sagt, was das Image als Ganzes ist.

## Der Baum

Die oberste Ebene ist die Aufteilung des Chips selbst. Auf einer Intel-Plattform sind das der [[term:flash-descriptor|Flash Descriptor]] und die von ihm definierten [[term:region|Regionen]] — [[term:bios-region|BIOS]], [[term:me-region|ME]], [[term:gbe-region|GbE]], [[term:pdr-region|PDR]], EC. In der BIOS-Region liegen [[term:volume|Firmware-Volumes]], darin [[term:ffs-file|FFS-Dateien]] und darin [[term:section|Sektionen]]. Ein Zweig wird decodiert, wenn er geöffnet wird, und nicht im Voraus.

Die Spalten **Typ** und **Subtyp** benennen jeden Knoten so, wie der Referenz-Parser ihn benennt. Die Spalte **Name** zeigt den Gemeinschaftsnamen für die [[term:guid|GUID]] eines Knotens, sofern es einen gibt, und sonst die GUID selbst.

Die Zeile der **ME-Region** öffnet sich in dieselbe Analyse, die der [[topic:tool-me|ME Analyzer]] liefert — so lässt sich ein Image in einem Baum von vorn bis hinten lesen. Sie öffnet sich, sobald die Region gelesen ist; Werte, die auf eine Datenbank warten, zeigen dort wie im ME Analyzer **Wird geladen…**.

**Die Schaltfläche in Form einer Zielscheibe im rechten Teil der Titelzeile** zeigt im Baum den Knoten unter der Einfügemarke im Dump — den Anfang einer Auswahl, wo es eine gibt. Sie öffnet die Zweige auf dem Weg; ein Zweig, der noch nicht decodiert ist, wird für die Anzeige decodiert, und die Anzeige kann so lange dauern wie das Lesen. Ausgewählt wird der innerste Knoten, dessen Bereich das Byte enthält. Ein Byte der ME-Region wird in einer Zeile ihres Unterbaums gezeigt; die Region wird für die Anzeige geöffnet, wenn sie noch nicht gelesen ist. Der Dump bewegt sich nicht: die Anzeige führt den Baum zum Byte, nicht das Byte zum Baum.

Eine lange Tabelle in den Details — **PCH-Straps** in den Details des [[term:flash-descriptor|Flash Descriptors]] — ist zunächst unter ihrer Überschrift eingeklappt, damit der Rest der Details sichtbar bleibt. Ein Klick auf das Dreieck oder die Überschrift klappt sie auf; sie bleibt danach auch bei anderen Knoten aufgeklappt, bis das Programm beendet wird.

## Was das Werkzeug prüft

- **Prüfsummen.** Ein Header, dessen Prüfsumme nicht aufgeht, wird in seiner Zeile rot markiert, und die Detailliste nennt den gespeicherten und den richtigen Wert. **Prüfsumme korrigieren** im Kontextmenü des Knotens schreibt den richtigen Wert als einen Schreibvorgang und einen Widerrufsschritt.
- **Geschützte Bereiche.** Deklariert das Image geschützte Bereiche von [[term:boot-guard|Boot Guard]], nennt die Übersichtszeile ihre Anzahl. Die Signatur eines solchen Bereichs lässt sich ohne den privaten Schlüssel des Herstellers nicht neu berechnen; siehe [[topic:recipe-checksums|Prüfsummen]].

## Was sich herausholen lässt

Rechtsklick auf einen Knoten:

- Den Knoten **öffnen**, oder nur seinen Rumpf, als [[topic:fragments|Fragment-Bereich]].
- **… sichern unter…** — den Knoten oder nur seinen Rumpf in eine Datei schreiben: dieselben Bytes, die das Öffnen zeigt, unter demselben Namen — dem des Dumps, gefolgt von dem des Knotens. Wohin die Datei gelangt, bestimmt der Browser wie bei jedem Download: in den Download-Ordner oder an die Stelle, nach der er fragt.
- **Entpackten Rumpf öffnen** / **Entpackten Rumpf exportieren…** bei einer komprimierten Sektion — das, wozu diese Bytes sich tatsächlich entfalten. Ein Knoten darin bietet dasselbe für seine eigenen **Bytes**.
- **Zur Top-Swap-Kopie** / **Zum Original** bei einem Knoten in einem der beiden Blöcke eines Images mit [[term:top-swap|Top-Swap]]-Kopie — wählt denselben Knoten im anderen Block aus und zeigt seine Bytes im Dump, sodass sich jedem Teil der Kopie der Teil des obersten Blocks zuordnen lässt, den er wiederholt.

Ein vom Werkzeug erkanntes [[term:picture|Bild]] — JPEG, PNG, GIF oder BMP, im Padding oder als Datenteil einer Raw-Section — erscheint als eigene Zeile; wird sie ausgewählt, zeichnet das Werkzeug das Bild unter den Details: höchstens so breit wie die Liste und nie größer als seine eigene Pixelgröße. Die Vorschau entsteht aus den Bytes des Dumps, wie sie vorliegen, und zwar mit dem Bilddecoder des Browsers, nicht mit dem der Firmware; sie zeigt daher den gespeicherten Inhalt, nicht zwingend genau das, was die Platine daraus macht. Kann der Browser ein Format nicht decodieren, bleiben die Details ohne Vorschau. Ein feiner Rahmen zeigt, wo das Bild endet, damit ein weißes oder transparentes Logo nicht im Hintergrund des Panels verschwindet. Ein Klick auf das Bild wechselt den Hintergrund dahinter: der des Panels, ein Schachbrettmuster oder Schwarz (im dunklen Erscheinungsbild Weiß). Ein Bild mit Transparenz erscheint zunächst auf dem Schachbrett, eines ohne auf dem Hintergrund des Panels. In der [[topic:tools-overview|großen Ansicht der Details]], die die **Leertaste** auf der Zeile öffnet, erscheint das Bild größer, bis zu seiner eigenen Größe in Pixeln.

## Padding

Zwischen den Strukturen eines Dumps liegt gelöschter Raum. Der Baum lässt ihn weg, solange im Filtermenü **Leeres Padding anzeigen** nicht abgehakt ist. Das Menü öffnet das Trichtersymbol in der Titelzeile, links neben **der Schaltfläche in Form einer Zielscheibe**. Solange der Baum etwas anzeigt, das er standardmäßig weglässt, ist das Symbol farbig hervorgehoben. Padding mit Daten wird in jedem Fall aufgeführt, ebenso der freie Speicher eines Volumes, der angibt, wie viel Platz darin noch frei ist. Jede gelöschte Zeile mit dem Subtyp **Empty (FFh)** — Padding, aber auch eine nie beschriebene Region einer Insyde-[[term:flash-device-map|Flash Device Map]], etwa **Unused** oder ein Passwortfeld —, freier Speicher und eine Padding-Datei mit gelöschtem Inhalt (**Padding-Datei**) werden grau dargestellt: ein Platz in der Aufteilung, der nichts enthält.

## Variablenwerte

Die Zeile einer [[term:vss|VSS]]-, [[term:nvar|NVAR]]- oder [[term:dvar|DVAR]]-Variablen nennt nach einem Gleichheitszeichen ihren Wert — `BootOrder = 0003, 2001`, `Lang = "eng"`, `Boot0001 = Windows Boot Manager` —, und die Detailliste gibt den vollständigen Wert unter **Wert** an. Ein VSS- oder NVAR-Wert wird nach seinem Typ gelesen: Text als Text, eine Zahl als Zahl, ein Gerätepfad in der Textform der UEFI-Spezifikation. **Gelesen als** gibt an, als welcher Typ der Wert gelesen wurde und ob die Spezifikation diesen Typ festlegt oder ob er aus den Bytes vermutet ist. Wie der Typ bestimmt wird, erläutert der Eintrag [[term:vss|VSS]]; ein NVAR-Wert wird ebenso gelesen. Die Zeile eines NVAR-Kettenglieds (Link) nennt keinen Wert, weil ein späterer Eintrag der Kette ihn ersetzt hat.

## Regionen einer Insyde-Map

Bei Insyde-Firmware enthalten die Details der [[term:flash-device-map|Flash Device Map]] und jedes ihrer Einträge die Tabelle **Regionen der Flash Device Map** mit den Regionen, die die Map nennt. Der Anfang einer Region, die im Dump liegt, ist ein Link: Ein Klick auf ihre Zeile umrandet die Region im Dump, beschriftet sie mit ihrem Typ und bringt sie ins Bild. Das gilt auch für Regionen, die der Baum nicht als eigene Zeile zeigt, weil sie mehrere Knoten umfassen oder innerhalb eines Knotens liegen. Baum und Details bleiben bei der Map; die Auswahl eines anderen Knotens ersetzt die Umrandung. Ebenso verlinkt die Tabelle **Bereiche in $BME$** in den Details der [[term:bvdt|BIOS Version Data Table]] ihre Bereiche.

## Variablenkopien

[[term:vss|VSS]], [[term:nvar|NVAR]] und [[term:dvar|DVAR]] — die [[term:nvram|NVRAM]]-Formate, deren Einträge der Baum zu je einer Zeile pro Variable zusammenfasst — behalten die früheren Kopien einer Variable, bis die Firmware den Speicher bereinigt; auf einem Board, das eine Variable bei jedem Start schreibt, machen sie den größten Teil der Zeilen aus. Die Zeile ist die aktuelle Kopie der Variable oder, für eine Variable, die der Speicher nicht mehr enthält, die Kopie, als die sie gelöscht wurde —, solange im selben Menü **Ersetzte Einträge anzeigen** nicht abgehakt ist. Die übrigen Kopien stehen unter **Verlauf der Variable** in den Details dieser Zeile; ein Klick auf eine Kopie zeigt ihre eigenen Details und ihre Bytes im Dump, und im Baum bleibt die Zeile der geltenden Kopie ausgewählt. Dasselbe geschieht, wenn der Cursor im Dump in einer Kopie steht, die der Baum weglässt, und sie im Baum angezeigt wird.

Siehe auch: [[topic:tool-fit|FIT-Tabelle]], [[term:vss|NVRAM-Speicher]], [[topic:recipe-checksums|Prüfsummen]].
