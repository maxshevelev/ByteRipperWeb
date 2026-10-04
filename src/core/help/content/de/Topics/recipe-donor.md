@source-sha c03411d9fb56c5ff2eeff81c96ab909ae5a744a2deb1fb857181655d673a50fe
# Einen Bereich von einem Image in ein anderes übertragen

> Die Mittel, die das Programm bereitstellt, um einen Byte-Bereich aus einem geöffneten Image an derselben Adresse in ein anderes zu kopieren.

Die Übertragung selbst ist ein Befehl, **Bearbeiten ▸ In den anderen Bereich kopieren**. Welcher Adressbereich zu übertragen ist und ob das Ergebnis stimmt, klären Mittel, die jeweils an anderer Stelle beschrieben sind; diese Seite hält fest, welche daran beteiligt sind und in welcher Reihenfolge sie üblicherweise eingesetzt werden.

## Die beteiligten Mittel

- **Zwei Dateibereiche.** Beide Images sind gleichzeitig geöffnet und werden Byte für Byte an gleichen Adressen verglichen ([[topic:first-comparison|Ihr erster Vergleich]]).
- **Die Statuszeile** unter jedem Bereich nennt die Größe der dortigen Datei. Images unterschiedlicher Länge werden dennoch ab Adresse null verglichen, und der nur in einem vorhandene Rest wird als Unterschied ausgewiesen.
- **[[topic:tool-uefi|UEFI-Struktur]]** liest die Datei beider Bereiche und benennt Region, Volume oder Datei, in die eine Adresse fällt. Anfangsadresse und Länge des gewählten Knotens stehen in der Detailliste.
- **Die [[topic:minimap|Minimap]]** zeigt in der Übersicht die Verteilung der Unterschiede über das ganze Image in einer Spalte.
- **Block ab hier auswählen, bei…** im Kontextmenü des Bereichs nimmt die Grenzen als Zahlen entgegen — Anfang und Ende oder Anfang und Länge — und verlangt kein Ziehen mit der Maus ([[topic:navigation|Sich bewegen]]).
- **Bearbeiten ▸ In den anderen Bereich kopieren** schreibt die Auswahl des aktiven Bereichs an denselben Adressen in den anderen Bereich. Der Befehl überschreibt und verschiebt kein Byte hinter dem Adressbereich ([[topic:editing|Bytes bearbeiten]]); jede andere Adresse bleibt unverändert.
- **[[topic:bookmarks|Lesezeichen]]** halten eine absolute Adresse und gelten für beide Bereiche, sodass dieselbe Adresse in beiden Images zu finden ist.

## Die übliche Reihenfolge

1. Beide Images werden geöffnet, je eines je Bereich.
2. Die beiden Größen in den Statuszeilen werden verglichen. Von ihnen hängt ab, ob die Adressen des einen Images im anderen dasselbe bezeichnen.
3. Auf dem Image, dessen Aufteilung zu klären ist, wird ein Werkzeugbereich geöffnet und darin der fragliche Bereich ausgewählt. Die Detailliste nennt den Adressbereich.
4. Im Quellbereich wird der Adressbereich mit **Block ab hier auswählen, bei…** ausgewählt.
5. **Bearbeiten ▸ In den anderen Bereich kopieren** schreibt ihn in den Zielbereich.
6. Der Vergleich wird erneut gelesen. Jeder verbleibende Unterschied ist einer, den der Vorgang nicht betroffen hat.

Schritt 5 ist ein Widerrufsschritt ([[key:undo]]) in der Zieldatei.

## Was das Programm nicht tut

- Es sucht dieselbe Bytefolge nicht an einer anderen Adresse und verschiebt die Dateien nicht gegeneinander: verglichen wird ausschließlich über absolute Adressen ([[topic:overview|Wofür ByteRipper da ist]]).
- Es entscheidet nicht, welches der beiden Images das richtige ist, und sagt nicht, ob eine Plattform das Ergebnis annehmen wird.
- Es überträgt keine Daten, die einer bestimmten Platine gehören. Welche das sind, steht unter [[topic:recipe-board-data|Platinenspezifische Daten]].

! Deklariert ein Image geschützte Bereiche von [[term:boot-guard|Boot Guard]], nennt die Übersichtszeile des UEFI-Bereichs deren Anzahl. Bytes innerhalb eines solchen Bereichs sind von einer Signatur gedeckt, die sich ohne den privaten Schlüssel des Herstellers nicht neu berechnen lässt. Das ist eine Eigenschaft der Plattform und keine Einschränkung des Programms. Siehe [[topic:flash-writes|Wer in den Flash schreibt]].
