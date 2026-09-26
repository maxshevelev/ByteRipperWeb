@source-sha 180bf277d3d1e2c95344d2e74e878230bd1e48b0c039e73a0aec8c2a9648f89f
# Teil-Bereiche: ein Stück eines Dumps

> Ein Stück aus einem Image holen, als eigene Datei bearbeiten und zurückschreiben.

Wenn ein [[topic:tools-overview|Firmware-Panel]] Ihnen einen Teil des Images gibt — eine Region, ein Volume, ein Modul, den entpackten Rumpf einer Sektion — öffnet er sich als **Teil-Bereich**: ein Bereich, der von unten über den Dump fährt, aus dem er stammt.

Die Quelle bleibt darüber sichtbar. Eingeklappt wird der Teil zu einer Pille im Dock am unteren Rand, sodass die Pillen dort die Teile sind, die Sie aus *diesem* Image geholt haben — und die Hilfe selbst, die dasselbe Dock benutzt.

Es ist immer nur ein Panel oben. Ein anderes hochzuholen klappt das bisherige ein; deshalb räumt die geöffnete Hilfe einen Teil weg, statt ihn zu verdecken.

## Was sich mit einem Teil machen lässt

- Ihn lesen und darin suchen wie in einer gewöhnlichen Datei, mit eigenen Adressen ab null — viel einfacher, als Offsets in der Quelle nachzuzählen.
- Ihn bearbeiten.
- **Im Original aktualisieren**, im Kopfmenü des Panels selbst, schreibt die geänderten Bytes zurück in den Bereich, aus dem sie kamen, als einen einzigen Widerrufsschritt im Quelldokument. Klappen Sie den Bereich ein, und die Änderung steht schon da, im Dump dahinter.
- Ihn als eigene Datei sichern, wenn Sie den herausgelösten Teil brauchen und nicht die geänderte Quelle. Was das in diesem Browser heißt, steht in [[topic:saving|Sichern]].

## Wenn das Zurückschreiben abgelehnt wird

Die Aktualisierung prüft, bevor sie schreibt, und sagt, warum sie es nicht tut:

- **Die Quelle ist geschlossen**, oder jener Bereich hält jetzt eine andere Datei. Die Verbindung führt zum geöffneten Dokument, nicht zu einem Pfad — und einer Seite wird ein Pfad gar nicht erst genannt, also lässt er sich nicht festschreiben und später wiederfinden.
- **Die Quelle ist schreibgeschützt.**
- **Die Länge hat sich geändert.** Ein schlicht kopierter Teil geht nur in seiner eigenen Länge zurück: die Bytes dahinter gehören nicht ihm. Hat Ihre Änderung die Größe verändert, ändern Sie nicht mehr einen Teil — Sie bauen das Image um ihn herum neu.
- **Die Quelle hat sich unter Ihnen geändert**, seit der Teil geöffnet wurde. Das ist keine Ablehnung, sondern eine Rückfrage: es fragt, bevor es überschreibt.

## Entpackte Teile

Eine komprimierte UEFI-Sektion lässt sich **entpackt** öffnen. Sie sehen dann nicht die Bytes der Datei, sondern das, wozu sie sich entfalten. Geändert und zurückgeschrieben, wird das Ganze neu komprimiert und das Image um die neue Größe herum neu gelegt. Rechnen Sie damit, dass das Ergebnis nicht Byte für Byte dem Original des Herstellers gleicht, selbst wenn Sie nichts ändern: ein anderer Kompressor macht aus derselben Eingabe eine andere Ausgabe.

Siehe auch: [[topic:saving|Sichern]], [[topic:bench-safety|Regeln am Arbeitsplatz]].
