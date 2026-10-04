@source-sha 30f0603f4291dac93826a23bcdef750110e0d11c203d9e3a3b0a25fed2a7e1f4
# Bytes und Text finden

> [[key:find]]. Suche nach einer Byte-Folge oder einer Zeichenfolge über den ganzen Dump, im Hintergrund.

Die Suchleiste durchsucht den **aktiven Bereich** über seinen aktuellen Inhalt, ungesicherte Änderungen eingeschlossen.

## Hex

Eine Byte-Folge wird als `DEADBEEF`, `DE AD BE EF` oder `0xDE 0xAD` eingegeben; Leerzeichen sind freigestellt. Nach dem Start der Suche wird das Feld in der Schreibweise neu gesetzt, die der Dump selbst verwendet — Großbuchstabenpaare mit je einem Leerzeichen —, damit sich das Muster an die Bytes auf dem Bildschirm halten lässt.

Eine Hex-Suche ist immer exakt. Bytes haben keine Groß- und Kleinschreibung, und die entsprechende Option wird dafür deshalb nicht angeboten.

## Text

Es wird eine Codierung gewählt — ASCII, UTF-8, UTF-16 LE oder UTF-16 BE — und die Zeichenfolge eingegeben. Sie wird in Bytes codiert und exakt auf diesen Bytes gesucht.

Für Text wird die Suche ohne Rücksicht auf Groß- und Kleinschreibung angeboten.

## Intelligente Suche

Eine Zeichenfolge in einem Dump steht in der Codierung, die der Hersteller der Firmware gerade verwendet hat, und der Lesende weiß in der Regel, **was** er sucht, und nicht, **wie es geschrieben ist**. Die Intelligente Suche nimmt diese Frage weg: Die Codierung wird zum Ergebnis der Suche statt zu ihrer Bedingung. Deshalb ist sie voreingestellt — es gibt meist nichts, worauf sich eine Wahl der Codierung vorab stützen könnte.

Das Eingegebene wird in einer Form nach der anderen gesucht, bis etwas gefunden wird:

- Liest es sich als Byte-Folge — eine gerade Anzahl von Hex-Ziffern, `DEADBEEF`, oder dieselben Ziffern paarweise, `DE AD BE EF` —, wird es zuerst als Bytes und erst danach als Text gesucht.
- Sonst werden die Codierungen der Reihe nach durchprobiert: ASCII, UTF-8, dann UTF-16 LE und UTF-16 BE.
- Eine Codierung, die das Eingegebene überhaupt nicht darstellen kann, entfällt: In ihr gibt es nichts zu suchen.
- Versuche, die auf dieselben Bytes hinauslaufen, werden zu einem Durchlauf zusammengefasst. `abc` als ASCII und als UTF-8 sind dieselben drei Bytes, und der Dump wird für eine Antwort nicht zweimal gelesen.

Die Codierung, die den Treffer geliefert hat, bleibt im Einblendmenü ausgewählt — so wird die Antwort auf die nicht gestellte Frage sichtbar. Wird nichts gefunden, nennt das Programm die Codierungen, die es probiert hat.

Eine von Hand gewählte Codierung legt fest, wo die Suche beginnt; ebenso ein Eintrag aus dem Suchverlauf, der seine eigene Codierung mitbringt. In den seltenen Fällen, in denen die Intelligente Suche danebengreift oder mehr findet als gemeint war, wird sie ausgeschaltet, und es wird nur die gewählte Codierung durchsucht.

## Während eine Suche läuft

Jeder Treffer in der Datei ist grau gefüllt; der aktuelle wird als angehobene gelbe Blase dargestellt. **‹ ›** bewegen zwischen ihnen, und die Leiste nennt die Anzahl. Über einen großen Dump läuft die Suche im Hintergrund und lässt sich abbrechen; die Treffer erscheinen, während sie gefunden werden.

Die Treffer werden auch in der [[topic:minimap|Minimap]] markiert, in der ihre Verteilung über das Image sichtbar wird.

**Suchergebnisse** in der Suchleiste öffnet eine Liste des Gefundenen, die sich durchklicken lässt; ein erneuter Druck schließt sie.

## Häufig gebrauchte Muster

**[[key:find]] mit ausgewählten Bytes** übernimmt die Auswahl als Suchmuster; so wird eine in einem Dump ausgewählte Folge im anderen gesucht. Die macOS-Ausgabe hat dafür eine eigene Taste (⌘E); hier trägt [[key:find]] beide Bedeutungen, denn mit einer Auswahl kann „Suchen“ nur eines sinnvoll heißen.

Muster lassen sich benennen und in einer Musterbibliothek halten (**Einstellungen ▸ Suchmuster**) — etwa regelmäßig gebrauchte Signaturen wie `_FVH`, `$FPT` oder `24 00 00 00`. Die Bibliothek lebt in diesem Browser; sie lässt sich überall exportieren und importieren, und in einem Chromium-Browser über einen Ordner abgleichen, sodass mehrere Installationen dieselbe verwenden — auch die macOS-Ausgabe, deren Dateiformat sie benutzt.

Siehe auch: [[topic:bookmarks|Lesezeichen]], um eine gefundene Adresse zu markieren.
