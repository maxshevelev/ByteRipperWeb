@source-sha 57c23062a3a198787e6c84108666e83ffcca6855e129248f5115c689fa67b93a
# Zonen-Skizze

> Die Bereiche eines unbekannten Images von Hand markieren.

**Werkzeuge ▸ Zonen-Skizze** ist ein Notizblock für Byte-Bereiche. Wählen Sie Bytes im Dump aus, geben Sie dem Bereich einen Namen und eine Farbe, und er wird als Zone über der Hex-Ansicht und in der [[topic:minimap|Minimap]] gezeichnet.

Es zerlegt nichts und kennt kein einziges Format. Genau das macht es für die Images nützlich, die die anderen Panels nicht lesen: eine EC-Firmware, ein Dump eines Akku-Controllers, ein unbekannter SPI-Chip von einer Platine, die niemand dokumentiert hat.

Am Arbeitsplatz macht man das mit Stift und Ausdruck. Hier ist es dasselbe, nur bei der Datei aufgehoben und anklickbar: klicken Sie die Zeile einer Zone, springt der Dump dorthin.

Eine Zone lässt sich auch als [[topic:fragments|Teil-Bereich]] öffnen — die markierten Bytes als eigene Datei —, der schnelle Weg, einen mit dem Auge erkannten Block herauszuholen.
