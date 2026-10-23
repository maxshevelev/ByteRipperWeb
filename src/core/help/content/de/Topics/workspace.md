@source-sha 1134554cdf4fd57ba069c67bc88377b4f616ac59dfe126f9cfc67b37cde6b530
# Der Arbeitsbereich

> Bei eingeschalteter Einstellung öffnet ByteRipper beim Start, was beim Beenden geöffnet war.

[[edition:**Diese Seite handelt von der Windows-Anwendung.** Eine Seite im Browser kann eine Datei nicht von selbst wieder öffnen; die Browser-Ausgabe bewahrt daher keinen Arbeitsbereich auf: Nach dem Neuladen erscheint das leere Fenster ([[topic:opening-files|Dateien öffnen]]), und nichts hier Beschriebene gibt es dort.||]]

Die Option heißt **Arbeitsbereich beim Start wiederherstellen** und steht unter [[topic:settings|Einstellungen ▸ Allgemein]]. Im Auslieferungszustand ist sie ausgeschaltet: An einem Reparaturplatz ist jeder Auftrag eine andere Platine, und Dumps eines früheren Auftrags, die sich von selbst öffnen, wären im Weg.

## Welcher Arbeitsbereich wieder geöffnet wird

Der Arbeitsbereich umfasst alle Fenster, die das Programm geöffnet hat. Ein erneuter Start bringt jedes Fenster an seiner Stelle und in seiner Größe zurück, das vordere Fenster wieder vorn; was jedes Fenster enthielt, kommt in ihm zurück.

- **Beenden** — **Ablage ▸ Beenden** oder das Schließen des letzten Fensters — behält alle Fenster, wie sie sind. Jedes Fenster schreibt vor dem Beenden seinen letzten Stand; nachgefragt wird nur bei Arbeit, die der Arbeitsbereich nicht aufbewahren konnte.
- **Ein Fenster schließen, während andere offen bleiben,** entfernt es mit seinem Inhalt aus dem Arbeitsbereich; zuvor fragt es nach jeder ungesicherten Änderung darin.

## Was wiederhergestellt wird

- Datei A und Datei B, der aktive Bereich und die Lage der Trennlinie zwischen ihnen.
- In jedem Bereich die Adresse oben auf dem Bildschirm, Cursor und Auswahl, die Hex- oder Textspalte und der Einfügemodus.
- Die [[topic:bookmarks|Lesezeichen]], die ohnehin mit dem Arbeitsbereich aufbewahrt werden.
- Die [[topic:segments|Segmente]]: Schnitte, Namen und die Verknüpfungen von Segmenten mit den Dateien, aus denen sie zusammengefügt wurden; eine Verknüpfung, deren Datei sich nicht wieder erreichen lässt, kehrt als Segment ohne Verknüpfung zurück.
- Der Bereich [[topic:notes|**Anmerkungen**]] — angehoben, wenn er angehoben war, und mit den Karten, die ausgewählt waren.
- Die [[topic:minimap|Minimap]], die Suchleiste mit ihrem Muster sowie der Werkzeugbereich mit dem darin gewählten Knoten oder der gewählten Zeile und den geöffneten Zweigen seines Baums.
- Die [[topic:fragments|Fragment-Bereiche]] samt dem, der vorn lag. Ein Teil wird nicht als Bytes gespeichert, sondern erneut aus seiner Datei entnommen; er zeigt daher deren aktuellen Inhalt und lässt sich weiterhin zurückschreiben.
- **Nie gesicherte Dokumente** — eine neue Datei, ein Zusammenfügen, ein Duplikat, auch wenn es einen Namen erhalten hat — mit ihren Bytes und weiterhin ungesichert, sowie Teile mit Änderungen, die noch nicht in ihre Datei zurückgeschrieben sind, samt diesen Änderungen. Sie werden während der Arbeit neben dem Arbeitsbereich aufbewahrt, gehen daher auch bei einem unplanmäßigen Ende nicht verloren, und beim Beenden fragt das Programm nicht nach ihnen.
- **Ungesicherte Änderungen an Dateien auf dem Datenträger**, die rot und weiterhin ungesichert zurückkehren, wie sie waren. Neben dem Arbeitsbereich werden nur die geänderten Bytes aufbewahrt, keine Kopie der Datei. Wie nie gesicherte Dokumente gehen sie bei einem unplanmäßigen Ende nicht verloren, und beim Beenden fragt das Programm nicht nach ihnen. Die Änderungen werden nur dann wieder auf die Datei gelegt, wenn es dieselbe Datei ist, an der sie vorgenommen wurden (siehe unten).
- **Der Widerrufsverlauf** jedes Dokuments — Dateien auf dem Datenträger, nie gesicherte Dokumente, Teile — mit dem, was sich noch wiederholen lässt. Nach einem Neustart widerruft [[key:undo]] die Änderungen von davor: Die Schnitte der Segmente kehren mit ihnen zurück, das Widerrufen eines Zusammenfügens verbindet das Dokument wieder mit seiner Datei, und das Widerrufen bis zum auf dem Datenträger gesicherten Stand macht eine Datei wieder ungeändert. Der Verlauf hält sich an die Grenzen, die unter [[topic:editing|Bytes bearbeiten]] festgelegt sind. Der Name eines Schritts im Menü „Bearbeiten“ bleibt in der Sprache, in der das Programm lief, als die Änderung vorgenommen wurde.

