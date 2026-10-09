@source-sha a97ecdd28bdbdecd29554128185929109d071f7e359d7cc085be4fdd09f67d1a
# Microcode und die FIT-Tabelle

> Was das Werkzeug „FIT-Tabelle“ über den Microcode eines Images meldet und was seine Befehle an der Tabelle ändern.

Der Prozessor lädt ein [[term:microcode|Microcode-Update]], bevor er irgendeinen Firmware-Befehl ausführt, und findet es über die [[term:fit|Firmware Interface Table]]. Die Einträge dieser Tabelle enthalten absolute Adressen im Image; ein von einem Eintrag benanntes Bauteil lässt sich deshalb nicht verschieben, ohne den Eintrag selbst zu berichtigen.

**Werkzeuge ▸ FIT-Tabelle** findet die Tabelle und gibt sie aus. Das Werkzeug selbst ist unter [[topic:tool-fit|FIT-Tabelle]] beschrieben; diese Seite behandelt, was seine Spalten bedeuten und was seine Befehle ändern.

## Was die Spalten bedeuten

- **Typ**, **Adresse** und **Größe** stammen aus dem Eintrag selbst.
- **Zeigt auf** wird nicht aus dem Eintrag gelesen. Das Werkzeug folgt der Adresse und meldet, was tatsächlich dort liegt: ein Microcode-Update mit gültigem Header, ein Manifest, ein gelöschter Bereich oder nichts Erkennbares. Ein Eintrag, der auf einen gelöschten Bereich zeigt, ist ein Eintrag, dessen Bauteil im Image fehlt.
- Ein Microcode-Eintrag wird zusätzlich über einen Online-Katalog benannt: Prozessorsignatur (CPUID), Revision und Datum. Der Katalog ist unter [[topic:databases|Die Online-Kataloge]] beschrieben; ohne Netzzugang meldet das Werkzeug die Kennungen und lässt die Namen weg.

Unter der Tabelle stehen die Verstöße gegen die Regeln der Spezifikation: der Header-Eintrag, die Anzahl der Einträge, die Prüfsumme der Tabelle, die Reihenfolge der Einträge nach Typ, die Ausrichtung der Adressen, das reservierte Byte sowie die Übereinstimmung der Tabelle mit ihrer [[term:top-swap|Top-Swap]]-Sicherungskopie, sofern das Image eine führt. Über die Regeln hinaus warnt die Liste, wenn zwei Microcode-Einträge denselben Prozessor auf denselben Plattformen bedienen — meist ist es eine ältere Revision, die neben einer neueren stehen geblieben ist; auch die Prozessorsignaturen aus einer erweiterten Signaturtabelle zählen dabei. Ein Doppelklick auf einen Verstoß bringt den Dump zu den betroffenen Bytes.

## Die Microcode-Einträge lesen

Der Name aus dem Katalog macht zwei Eigenschaften des Images lesbar:

- **Für welche Prozessorsignaturen das Image Microcode enthält.** Eine Platine, in der ein Prozessor eines neueren Steppings sitzt, als die Firmware vorsah, enthält keinen Microcode für die Signatur in ihrem Sockel. Welche Signatur ein bestimmter Prozessor meldet, ist eine Eigenschaft des Prozessors; das Programm liest sie nicht und meldet nur, was im Image steht.
- **Welche Revision der Microcode je Signatur hat.** Revision und Datum lassen sich mit dem neuesten Katalogeintrag derselben Signatur vergleichen.

## Microcode hinzufügen

**Microcode hinzufügen…** in der Kopfzeile des Bereichs öffnet eine Liste von Intel-Microcodes, die aus der Sammlung `platomav/CPUMicrocodes` auf github.com geladen wird, mit den Spalten CPUID, Plattform, Revision, Datum, Freigabestand und Größe. **Nur CPUIDs aus diesem Image** beschränkt die Liste auf die Signaturen, die das geöffnete Image bereits enthält. **Datei wählen…** nimmt einen Microcode aus einer lokalen Datei und braucht keinen Netzzugang.

Eine Datei aus beiden Quellen wird geprüft, bevor irgendetwas geschrieben wird: Sie muss mit einem Intel-Microcode-Header beginnen, und ihre Prüfsumme muss aufgehen.

Der Befehl leistet dann Folgendes:

1. Er legt das Bauteil unmittelbar hinter das letzte Microcode-Bauteil der Reihe, wohin es laut Spezifikation gehört. Ist in der Datei, in der die Reihe liegt, kein Platz mehr, werden freier Speicher oder gelöschtes Padding **unmittelbar hinter dieser Datei** genutzt, und die Datei selbst wird so erweitert, dass das neue Bauteil in ihr liegt und nicht lose im Volume.

   Liegt direkt hinter der Datei etwas anderes — etwa eine benachbarte Datei —, lehnt der Befehl ab, statt an anderer Stelle im Volume zu suchen. Ein in beliebigen freien Speicher gelegtes Bauteil wird beim nächsten Durchlauf des Volumes als eine Datei gelesen, die es nicht ist, und der Baum danach ergibt keinen Sinn.

   Die Suche bewegt sich ausschließlich durch die Strukturen, welche die Microcode-Reihe enthalten; eine benachbarte Region oder eine benachbarte Struktur wird daher nicht berührt.
