@source-sha e4326568e1b04ddfb032bc945a26af4f76fed21f0cfd3c93b438dc68e906c7b1
# Die Minimap

> Die Gestalt des ganzen Dumps in einer Spalte, und ein Weg, sich durch Zeigen zu bewegen.

**Darstellung ▸ Minimap einblenden** (⌘M) oder die Taste ganz rechts in der Symbolleiste öffnet eine schmale Spalte neben dem Dump. Im Vergleichsmodus zeigt sie beide Dateien, geteilt wie die Bereiche.

## Zwei Modi

Der Schalter im Kopf der Minimap wählt zwischen ihnen.

- **Übersicht** — die ganze Datei, in die Spalte zusammengedrückt. Jede Zeile steht für einen Abschnitt des Dumps und ist danach abgestuft, **wie viel dieses Abschnitts wirkliches Material ist**: gelöschtes `FF`-Padding bleibt blass, Code und Daten werden dunkel. Diese Ansicht zeigt die Aufteilung eines Firmware-Images auf einen Blick — man sieht, wo der Descriptor endet, wo die ME-Region sitzt, wo ein Volume beginnt und wo dahinter der freie Speicher anfängt.
- **Lokal** — ein winziger Hex-Dump um die Einfügemarke, eine Kartenzeile je echter Dump-Zeile, genau so gefärbt wie die Bytes im Bereich.

Eine kleine Datei öffnet lokal, eine große in der Übersicht. Die Übersicht wird nur angeboten, solange sie die Datei wirklich zusammendrückt.

## Was sie markiert

- **Unterschiede** in der Unterschiedsfarbe — deshalb ist sie beim Vergleichen nützlich: man sieht sofort, ob sich zwei Dumps in einem Block unterscheiden oder überall.
- **Ihre ungesicherten Änderungen.**
- **Suchtreffer** als Tintenstriche, der aktuelle als helle Platte.
- **Zeilen mit Lesezeichen**, am Rand.
- **Zonen**, die ein [[topic:tools-overview|Firmware-Panel]] veröffentlicht hat, sodass die Regionen des Images als Bänder sichtbar werden.

Ein Klick in die Karte springt dorthin. Das Ziehen des Ansichtsrahmens scrollt.

## Am Arbeitsplatz

Die Übersicht ist der schnellste Weg zur Frage „hat der Chip sauber gelesen?“. Ein guter SPI-Dump hat Struktur: ein dichter Descriptor oben, eine dunkle ME-Region, eine gemusterte BIOS-Region, blasse gelöschte Flächen dazwischen. Ein Dump, der durchgehend gleichmäßig grau ist — oder durchgehend blass —, ist meist ein schlechtes Lesen, ein kurzgeschlossenes Bein oder der falsch gewählte Chip.

Siehe auch: [[topic:colors|Was die Farben bedeuten]].