## Was nicht wiederhergestellt wird

- Der Verlauf „Zurück / Vorwärts“ und die Ergebnisse der Suche in allen Dateien.
- Einstellungen wie Schrift, Wortbreite und Anordnung der Bereiche. Sie werden getrennt gespeichert und gelten ohnehin.

## Wann der Arbeitsbereich geschrieben wird

Laufend: alle paar Sekunden, solange das Programm vorn ist, beim Verlassen und beim Beenden noch einmal durch jedes Fenster. Wird die Option ausgeschaltet, werden alle gespeicherten Arbeitsbereiche gelöscht. Das Schreiben geschieht im Hintergrund und hält das Programm nie auf; das Beenden erfolgt, sobald der Arbeitsbereich jedes Fensters geschrieben ist.

Der Arbeitsbereich wird in dieser Installation, auf diesem Rechner gespeichert und verlässt ihn nicht.

## Wie die Dateien wieder geöffnet werden

Jede Datei wird über ihren vollständigen Pfad wieder geöffnet.

## Geänderte und fehlende Dateien

Jede Datei wird mit ihrer Größe und ihrem Änderungsdatum zum Zeitpunkt des Schreibens verglichen. Eine Datei, über der ungesicherte Änderungen aufbewahrt werden, wird zusätzlich nach ihrem Inhalt verglichen (SHA-256): Ein Kopieren oder eine Datensicherung ändert das Datum einer Datei, ohne ein Byte zu ändern. Eine Datei, bei der sich nur das Datum geändert hat, behält daher ihre Änderungen, und eine Datei mit anderen Bytes gilt als geändert, auch wenn ihr Datum gleich geblieben ist. Das Lesen einer Datei von mehreren Gigabyte dauert einige Sekunden, ebenso das Zurücklesen eines langen Verlaufs, der für sie aufbewahrt wird; währenddessen zeigt die Statuszeile des Bereichs den Fortschritt der Arbeit, und die Änderungen werden erst auf die Datei gelegt, wenn sie geprüft ist.

- Eine Datei, die nicht mehr da ist, wird nicht geöffnet.
- Eine geänderte Datei wird geöffnet. Ist sie kürzer geworden, gehen Cursor und Bildschirm zu ihrer letzten Adresse. Ihre ungesicherten Änderungen, ihre Segmente, ihre Teile und die Auswahl im Werkzeugbereich werden nicht wiederhergestellt: Sie bezogen sich auf andere Bytes und zeigten an falsche Stellen.

Tritt einer dieser Fälle ein oder ließ sich eine Datei nicht erreichen, nennt eine einzige Meldung nach der Wiederherstellung die betroffenen Dateien.

Ebenso werden die Änderungen geprüft, die ByteRipper neben dem Arbeitsbereich aufbewahrt. Änderungen, die sich nicht genau so zurücklesen lassen, wie sie geschrieben wurden – die Dateien neben dem Arbeitsbereich sind beschädigt –, werden nicht angewendet: Die Datei öffnet sich so, wie sie auf dem Datenträger liegt, ein Teil so, wie seine Datei ihn enthält, und ein Dokument ohne Datei wird nicht geöffnet. Die Meldung nach der Wiederherstellung nennt sie. Führt der aufbewahrte Verlauf nicht mehr bis zu seinem Anfang zurück, kehrt der Inhalt so zurück, wie er war, jedoch ohne die Schritte, ihn zu widerrufen, und auch das sagt die Meldung.

## Andere Versionen von ByteRipper

Eine Version von ByteRipper stellt den Arbeitsbereich wieder her, den eine frühere Version geschrieben hat; was in ihr neu hinzugekommen ist, beginnt einfach leer.

Einen Arbeitsbereich, den eine neuere Version geschrieben hat, lässt das Programm unberührt: Lesen kann es ihn nicht, und ihn zu überschreiben würde diese Arbeit vernichten. Beim Start weist eine Meldung darauf hin, und bis zum Beenden wird kein Arbeitsbereich gespeichert: Das Programm öffnet sich mit einem leeren Fenster und fragt beim Beenden nach ungesicherten Änderungen wie bei ausgeschalteter Einstellung. Beim nächsten Start findet die neuere Version ihren Arbeitsbereich unverändert vor.
