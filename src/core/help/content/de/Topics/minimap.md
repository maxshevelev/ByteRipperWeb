@source-sha c570db0dc8f30a09d5f74acc342e90e73d4090aa29605c0534229e232a54d8f8
# Die Minimap

> Die Gestalt des ganzen Dumps in einer Spalte und die Bewegung darin mit dem Zeiger.

**Darstellung ▸ Minimap einblenden** ([[key:minimap]]) oder die Taste ganz rechts in der Symbolleiste öffnet eine schmale Spalte neben dem Dump. Im Vergleichsmodus zeigt sie beide Dateien, geteilt wie die Bereiche.

## Zwei Modi

Der Schalter im Kopf der Minimap wählt zwischen ihnen.

- **Übersicht** — die ganze Datei, in die Spalte zusammengedrückt. Jede Zeile steht für einen Abschnitt des Dumps und ist danach abgestuft, **wie viel dieses Abschnitts wirkliches Material ist**: gelöschtes `FF`-Padding bleibt blass, Code und Daten werden dunkel. Diese Ansicht zeigt die Aufteilung eines Firmware-Images auf einen Blick — man sieht, wo der Descriptor endet, wo die ME-Region sitzt, wo ein Volume beginnt und wo dahinter der freie Speicher anfängt.
- **Lokal** — ein winziger Hex-Dump um die Einfügemarke, eine Kartenzeile je echter Dump-Zeile, genau so gefärbt wie die Bytes im Bereich.

Eine kleine Datei öffnet lokal, eine große in der Übersicht. Die Übersicht wird nur angeboten, solange sie die Datei wirklich zusammendrückt.

## Was sie markiert

- **Unterschiede** in Orange, was in einer Ansicht zeigt, ob zwei Dumps sich in einem Block oder durchgehend unterscheiden.
- **Ungesicherte Änderungen.**
- **Suchtreffer** als Tintenstriche, der aktuelle als helle Platte.
- **Zeilen mit Lesezeichen**, violett, am Rand.
- **Zonen**, die ein [[topic:tools-overview|Werkzeug]] veröffentlicht hat, sodass die Regionen des Images als Bänder sichtbar werden.

Ein Klick in die Karte bewegt die Einfügemarke an die angeklickte Stelle. Das Ziehen des Ansichtsrahmens scrollt den Bereich.

Siehe auch: [[topic:colors|Was die Farben bedeuten]].
