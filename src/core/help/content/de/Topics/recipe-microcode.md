@source-sha b8a04705605d56a0067dbdcc449193b8da07d2fd99057373f460a1591a4991d9
# Microcode und die FIT

> Wenn eine Platine nach einem Flash-Vorgang gar nicht mehr startet, sieht man hier nach.

Die CPU lädt ein [[term:microcode|Microcode-Update]], bevor sie irgendeinen BIOS-Code ausführt, und findet es über die [[term:fit|Firmware Interface Table]]. Ist diese Kette unterbrochen, ist die Platine im wörtlichsten Sinne tot: kein Bild, kein Ton, kein Post-Code über die frühesten Stufen hinaus.

## Prüfen

1. **Werkzeuge ▸ FIT-Tabelle.** Findet das Panel in einem Image, das eine haben sollte, überhaupt keine Tabelle, ist das schon die Antwort.
2. **Lesen Sie die Einträge.** Jeder sollte einen plausiblen Typ, eine plausible Adresse und Größe haben.
3. **Lesen Sie die Spalte „zeigt auf“.** Das Panel geht jeder Adresse nach und sagt, was dort wirklich liegt. Ein Eintrag, der auf gelöschten Flash zeigt oder auf etwas, das kein Microcode-Update ist, ist ein kaputter Eintrag.
4. **Lesen Sie die vom Panel aufgeführten Probleme** — die Regeln der Tabelle selbst: der Kopfeintrag, die Anzahl, die Prüfsumme, die Reihenfolge.

## Die Microcode-Einträge lesen

Jeder Microcode-Eintrag wird aus dem [[topic:databases|öffentlichen Katalog]] benannt: für welche CPU-Signatur, welcher Revision, welchen Datums. Damit lassen sich zwei Dinge prüfen:

- **Gibt es überhaupt Microcode für diese CPU?** Eine Platine, die eine neue CPU-Generation ohne BIOS-Update bekommt, ist eine Platine ohne Microcode für den Chip im Sockel.
- **Ist die Revision plausibel?** Eine Revision, die deutlich älter ist als das BIOS der Platine, deutet auf ein Image der falschen Version hin — oder auf eine Handänderung, die ein neueres Update durch ein älteres ersetzt hat.

## Reparieren

Nehmen Sie die Region aus einem korrekten Image für dieselbe Platine und dieselbe BIOS-Version und legen Sie die Bytes an denselben Adressen zurück — überschreibend, nie einfügend. Die Adressen in einer FIT sind absolut: ein Microcode-Update, das auch nur um ein Byte verschoben ist, ist eines, das die CPU nicht findet.

Siehe auch: [[term:top-swap|Top Swap]] — warum manche Platinen zwei Boot-Blöcke haben und einen missglückten Schreibvorgang auf einen davon überstehen.
