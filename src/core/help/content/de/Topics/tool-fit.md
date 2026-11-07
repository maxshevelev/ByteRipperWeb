@source-sha e111cdfca4bc4ef282a877607258738d9d27120393b0e958e341c72b9ffe30f7
# FIT-Tabelle

> Die Firmware Interface Table: was der Prozessor laden soll, bevor er Firmware-Code ausführt, und ob diese Bauteile vorhanden sind.

**Werkzeuge ▸ FIT-Tabelle** findet die [[term:fit|Firmware Interface Table]] im Image und führt ihre Einträge auf.

## Wie das Werkzeug die Tabelle findet

Der Flash-Speicher ist an das Ende des 32-Bit-Adressraums eingeblendet, und an der festen Adresse `0xFFFFFFC0` liegt ein Zeiger auf die Tabelle. Das Werkzeug liest ihn, rechnet die Adresse in eine Position in der Datei um und prüft, ob dort tatsächlich die Signatur `_FIT_   ` steht. Wo die Tabelle liegt, bestimmt allein dieser Zeiger: Im Image selbst kann sie überall liegen.

Führt der Zeiger aus dem Image hinaus oder steht an der genannten Adresse keine Signatur, meldet das Werkzeug das in der Liste der Verstöße, statt eine geratene Auswertung anzuzeigen. Nennt das Image den Versatz nicht, mit dem es in den Adressraum eingeblendet ist, nimmt das Werkzeug an, dass sein letztes Byte auf `0xFFFFFFFF` fällt, und kennzeichnet die Adressen als angenommen.

## Was die Einträge tragen

Jeder Eintrag trägt eine Adresse, eine Größe und einen Typ: ein [[term:microcode|Microcode-Update]], ein ACM, ein Boot-Guard-Manifest, einen TXT-Policy-Eintrag. Die Ausnahme ist ein Policy-Eintrag der Version 0: Seine ersten acht Byte sind ein Deskriptor von Index/IO-Registern und keine Adresse, und das Werkzeug stellt ihn auch so dar und nicht als Zeiger.

## Was das Werkzeug meldet

- **Die Einträge** mit ihrem Typ, in der Reihenfolge der Tabelle. Adresse und Größe eines Eintrags stehen mit seinen übrigen Feldern in der Detailliste unter der Tabelle.
- **Was an jeder Adresse tatsächlich liegt.** Was eine Zeile nach ihrem Typ angibt, wird nicht aus dem Eintrag gelesen: Das Werkzeug folgt der Adresse und meldet, was dort steht — ein Microcode-Update mit gültigem Header, ein Manifest, ein gelöschter Bereich oder nichts Erkennbares. Bei einem Microcode sind das Revision, Datum und Plattformfeld.
- **Alle Prozessoren, für die ein Microcode bestimmt ist.** Ein Update für mehrere Prozessoren führt die übrigen in einer erweiterten Signaturtabelle hinter seinen Daten auf, und ein Prozessor aus einer solchen Gruppe hat unter Umständen kein eigenes Update: Er wird von einem Update bedient, dessen Header einen anderen Prozessor nennt. Die Zeile eines Microcodes klappt in je eine Zeile für jeden von ihnen auf — zuerst der Prozessor aus dem Header, dann die von der Tabelle hinzugefügten. Der Abgleich mit dem Katalog und **Nur CPUIDs aus diesem Image** berücksichtigen jeden von ihnen. Eine Tabelle, die nicht in das Update passt oder deren Prüfsumme nicht stimmt, erscheint in der Detailliste und bleibt unberücksichtigt.
- **Die Prozessoren hinter einer CPUID.** Die Zeile eines Microcodes ist von Anfang an aufgeklappt, sodass seine CPUIDs sofort zu sehen sind, jede mit den Codenamen ihrer Prozessoren. Der Pfeil am Anfang der Zeile einer CPUID klappt sie auf: Darunter steht jedes Modell mit dieser CPUID mit den S-SPEC-Codes, unter denen es verkauft wurde. Die Architektur der Kerne, das Stepping und die Marktsegmente erscheinen als Hinweis, wenn der Zeiger auf der Zeile der CPUID verweilt. Die Liste stammt aus einer veröffentlichten Zuordnungstabelle von CPUIDs und Handelsnamen und ist um S-SPEC-Codes aus Intel ARK und Wikipedia ergänzt. Sie ist nicht vollständig: Eine CPUID, die sie nicht enthält, wird als unbekannt gemeldet, und ein Modell ohne bekannten S-SPEC-Code erscheint ohne Code. Das Plattformfeld berücksichtigt sie nicht: Sie führt jedes Modell mit dieser CPUID auf, gleich ob die Plattform der Platine zu denen gehört, für die das Update bestimmt ist.
- **Die Regeln der Tabelle**: den Header-Eintrag, die Anzahl der Einträge, die Prüfsumme, die Reihenfolge der Einträge nach Typ, die Ausrichtung der Adressen, das reservierte Byte, zwei Microcode-Einträge für denselben Prozessor auf denselben Plattformen sowie die Übereinstimmung mit der [[term:top-swap|Top-Swap]]-Sicherungskopie, sofern das Image eine führt. Die gefundenen Verstöße stehen unter der Tabelle; ein Doppelklick auf einen bringt den Dump zu den betroffenen Bytes.
- **Den Namen jedes Microcodes**, aus einem Online-Katalog nach Prozessorsignatur, Revision und Datum. Siehe [[topic:databases|Die Online-Kataloge]]; ohne Netzzugang werden die Kennungen gemeldet und die Namen weggelassen.

