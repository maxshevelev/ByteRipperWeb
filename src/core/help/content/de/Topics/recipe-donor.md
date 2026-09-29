@source-sha bbc2b78b08df298949aa41edcb3b9bf6028755da68edc658a3fda458cfade20e
# Einen Bereich von einem Image in ein anderes übertragen

> Die Mittel, die das Programm bereitstellt, um einen Byte-Bereich aus einem geöffneten Image an derselben Adresse in ein anderes zu kopieren.

Einen eigenen Befehl zum Übertragen eines Bereichs gibt es in ByteRipper nicht. Der Vorgang setzt sich aus Mitteln zusammen, die jeweils an anderer Stelle beschrieben sind; diese Seite hält fest, welche daran beteiligt sind und in welcher Reihenfolge sie üblicherweise eingesetzt werden.

## Die beteiligten Mittel

- **Zwei Dateibereiche.** Beide Images sind gleichzeitig geöffnet und werden Byte für Byte an gleichen Adressen verglichen ([[topic:first-comparison|Ihr erster Vergleich]]).
- **Die Statuszeile** unter jedem Bereich nennt die Größe der dortigen Datei. Images unterschiedlicher Länge werden dennoch ab Adresse null verglichen, und der nur in einem vorhandene Rest wird als Unterschied ausgewiesen.
- **[[topic:tool-uefi|UEFI-Struktur]]** liest die Datei beider Bereiche und benennt Region, Volume oder Datei, in die eine Adresse fällt. Anfangsadresse und Länge des gewählten Knotens stehen in der Detailliste.
- **Die [[topic:minimap|Minimap]]** zeigt in der Übersicht die Verteilung der Unterschiede über das ganze Image in einer Spalte.
- **Block ab hier auswählen, bei…** im Kontextmenü des Bereichs nimmt die Grenzen als Zahlen entgegen — Anfang und Ende oder Anfang und Länge — und verlangt kein Ziehen mit der Maus ([[topic:navigation|Sich bewegen]]).
- **Kopieren und Einsetzen.** ⌘V überschreibt ab der Einfügemarke und verschiebt kein nachfolgendes Byte ([[topic:editing|Bytes bearbeiten]]); ein Bereich, der über einen gleich langen Bereich gesetzt wird, lässt jede andere Adresse unverändert.
- **[[topic:bookmarks|Lesezeichen]]** halten eine absolute Adresse und gelten für beide Bereiche, sodass dieselbe Adresse in beiden Images zu finden ist.

## Die übliche Reihenfolge

1. Beide Images werden geöffnet, je eines je Bereich.
2. Die beiden Größen in den Statuszeilen werden verglichen. Von ihnen hängt ab, ob die Adressen des einen Images im anderen dasselbe bezeichnen.
3. Auf dem Image, dessen Aufteilung zu klären ist, wird ein Werkzeugbereich geöffnet und darin der fragliche Bereich ausgewählt. Die Detailliste nennt den Adressbereich.
4. Im Quellbereich wird der Adressbereich mit **Block ab hier auswählen, bei…** ausgewählt und kopiert.
5. Im Zielbereich wird derselbe Adressbereich ausgewählt und mit ⌘V überschrieben.
6. Der Vergleich wird erneut gelesen. Jeder verbleibende Unterschied ist einer, den der Vorgang nicht betroffen hat.

Schritt 5 bildet insgesamt einen Widerrufsschritt (⌘Z).

## Was das Programm nicht tut

- Es sucht dieselbe Bytefolge nicht an einer anderen Adresse und verschiebt die Dateien nicht gegeneinander: verglichen wird ausschließlich über absolute Adressen ([[topic:overview|Wofür ByteRipper da ist]]).
- Es entscheidet nicht, welches der beiden Images das richtige ist, und sagt nicht, ob eine Plattform das Ergebnis annehmen wird.
- Es überträgt keine Daten, die einer bestimmten Platine gehören. Welche das sind, steht unter [[topic:recipe-board-data|Platinenspezifische Daten]].

! Deklariert ein Image geschützte Bereiche von [[term:boot-guard|Boot Guard]], nennt die Übersichtszeile des UEFI-Bereichs deren Anzahl. Bytes innerhalb eines solchen Bereichs sind von einer Signatur gedeckt, die sich ohne den privaten Schlüssel des Herstellers nicht neu berechnen lässt. Das ist eine Eigenschaft der Plattform und keine Einschränkung des Programms. Siehe [[topic:flash-writes|Wer in den Flash schreibt]].
