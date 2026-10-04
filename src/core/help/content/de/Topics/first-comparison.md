@source-sha 4a83cfca0b9634ed03a9ee892d45b6964c438a50be03d0cf12d2be368c531578
# Ihr erster Vergleich

> Zwei Dumps öffnen, und das Programm nennt die Adressen, an denen sie sich unterscheiden.

1. Öffnen Sie den Dump, den Sie untersuchen: mit der Öffnen-Taste auf dem leeren Bildschirm, über **Ablage ▸ Öffnen…** im Menü der Symbolleiste, oder ziehen Sie die Datei auf den Arbeitsplatz.
2. Öffnen Sie die zweite Datei mit **Ablage ▸ Vergleichen mit…** oder ziehen Sie sie auf den Arbeitsbereich. Sie landet im anderen Dateibereich, und der Vergleich beginnt selbsttätig. (**Ablage ▸ Öffnen…** würde die erste Datei ersetzen.)
3. Achten Sie auf die Farbe der Bytes. Jedes Byte, das sich zwischen den beiden Dateien unterscheidet, wird **orange** hinterlegt. Eine lange Strecke Farbe bedeutet, dass ein ganzer Bereich abweicht; einzelne verstreute Zellen bedeuten, dass einzelne Bytes abweichen.
4. Bewegen Sie sich zwischen den Unterschieden: **[[key:nextDifference]]** zum nächsten, **[[key:previousDifference]]** zum vorherigen. Die Statuszeile nennt den Anteil des Images, der abweicht — `Unterschiede 0.4%` — byteweise gezählt an der Länge der längeren Datei.
5. Die Statuszeile nennt die Adresse der aktuellen Position der Einfügemarke.
6. Schalten Sie ein Werkzeug ein — **UEFI-Struktur** aus dem Menü „Tools“ der Symbolleiste. Es decodiert den Aufbau der Datei und legt den Dump als Baum benannter Regionen und Volumes aus. **Den Knoten unter der Einfügemarke im Baum zeigen** im Kopf des Bereichs öffnet den Knoten dieses Baums, in den die Adresse der Einfügemarke fällt.

## Wenn die Dateien verschieden groß sind

ByteRipper vergleicht sie dennoch ab Adresse null und kennzeichnet den Rest der längeren Datei als abweichende Bytes.

Siehe auch: [[topic:navigation|Sich bewegen]], [[topic:colors|Was die Farben bedeuten]].
