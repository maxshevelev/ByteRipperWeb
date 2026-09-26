@source-sha ad3bd75759f7d5d377da72ee4d2e50e68f295afcaed996b874dc2d4b2c3be383
# Segmente: einen Dump in Teile schneiden

> Die Nähte eines Images markieren und dann jedes Segment als eigene Datei sichern.

Eine Segmentierung teilt die Datei eines Bereichs in **Segmente**: zusammenhängend, überschneidungsfrei, die Datei stets vollständig abdeckend. Jede geöffnete Datei beginnt als ein Segment — sie selbst.

An den Bytes ändert ein Segment nichts. Es ist eine Art, die Datei zu *lesen*; geschrieben wird nur beim ausdrücklichen Sichern.

## Einen Schnitt setzen

- Klicken Sie mit rechts in den Dump und wählen Sie **Hier bei „Adresse“ schneiden** — der schnelle Weg, an der Einfügemarke.
- **Segmente ▸ Hier trennen…**, um die Adresse stattdessen einzugeben.
- **Segmente ▸ Zusammenführen** entfernt den Schnitt vor dem Segment, in dem die Einfügemarke steht, und führt es mit seinem Nachbarn zusammen.
- **Segmente ▸ Segmente…** öffnet die Liste: alle Segmente, ihre Bereiche, ihre Namen und die Tasten, die auf alle zugleich wirken.

Segmente heißen **S0, S1, S2 …** in Dateireihenfolge und nummerieren sich neu, sobald ein Schnitt dazukommt oder verschwindet. Ein Name, den Sie einem Segment geben, bleibt bei ihm, welche Nummer es auch bekommt.

## Die Teile sichern

Das Segmentformular kann **alle Segmente in einem Rutsch als einzelne Dateien sichern**. Zusammen mit [[topic:join-duplicate|Datei anhängen…]] ist das der Ablauf für eine Platine mit zwei SPI-Chips:

1. Beide Chips lesen — zwei Dateien.
2. Eine öffnen und die andere **anhängen** — jetzt ist das ganze BIOS ein Image.
3. Damit arbeiten: vergleichen, suchen, ändern, das [[topic:tool-uefi|UEFI-Panel]] darüberlaufen lassen.
4. Die Naht, an der sich die beiden trafen, ist bereits ein Schnitt, also gibt **Alle als einzelne Dateien sichern** die zwei Hälften zurück, bereit für je ihren Chip.

! Ein Schnitt wandert mit den Bytes: fügen Sie davor Daten ein, verschiebt er sich. Ein [[topic:bookmarks|Lesezeichen]] tut das Gegenteil — es bleibt an seiner Adresse. Ein Schnitt ist „der Rand dieser Region“, ein Lesezeichen „diese Adresse“.

Segmente leben, solange die Datei offen ist.
