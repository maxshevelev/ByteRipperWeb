@source-sha 0fb61a107184cfd4b09f96d8245aeb76cc21515daecc2ea64a3d0f9875da4983
# Was die Farben bedeuten

> Der Hintergrund sagt „anders als in der anderen Datei“. Roter Text sagt „geändert und noch nicht gesichert“.

Die beiden Zustände sind mit Absicht getrennt, und ein Byte kann beide zugleich tragen.

## Unterschied — eine Hintergrundfarbe

Im Vergleichsmodus bekommt jedes Byte, das sich vom Byte an **derselben Adresse** in der anderen Datei unterscheidet, den Unterschieds-Hintergrund. Sonst nutzt ihn nichts.

Ist eine Datei kürzer, sind die Bytes, die nur die längere hat, ebenfalls Unterschiede, und die kürzere zeigt an ihrer Stelle leere EOF-Zellen — gedämpft und eigens gestaltet, damit ein zu kurz gelesener Dump nie wie eine Datei voller Nullen aussieht.

## Ungesicherte Änderung — roter Text

Ein Byte, das Sie geändert, aber noch nicht gesichert haben, erscheint **rot**. Sichern Sie die Datei, und das Rot verschwindet: jetzt steht das Byte so in der Datei.

Diesen Zustand prüft man, bevor man eine Datei an einen Programmer gibt: rote Bytes sind Änderungen, die es nur innerhalb von ByteRipper gibt.

## Beides zugleich

Ein Byte, das sich sowohl von der anderen Datei unterscheidet als auch von Ihnen geändert wurde, trägt **beides**: den Unterschieds-Hintergrund mit roten Ziffern darauf. So sieht ein Patch in Arbeit normalerweise aus — Sie ändern das Byte ja gerade deshalb, weil es sich unterscheidet.

## Die übrigen Markierungen

- **Die Auswahl** ist die übliche Hervorhebung und verdeckt nie den Unterschied oder das Rot.
- **Suchtreffer** sind in dem ruhigen Grau gefüllt, das die Plattform für eine Auswahl ohne Fokus verwendet; der Treffer, auf dem Sie stehen, ist eine angehobene gelbe Blase. Ein Treffer auf einem Unterschied liest sich als Unterschied — zwei Dateien auseinanderzuhalten ist das, wofür es das Programm gibt.
- **Eine Zeile mit Lesezeichen** verwandelt ihre Offset-Spalte in einen farbigen Pfeil mit der Adresse darauf. Markiert wird die Zeile, nicht die Bytes, den Zuständen darüber kommt das nie in die Quere.
- **Zonen** — die farbigen Umrisse, die ein [[topic:tools-overview|Werkzeugbereich]] zeichnet — markieren den Byte-Bereich einer Struktur. Eine Zone ist ein Umriss samt Tönung, keine Füllung, und kann deshalb über Unterschieden liegen, ohne sie zu verdecken.

ByteRipper folgt dem Erscheinungsbild des Systems, all das hat also auch eine dunkle Fassung. Die Palette steht in den [[topic:settings|Einstellungen ▸ Darstellung]].
