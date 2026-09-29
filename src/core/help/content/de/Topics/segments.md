@source-sha 340394f423e3957a5dcd3040f15f33664b26b4a31e2890cce507f0a8a4ace384
# Segmente: einen Dump in Teile schneiden

> Die inneren Grenzen eines Images markieren und jedes Teil als eigene Datei sichern.

Eine Segmentierung teilt die Datei eines Bereichs in **Segmente**: zusammenhängend, überschneidungsfrei, die Datei stets vollständig abdeckend. Jede geöffnete Datei beginnt als ein Segment — sie selbst.

An den Bytes ändert ein Segment nichts: Es ist eine Art, die Datei zu *lesen*, und geschrieben wird nur beim ausdrücklichen Sichern.

## Einen Schnitt setzen

- Ein Rechtsklick in den Dump und der Befehl **Hier bei „Adresse“ schneiden** schneiden an der Einfügemarke.
- **Segmente ▸ Hier trennen…** nimmt die Adresse als Zahl entgegen. Nach dem Bestätigen springt die Einfügemarke auf den neuen Schnitt, und die Ansicht zentriert ihn.
- **Segmente ▸ Zusammenführen** entfernt den Schnitt vor dem Segment, in dem die Einfügemarke steht, und führt es mit seinem Nachbarn zusammen.
- **Segmente ▸ Segmente…** öffnet die Liste: alle Segmente, ihre Bereiche, ihre Namen und die Tasten, die auf alle zugleich wirken.

Segmente heißen **S0, S1, S2 …** in Dateireihenfolge und werden neu nummeriert, sobald ein Schnitt hinzukommt oder entfällt. Ein Name, der einem Segment gegeben wurde, bleibt bei ihm, unabhängig von seiner Nummer.

## Die Teile sichern

Das Segmentformular enthält **Alle als einzelne Dateien sichern…**, was alle Teile auf einmal schreibt. Zusammen mit [[topic:join-duplicate|Datei anhängen…]] deckt das den Fall einer Platine ab, deren Firmware in zwei SPI-Bausteinen liegt:

1. Beide Bausteine werden gelesen, was zwei Dateien ergibt.
2. Eine wird geöffnet und die andere angehängt, sodass die gesamte Firmware ein Image ist.
3. Das Image wird als eine Datei verglichen, durchsucht, bearbeitet und vom [[topic:tool-uefi|UEFI-Werkzeug]] decodiert, das ein zusammenhängendes Image erwartet.
4. Die Grenze, an der die beiden Dateien zusammentrafen, ist bereits ein Schnitt, sodass **Alle als einzelne Dateien sichern** die beiden Hälften genau an dieser Grenze zurückgibt.

## Was ein Teil von der Datei behält, aus der er stammt

Ein Teil, der über **Datei anhängen…**, **Datei am Anfang einfügen…** oder **Segment aus Datei ersetzen…** ins Image gekommen ist, behält eine Verbindung zu dieser Datei: Die Datei entspricht dem Teil als Ganzes.

Das Segmentformular zeigt neben dem Teil den Namen der verbundenen Datei und, wo der Teil ihr nicht mehr entspricht, den Grund:

- **geändert** — dieselbe Länge, andere Bytes: Der Teil wurde seit dem Hinzufügen bearbeitet;
- **Länge geändert** — der Teil und die Datei haben nicht mehr dieselbe Länge. Das folgt entweder aus Bytes, die im Teil eingefügt oder gelöscht wurden, oder daraus, dass die Datei auf dem Volume jetzt eine andere Länge hat;
- **Datei fehlt** — die Datei wurde gelöscht, umbenannt oder verschoben und lässt sich nicht mehr lesen.

Verglichen wird mit dem, was die Datei auf dem Volume derzeit enthält; eine außerhalb des Programms geänderte Datei zeigt sich also in derselben Zeile.

## Einen Teil aus seiner Datei zurückholen

**Segment aus Quelle wiederherstellen** schreibt die Bytes der verbundenen Datei zurück in den Teil. Das ist ein Widerrufsschritt, und die Verbindung bleibt: Die Bytes gehören weiterhin zu jener Datei.

Der Befehl wird angeboten, solange die verbundene Datei verfügbar ist; ein Teil ohne Verbindung hat ihn nicht. Haben der Teil und die Datei nicht mehr dieselbe Länge, fragt das Programm, bevor es die Länge ändert.

Die Verbindung übersteht das Widerrufen: Der Schritt, der einen Teil zurückbringt, bringt auch seine Verbindung mit.

! Ein Schnitt wandert mit den Bytes: Davor eingefügte Daten verschieben ihn. Ein [[topic:bookmarks|Lesezeichen]] verhält sich umgekehrt und bleibt an seiner Adresse. Ein Schnitt bezeichnet die Grenze eines Bereichs, ein Lesezeichen eine Adresse.

Segmente leben, solange die Datei offen ist.