2. Er schreibt einen neuen Eintrag in die Tabelle, nutzt dafür einen freien Platz, sofern die Tabelle einen hat, und verlängert die Tabelle sonst in die sechzehn freien Bytes dahinter.
3. Er berichtigt die Anzahl der Einträge im Header und die Prüfsumme der Tabelle.

**Die Länge der Datei ändert sich dabei nicht.** Der Vorgang bildet einen Widerrufsschritt ([[key:undo]]) und wird entweder vollständig ausgeführt oder mit Angabe des Grundes abgelehnt.

## Ersetzen und Entfernen

Das Kontextmenü einer Microcode-Zeile enthält **Microcode ersetzen**, **Microcode entfernen**, **CPUID kopieren** und **Zum Offset springen**; die Header-Zeile enthält **Prüfsumme korrigieren**.

- **Microcode ersetzen** tauscht das von der Zeile benannte Bauteil gegen ein anderes beliebiger Signatur. Die Zeile bleibt; ist das neue Bauteil anders groß, rücken die Bauteile dahinter nach, und die Einträge, die sie benennen, werden berichtigt. Ein Ersatz, der einen Prozessor bedient, den eine andere Zeile auf denselben Plattformen bereits bedient, wird abgelehnt: Zu aktualisieren ist diese Zeile.
- **Microcode entfernen** nimmt den Eintrag aus der Tabelle, rückt die Bauteile dahinter in den frei gewordenen Platz nach und löscht die Bytes am Ende der Reihe. Mindestens ein Microcode-Eintrag muss in der Tabelle verbleiben.

Hinzufügen, Ersetzen und Entfernen werden nur für Microcode-Einträge unterstützt. Einträge anderer Typen — ein ACM, ein Boot-Guard-Manifest, ein Policy-Eintrag — zeigt und prüft das Werkzeug, ändert sie aber nicht.
- **Prüfsumme korrigieren** schreibt den Wert, den der Header tragen müsste.

## Wenn eine Änderung abgelehnt wird

Das Werkzeug nimmt keine Änderung vor, die es nicht korrekt ausführen kann, und nennt die Regel, an der es sie ablehnt:

- die angebotene Datei ist kein Microcode-Image, oder ihre Prüfsumme geht nicht auf;
- der angebotene Microcode steht bereits Byte für Byte in der Tabelle; das Werkzeug nennt die Zeile, in der er steht. Der Katalog führt ein Update unter jedem Prozessor auf, den es bedient, sodass dieselbe Datei unter mehreren CPUIDs angeboten wird;
- ein Ersatz würde einen Prozessor bedienen, den der Microcode einer anderen Zeile auf denselben Plattformen bereits bedient; das Werkzeug nennt diese Zeile, die zu ersetzen ist;
- die Tabelle enthält keinen Microcode-Eintrag, hinter den ein neuer gelegt werden könnte, sodass nicht feststeht, wo dieses Image seinen Microcode hält;
- die Tabelle hat keinen freien Platz, und die Bytes dahinter sind belegt, sodass sie nicht wachsen kann; das Werkzeug nennt, wodurch sie belegt sind;
- die Reihe müsste weiter wachsen, als Platz vorhanden ist; das Werkzeug nennt, wie viele Bytes fehlen und wodurch die Reihe wachsen müsste;
- die Änderung würde in den von [[term:boot-guard|Boot Guard]] geschützten [[term:ibb|IBB]] schreiben, den der Prozessor vor dem Lauf der Firmware prüft;
- das Image führt eine [[term:top-swap|Top-Swap]]-Sicherungskopie des Blocks, in dem die Tabelle liegt, und die beiden Kopien stimmen nicht überein, sodass eine Änderung nicht für beide richtig sein kann; oder ein Schreibvorgang würde über eine Top-Swap-Blockgrenze reichen.

Führt das Image eine übereinstimmende Top-Swap-Sicherungskopie, wird die Änderung in beiden Kopien vorgenommen, und das Werkzeug sagt es.

! Eine Änderung, die in einen von der Firmware geprüften Bereich geschrieben wird, weist das Werkzeug eigens aus. Ob eine bestimmte Plattform das entstandene Image annimmt, entscheidet sich bei ihrem Start, und kein Editor kann darüber Auskunft geben. Siehe [[topic:flash-writes|Wer in den Flash schreibt]].

Siehe auch: [[term:top-swap|Top Swap]], [[topic:recipe-checksums|Prüfsummen]].
