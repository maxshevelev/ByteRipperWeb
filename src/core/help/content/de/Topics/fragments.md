@source-sha 015cb99a2801a558960bc86e39a90b5cb6cf84aea8d0cb93e5f7dc9d960bc45d
# Fragment-Bereiche: ein Stück eines Dumps als eigene Datei

> Einen Teil eines Images entnehmen, als eigene Datei bearbeiten und zurückschreiben.

Ein Teil eines Images, den ein [[topic:tools-overview|Werkzeugbereich]] bereitstellt — eine Region, ein Volume, ein Modul, der entpackte Rumpf einer Sektion —, öffnet sich als **Fragment-Bereich**: ein Bereich, der von unten über den Dump fährt, aus dem der Teil stammt.

Die Quelle bleibt darüber sichtbar. Eingeklappt wird das Fragment zu einer Pille im Dock am unteren Rand des Arbeitsbereichs. Ein Dock dient dem ganzen Arbeitsbereich: Es fasst die Teile, die aus beiden geöffneten Images entnommen wurden, und die Hilfe selbst, die dasselbe Dock benutzt.

Es ist immer nur ein Panel oben. Ein anderes hochzuholen klappt das bisherige ein; deshalb räumt die geöffnete Hilfe einen Teil weg, statt ihn zu verdecken.

## Was ein Fragment unterstützt

- Lesen und Suchen wie in einer gewöhnlichen Datei, mit eigenen Adressen ab null statt mit den Adressen, die der Teil in der Quelle einnimmt.
- Bearbeiten.
- **In der Quelle aktualisieren**, im Kopfmenü des Bereichs selbst, schreibt die geänderten Bytes zurück in den Bereich, aus dem sie stammen, als einen einzigen Widerrufsschritt im Quelldokument. Klappen Sie den Bereich ein, und die Änderung steht schon da, im Dump dahinter. Sobald sich das Fragment von dem unterscheidet, mit dem es geöffnet wurde, zeigt seine Kopfzeile unmittelbar hinter dem Namen der Quelle die Schaltfläche **Geändert** mit einem Pfeil-nach-unten-Symbol, die dasselbe tut; ein Dialog meldet dann, was geschrieben wurde und dass „Widerrufen“ im Quelldokument es zurücknimmt.
- Sichern als eigene Datei, wenn der entnommene Teil gebraucht wird und nicht die geänderte Quelle. Was das in diesem Browser heißt, steht in [[topic:saving|Sichern]].

## Eigene Minimap, eigener Werkzeugbereich

Ein Fragment-Bereich ist eine eigenständige Lesefläche und nicht eine zweite Ansicht der Quelle; er trägt dieselben zwei Instrumente wie der Arbeitsbereich:

- **Eine eigene Minimap.** **Darstellung ▸ Minimap einblenden** ([[key:minimap]]) und die Taste ganz rechts in der Symbolleiste wirken auf den jeweils vordersten Bereich, sodass die Spalte neben einem Fragment das Fragment selbst abbildet: dessen Lesezeichen, dessen Segmentstreifen und die Zonen, die ein Werkzeug darin veröffentlicht hat.
- **Ein eigener Werkzeugbereich.** Das Menü **Werkzeuge** und die Werkzeugtaste der Symbolleiste wirken ebenso auf den vordersten Bereich, und das dort geöffnete Werkzeug liest die Bytes des Fragments. Es ist an dieses eine Fragment gebunden: Wo sich ein Werkzeug im Arbeitsbereich auf jede der geöffneten Dateien richten lässt, hat eines im Bereich eine einzige und bietet keinen Wechsel an.

## Wenn das Zurückschreiben abgelehnt wird

Vor dem Schreiben werden die folgenden Bedingungen geprüft, und das Programm nennt die, an der es scheitert:

- **Die Quelle ist geschlossen**, oder jener Bereich hält jetzt eine andere Datei. Die Verbindung führt zum geöffneten Dokument und nicht zu einem Pfad — einer Seite wird ein Pfad gar nicht erst genannt, also lässt er sich nicht festschreiben und später wiederfinden.
- **Die Quelle ist schreibgeschützt.**
- **Die Länge hat sich geändert.** Ein kopierter Teil wird genau in seiner eigenen Länge zurückgeschrieben; die Bytes dahinter zu verschieben steht dem Fragment nicht zu. Eine Änderung, welche die Länge verändert hat, wird deshalb abgelehnt.
- **Die Quelle hat sich geändert**, nachdem das Fragment geöffnet wurde. Das ist keine Ablehnung, sondern eine Rückfrage: Das Programm fragt, bevor es überschreibt.

## Entpackte Fragmente

Eine komprimierte UEFI-Sektion lässt sich **entpackt** öffnen. Angezeigt werden dann nicht die in der Datei gehaltenen Bytes, sondern das, wozu sie sich entfalten. Nach dem Bearbeiten und Zurückschreiben wird die Sektion neu komprimiert und das Image um die entstandene Größe herum neu gelegt. Das Ergebnis gleicht dem Original des Herstellers auch dann nicht Byte für Byte, wenn nichts geändert wurde, da ein anderer Kompressor aus derselben Eingabe eine andere Ausgabe erzeugt.
## Ein Fragment als UEFI-Teilbaum

Ein Fragment, das aus einem Knoten des Baums [[topic:tool-uefi|UEFI-Struktur]] geöffnet wurde, enthält die Bytes dieses Knotens; auf dem Fragment geöffnet, zerlegt UEFI-Struktur sie daher als eigenes Image: Was der Baum im Bereich zeigt, ist der Teilbaum unter jenem Knoten, mit den eigenen Adressen des Bereichs ab null.

Hier ist es nützlich, eine komprimierte Sektion entpackt zu öffnen. Im Bereich der Quelle hat ein Knoten innerhalb einer komprimierten Sektion keine eigenen Bytes in der Datei; der Dump markiert deshalb die ganze komprimierte Sektion. In einem entpackten Fragment hat jeder Knoten eigene Bytes: Wird ein Knoten ausgewählt, markiert der Dump genau diese Bytes, und **Zone auswählen**, **Zone öffnen** und **Zone sichern unter…** wirken auf sie.

## Lesezeichen zwischen Quelle und Fragmenten

[[topic:bookmarks|Lesezeichen]] sind eine Liste je Arbeitsbereich, die sich die Bereiche und jeder Fragment-Bereich teilen. Ein Bereich zählt ab seinem eigenen ersten Byte, während die Liste die Adressen der Datei führt; eine Marke ist damit ein Byte unter zwei Adressen: `0x1F400` im Dump ist `0x400` in einem bei `0x1F000` entnommenen Teil. Eine Zeile an der einen Stelle zu markieren markiert sie an der anderen, und bei einem Teil, der aus einem Teil geöffnet wurde, addieren sich die Versätze.

- Eine im Bereich gesetzte Marke erscheint sogleich im Bereich der Quelle, unter der Adresse, die das Byte in der Datei hat; eine im Dump gesetzte erscheint in jedem Bereich, dessen Teil jene Zeile abdeckt.
- Eine Marke auf den Zeilen vor dem ersten Byte des Teils liegt nicht im Teil und wird dort nicht gezeichnet. Die Liste behält sie in jedem Fall.
- Im Bereich nennt der Kurzhinweis einer Marke zusätzlich die Adresse, die sie in der Datei hat — die Adresse, unter der sie außerhalb des Bereichs zu finden ist.

**Ein entpackter Teil hat überhaupt keine Lesezeichen.** Seine Bytes sind nicht die Bytes der Datei, also ist keine Adresse darin eine Adresse in der Datei, und eine Marke an der einen Stelle bedeutete an der anderen nichts. Der Bereich zeichnet keine und nimmt keine an, und **Gehe zu** nennt den Grund, statt eine leere Liste zu zeigen. Dasselbe gilt für alles, was aus einem entpackten Teil geöffnet wurde.


Siehe auch: [[topic:saving|Sichern]], [[topic:bench-safety|Einschränkungen beim Bearbeiten eines Images]].