## Was das Werkzeug ändert

Das Werkzeug liest das Image nicht nur, es schreibt auch hinein. Jeder Vorgang bildet einen Widerrufsschritt, und keiner von ihnen ändert die Länge der Datei.

- **Microcode hinzufügen…**, die Schaltfläche in der Tabelle unter dem letzten Microcode-Eintrag, legt ein Microcode-Bauteil in das Image und trägt es in die Tabelle ein. Die angebotene Liste wird aus einem Online-Katalog geladen; **Datei wählen…** nimmt einen Microcode stattdessen aus einer lokalen Datei.
- **Microcode ersetzen** tauscht das von einer Zeile benannte Bauteil gegen ein anderes.
- **Microcode entfernen** nimmt einen Eintrag aus der Tabelle und rückt die Bauteile dahinter nach.
- **Prüfsumme korrigieren** in der Header-Zeile schreibt die Prüfsumme, die die Tabelle tragen müsste.
- **CPUID kopieren** und **Ziel anzeigen** stehen im Kontextmenü einer Zeile. **Ziel anzeigen** oder ein Doppelklick auf die Zeile bringt den Dump zu dem, worauf der Eintrag zeigt, und umrandet es dort. Sonst sind im Dump die Tabelle mit allen Einträgen und die gewählte Zeile umrandet.

Unter welchen Bedingungen diese Befehle abgelehnt werden und was jeder von ihnen schreibt, steht unter [[topic:recipe-microcode|Microcode und die FIT-Tabelle]].

Solange eine Änderung berechnet wird, liegt ein Fenster mit dem Fortschritt und einer Schaltfläche **Abbrechen** über der Anwendung und hält die Datei an; ein Abbruch verwirft den Plan und schreibt nichts. Ist die Änderung beendet, nennt ein zweites Fenster das Ergebnis: was geschehen ist, mit einem grünen Haken, oder warum es nicht geschehen ist, mit einem roten Achteck. Die Statuszeile des Panels äußert sich dazu nicht.

! Führt das Image eine Top-Swap-Sicherungskopie des Blocks, in dem die Tabelle liegt, wird eine Änderung in beiden Kopien vorgenommen; weichen die Kopien voneinander ab, lehnt das Werkzeug die Änderung ab. Eine Änderung, die einen von [[term:boot-guard|Boot Guard]] geschützten Bereich berührt, wird grundsätzlich abgelehnt.

Siehe auch: [[topic:recipe-microcode|Microcode und die FIT-Tabelle]], [[term:top-swap|Top Swap]].
