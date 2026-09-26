@source-sha 7c1ba4f7a077419fa30e5f21dd3fc60638fe6d406ecd85d6b6f9584c5850561c
# Ihr erster Vergleich

> Öffnen Sie den schlechten Dump und einen guten und lassen Sie sich zeigen, wo sie auseinandergehen.

1. Öffnen Sie den Dump, den Sie untersuchen: mit der Öffnen-Taste auf dem leeren Bildschirm, über **Datei ▸ Öffnen…** im Menü der Symbolleiste, oder ziehen Sie die Datei ins Fenster.
2. Öffnen Sie die zweite genauso, oder verlangen Sie sie mit **Datei ▸ Vergleichen mit…**. Sie landet in der anderen Hälfte — jetzt hat das Programm **Datei A** links und **Datei B** rechts.
3. Achten Sie auf die Farbe. Jedes Byte, das sich zwischen beiden Dateien unterscheidet, trägt den Unterschieds-Hintergrund. Eine lange Strecke Farbe heißt, ein ganzer Bereich unterscheidet sich; einzelne verstreute Zellen heißen, ein paar Bytes tun es.
4. Springen Sie zwischen den Unterschieden statt zu scrollen: **⌥⌘→** zum nächsten, **⌥⌘←** zum vorherigen. Die Statuszeile nennt, wie viel des Images sich unterscheidet — `Unterschiede 0.4%` — als Anteil an der längeren Datei, byteweise gezählt.
5. Lesen Sie in der Statuszeile den Offset der aktuellen Position. In einem Firmware-Dump sagt Ihnen dieser Offset, *welchen Teil* des Images Sie ansehen.
6. Schalten Sie ein Firmware-Panel ein — **UEFI-Struktur** aus dem Menü „Tools“ der Symbolleiste — und die Offsets hören auf, Zahlen zu sein: das Panel benennt die Region oder das Volume, in die jede Adresse fällt.

## Das Ergebnis lesen

Ein Vergleich zweier Dumps derselben Platine sieht meist nach einem von vier Bildern aus:

- **Fast nichts unterscheidet sich.** Eine Handvoll Bytes, alle in einem kleinen Bereich. Dieser Bereich enthält fast immer platinenspezifische Daten: eine MAC-Adresse, eine Seriennummer, eine Maschinen-UUID, eine gesicherte Setup-Variable. Siehe [[topic:recipe-board-data|Platinenspezifische Daten bewahren]].
- **Ein großer Block unterscheidet sich, der Rest stimmt überein.** Verschiedene Firmware-Versionen, oder eine Region wurde gelöscht oder beschädigt. Das [[topic:tool-uefi|UEFI-Panel]] sagt Ihnen, welche.
- **Ab einer bestimmten Adresse unterscheidet sich alles.** Die Dateien sind unterschiedlich groß, oder eine wurde mit den falschen Chip-Einstellungen gelesen. Prüfen Sie zuerst die Größen in den Statuszeilen.
- **Die ganze Datei unterscheidet sich.** Verschiedene Chips, ein falscher Dump, oder eine Datei ist komprimiert oder verschlüsselt. Vergleichen Sie Größen und die ersten 16 Bytes, bevor Sie weitergehen.

## Wenn die Dateien verschieden groß sind

ByteRipper vergleicht sie trotzdem, ab Adresse null, und markiert den Rest, den nur eine Datei hat. 8 MB gegen 16 MB ist fast immer ein Lesefehler und kein echter Unterschied: viele Programmer schlagen von sich aus die falsche Kapazität vor.

Siehe auch: [[topic:navigation|Sich bewegen]], [[topic:colors|Was die Farben bedeuten]].
