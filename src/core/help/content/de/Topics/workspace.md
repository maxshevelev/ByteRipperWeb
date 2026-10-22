@source-sha 538c81f0d37e9679cd51cb734d31c2144353e8e371251d2de079d750322e0dd4
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

## Was nicht wiederhergestellt wird

- **Der Widerrufverlauf.** Er gehört zu der Sitzung, in der die Änderungen gemacht wurden.
- Der Verlauf „Zurück / Vorwärts“ und die Ergebnisse der Suche in allen Dateien.
- Einstellungen wie Schrift, Wortbreite und Anordnung der Bereiche. Sie werden getrennt gespeichert und gelten ohnehin.

## Wann der Arbeitsbereich geschrieben wird

Laufend: alle paar Sekunden, solange das Programm vorn ist, beim Verlassen und beim Beenden noch einmal durch jedes Fenster. Wird die Option ausgeschaltet, werden alle gespeicherten Arbeitsbereiche gelöscht.

Der Arbeitsbereich wird in dieser Installation, auf diesem Rechner gespeichert und verlässt ihn nicht.

## Wie die Dateien wieder geöffnet werden

Jede Datei wird über ihren vollständigen Pfad wieder geöffnet.

## Geänderte und fehlende Dateien

Jede Datei wird mit ihrer Größe und ihrem Änderungsdatum zum Zeitpunkt des Schreibens verglichen.

- Eine Datei, die nicht mehr da ist, wird nicht geöffnet.
- Eine geänderte Datei wird geöffnet. Ist sie kürzer geworden, gehen Cursor und Bildschirm zu ihrer letzten Adresse. Ihre ungesicherten Änderungen, ihre Segmente, ihre Teile und die Auswahl im Werkzeugbereich werden nicht wiederhergestellt: Sie bezogen sich auf andere Bytes und zeigten an falsche Stellen.

Tritt einer dieser Fälle ein oder ließ sich eine Datei nicht erreichen, nennt eine einzige Meldung nach der Wiederherstellung die betroffenen Dateien.
