@source-sha cf6314e402487f7be4cebaa0f035b0acf64501493958bd2fe07d223d5796cee0
# Große Dumps

> Nichts wird am Stück in den Speicher geladen, deshalb öffnet sich ein großes Image so schnell wie ein kleines.

ByteRipper liest eine Datei blockweise und hält nur, was es gerade zeigt, plus einen begrenzten Cache. Ein Browser reicht einer Seite eine Datei genau als etwas, aus dem man stückweise liest — und das ist hier das Richtige. Ein 32-MB-SPI-Dump und ein 2-GB-Image öffnen sich gleich: sofort, mit den ersten Zeilen auf dem Bildschirm, bevor der Rest der Datei überhaupt angefasst wurde.

Daraus folgt:

- **Öffnen geht sofort**, gleich welcher Größe. Dauert es, liegt die Datei auf einem langsamen Volume oder im Netz — sie ist nicht „zu groß“.
- **Bearbeiten schreibt die Datei nicht neu.** Ihre Änderungen liegen getrennt von der Datei auf dem Volume, bis Sie sichern — deshalb sind geänderte Bytes bis dahin rot.
- **Arbeit über die ganze Datei läuft im Hintergrund.** Ein vollständiger Vergleich, eine Suche über den ganzen Dump, ein Firmware-Parse: das Fenster bleibt bedienbar, und unten im Bereich erscheint eine Fortschrittszeile. Sie lässt sich abbrechen.
- **Der sichtbare Vergleich ist sofort da.** Was Sie sehen, wird beim Scrollen verglichen, auch während die vollständige Zahl der Unterschiede noch ermittelt wird.

! **Eine sehr große Datei zu sichern ist die eine Stelle, an der die Größe zu spüren ist.** Das Zurückschreiben an Ort und Stelle schiebt den Dump blockweise am Browser vorbei und ist nicht schwerer als bei einer kleinen Datei; ein *Download* muss erst als ein Stück gebaut werden, und bei einigen hundert Megabyte fängt ein Browser-Tab an, sich zu weigern. Welches von beiden dieser Browser tut, steht in [[topic:saving|Sichern]].

Für den Arbeitsplatz heißt das: die Dateigröße ist kein Grund, ein anderes Werkzeug zu nehmen. Ein voller 16-MB-SPI-Dump mit ME-Region, die zusammengefügten Dumps zweier Chips über 64 MB, ein eMMC-Auszug — alles gewöhnlich.

Siehe auch: [[topic:minimap|Die Minimap]] — so sieht man die Gestalt einer großen Datei auf einmal.
