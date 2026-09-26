@source-sha 840816a5f66cfa542e2e843bcc6409bb305ceefb4e33bbc97e9a76a595ad82eb
# Bytes und Text finden

> ⌘F. Hex-Bytes oder Text, über den ganzen Dump, im Hintergrund.

Die Suchleiste durchsucht den **aktiven Bereich**, über seinen aktuellen Inhalt — Ihre ungesicherten Änderungen eingeschlossen.

## Hex

Geben Sie eine Byte-Folge ein: `DEADBEEF`, `DE AD BE EF`, `0xDE 0xAD`. Leerzeichen sind freigestellt. Nach der Suche wird das Feld in der Schreibweise des Dumps neu gesetzt — Großbuchstabenpaare mit je einem Leerzeichen —, damit Sie das Muster an die Bytes auf dem Bildschirm halten können.

Die Hex-Suche ist immer exakt. Bytes haben keine Groß- und Kleinschreibung, deshalb wird der Schalter dafür dort gar nicht erst angeboten.

## Text

Wählen Sie eine Codierung — ASCII, UTF-8, UTF-16 LE oder UTF-16 BE — und geben Sie die Zeichenfolge ein. Sie wird in Bytes codiert und exakt auf diesen Bytes gesucht. UTF-16 LE findet die meisten Zeichenfolgen in UEFI-Firmware, ASCII die meisten in einem Option-ROM oder EC-Image.

Für Text wird das Suchen ohne Rücksicht auf Groß- und Kleinschreibung angeboten.

## Während eine Suche läuft

Jeder Treffer ist überall in der Datei ruhig grau gefüllt; der, auf dem Sie stehen, ist eine angehobene gelbe Blase. **‹ ›** gehen zwischen ihnen hin und her, und die Leiste zählt mit. Über einen großen Dump läuft die Suche im Hintergrund und lässt sich abbrechen; die Treffer erscheinen, während sie gefunden werden.

**Alle suchen** öffnet eine Ergebnisliste zum Durchklicken und markiert die Treffer in der [[topic:minimap|Minimap]] — so sieht man, wie sie über das Image verteilt sind.

## Muster, die man oft braucht

**⌘F mit ausgewählten Bytes** übernimmt die Auswahl als Muster: Bytes in einem Dump auswählen, ⌘F drücken, im anderen danach suchen. Die macOS-Ausgabe hat dafür eine eigene Taste (⌘E); hier trägt ⌘F beide Bedeutungen, denn mit einer Auswahl kann „Suchen“ nur eines sinnvoll heißen.

Muster lassen sich benennen und in einer Musterbibliothek halten (**Einstellungen ▸ Favoriten**) — dort hält eine Werkstatt die Signaturen, nach denen sie täglich sucht: `_FVH`, `$FPT`, `24 00 00 00` und so fort. Die Bibliothek lässt sich über einen Ordner abgleichen, sodass eine Werkstatt eine gemeinsame hat. Die Bibliothek lebt in diesem Browser; sie lässt sich überall exportieren und importieren, und in einem Chromium-Browser über einen Ordner synchronisieren — auch mit der macOS-Ausgabe, deren Dateiformat sie verwendet.

Siehe auch: [[topic:bookmarks|Lesezeichen]], um Gefundenes zu markieren.
