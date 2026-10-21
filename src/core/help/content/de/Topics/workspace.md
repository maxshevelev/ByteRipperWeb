@source-sha 5dd5a1ea1377713d0831e771d4a2f1e787341b3eff6b8b124b0636b9fe2a05ed
# Der Arbeitsbereich

> Ist die Option eingeschaltet, öffnet die Seite, was beim Verlassen geöffnet war.

Die Option heißt **Arbeitsbereich beim Start wiederherstellen** und steht unter [[topic:settings|Einstellungen ▸ Allgemein]]. Im Auslieferungszustand ist sie ausgeschaltet: An einem Reparaturplatz ist jeder Auftrag eine andere Platine, und Dumps eines früheren Auftrags, die sich von selbst öffnen, wären im Weg.

## Welcher Arbeitsbereich zu einer Seite gehört

Ein Arbeitsbereich gehört zu einem [[edition:Browser-Tab||Fenster]]. [[edition:Das Neuladen der Seite bringt den Arbeitsbereich dieses Tabs zurück. Ein neuer Tab übernimmt den zuletzt verlassenen Arbeitsbereich, den kein geöffneter Tab hält: Ein versehentlich geschlossener Tab lässt sich aus einem neuen wieder öffnen. Ein zweiter Tab, der geöffnet wird, während der erste noch offen ist, beginnt leer.||Ein erneuter Start des Programms bringt den Arbeitsbereich des zuletzt geschlossenen Fensters zurück.]]

## Was wiederhergestellt wird

- Datei A und Datei B, der aktive Bereich und die Lage der Trennlinie zwischen ihnen.
- In jedem Bereich die Adresse oben auf dem Bildschirm, Cursor und Auswahl, die Hex- oder Textspalte und der Einfügemodus.
- Die [[topic:bookmarks|Lesezeichen]], die ohnehin mit dem Arbeitsbereich aufbewahrt werden.
- Die [[topic:segments|Segmente]]: Schnitte, Namen und die Verknüpfungen von Segmenten mit den Dateien, aus denen sie zusammengefügt wurden; eine Verknüpfung, deren Datei sich nicht wieder erreichen lässt, kehrt als Segment ohne Verknüpfung zurück.
- Der Bereich [[topic:notes|**Anmerkungen**]] — angehoben, wenn er angehoben war, und mit den Karten, die ausgewählt waren.
- Die [[topic:minimap|Minimap]], die Suchleiste mit ihrem Muster sowie der Werkzeugbereich mit dem darin gewählten Knoten oder der gewählten Zeile und den geöffneten Zweigen seines Baums.
- Die [[topic:fragments|Fragment-Bereiche]] samt dem, der vorn lag. Ein Teil wird nicht als Bytes gespeichert, sondern erneut aus seiner Datei entnommen; er zeigt daher deren aktuellen Inhalt und lässt sich weiterhin zurückschreiben.
- **Nie gesicherte Dokumente** — eine neue Datei, eine Zusammenführung, ein Duplikat, auch eines, das einen Namen erhalten hat — mit ihren Bytes und weiterhin ungesichert, sowie Teile mit Änderungen, die noch nicht in ihre Datei zurückgeschrieben sind, samt diesen Änderungen. Sie werden beim Arbeitsbereich aufbewahrt, solange die Seite geöffnet ist, sodass auch ein abgestürzter Tab sie nicht verliert, und beim Verlassen der Seite wird nicht nach ihnen gefragt.
- **Ungesicherte Änderungen an Dateien**, die rot wie zuvor und weiterhin ungesichert zurückkehren. Aufbewahrt werden nur die geänderten Bytes, keine Kopie der Datei. Die Änderungen werden nur dann wieder über die Datei gelegt, wenn es dieselbe Datei ist, an der sie gemacht wurden (siehe unten). Beim Verlassen der Seite wird nur nach einer Änderung der letzten Augenblicke gefragt, die der Arbeitsbereich noch nicht aufschreiben konnte.

## Was nicht wiederhergestellt wird

- **Der Widerrufverlauf.** Er gehört zu der Sitzung, in der die Änderungen gemacht wurden.
- Der Verlauf „Zurück / Vorwärts“ und die Ergebnisse der Suche in allen Dateien.
- Einstellungen wie Schrift, Wortbreite und Anordnung der Bereiche. Sie werden getrennt gespeichert und gelten ohnehin.

## Wann der Arbeitsbereich geschrieben wird

Laufend: alle paar Sekunden, solange [[edition:die Seite||das Programm]] vorn ist, und beim Verlassen. Wird die Option ausgeschaltet, werden alle gespeicherten Arbeitsbereiche gelöscht.

Der Arbeitsbereich wird [[edition:in diesem Browser, auf diesem Rechner||in dieser Installation, auf diesem Rechner]] gespeichert und verlässt ihn nicht.

## Wie die Dateien wieder geöffnet werden

[[edition:Eine Seite kann eine Datei nicht von selbst öffnen. In einem Chromium-Browser — Chrome, Edge, Opera — bewahrt der Arbeitsbereich den Verweis des Browsers auf jede Datei auf, und die Dateien öffnen sich von selbst, soweit der Browser das noch erlaubt; fragt er zuerst, zeigt das leere Fenster **Arbeitsbereich wieder öffnen** mit den Namen der Dateien, und ein Klick öffnet sie alle. Der Browser wird nur um das Lesen der Dateien gebeten: Die Wiederherstellung ändert nichts an ihnen, und das Schreiben wird erst beim Sichern erbeten. Firefox und Safari bewahren keinen solchen Verweis: Eine dort geöffnete Datei kehrt nicht zurück, und die Meldung nach der Wiederherstellung nennt sie.||Jede Datei wird über ihren vollständigen Pfad wieder geöffnet.]]

## Geänderte und fehlende Dateien

Jede Datei wird mit ihrer Größe und ihrem Änderungsdatum zum Zeitpunkt des Schreibens verglichen.

- Eine Datei, die nicht mehr da ist, wird nicht geöffnet.
- Eine geänderte Datei wird geöffnet. Ist sie kürzer geworden, gehen Cursor und Bildschirm zu ihrer letzten Adresse. Ihre ungesicherten Änderungen, ihre Segmente, ihre Teile und die Auswahl im Werkzeugbereich werden nicht wiederhergestellt: Sie bezogen sich auf andere Bytes und zeigten an falsche Stellen.

Tritt einer dieser Fälle ein oder ließ sich eine Datei nicht erreichen, nennt eine einzige Meldung nach der Wiederherstellung die betroffenen Dateien.
