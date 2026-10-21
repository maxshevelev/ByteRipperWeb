@source-sha 39483c7de2b5676e8dbd5828ff16c98a2812a362cbc1ec72c54573dd568c0a8d
@source-sha PLACEHOLDER
# Projekte

> Ein Projekt ist ein Arbeitsbereich in einem eigenen Ordner: alles, was für einen Auftrag geöffnet ist, wird als Ganzes wieder geöffnet, und zwischen Projekten lässt sich wechseln.

@covers menu.file.open-project
@covers menu.file.save-as-project
@covers menu.file.open-recent-project
@covers menu.file.close-project
@covers projects.open-elsewhere

Ein Projekt enthält dasselbe wie der [[topic:workspace|Arbeitsbereich]] — die Dateien, die Position in jedem Bereich, die Lesezeichen, die Segmente, die Fragment-Bereiche, die Werkzeugbereiche und den Bereich **Anmerkungen** — einschließlich jeder noch nicht gesicherten Änderung: unbenannte Dokumente, Änderungen in Teilen, die noch nicht zurückgeschrieben sind, und die geänderten Bytes von Dateien, die rot zurückkehren, wie sie waren. Anders als der Arbeitsbereich wird ein Projekt unabhängig von der Einstellung **Arbeitsbereich beim Start wiederherstellen** aufbewahrt.

[[edition:Projekte setzen einen Browser voraus, in dem eine Seite in einen Ordner schreiben darf: Chrome, Edge, Opera oder einen anderen Chromium-Browser. Firefox und Safari bieten die Projektbefehle nicht an.||]]

## Ein Projekt anlegen

**Ablage ▸ Als Projekt sichern…** fragt nach einem Ordner und schreibt alles, was gerade geöffnet ist, als Projekt hinein. Der gewählte Ordner wird unverändert verwendet, wenn er leer ist, wenn sein Name auf `.brp` endet oder wenn er bereits ein Projekt enthält, das dann ersetzt wird. In jedem anderen Ordner — etwa dem Ordner eines Auftrags mit seinen Dumps — wird für das Projekt ein neuer Ordner `Project.brp` angelegt. Danach ist das Projekt das geöffnete und wird fortlaufend geschrieben, alle paar Sekunden und bei jedem Wechsel; einen eigenen Befehl zum Sichern gibt es nicht. Der Name des Projekts steht hinter dem Titel des [[edition:Tabs||Fensters]].

Die Dateien selbst bleiben, wo sie sind; das Projekt verweist auf sie. [[edition:Es bewahrt den Verweis des Browsers auf jede Datei auf; die Dateien werden daher in diesem Browser auf diesem Rechner wiedergefunden. Ein auf einen anderen Rechner kopiertes Projekt öffnet sich ohne seine Dateien; sie werden dort von Hand geöffnet.||Es merkt sich den vollständigen Pfad jeder Datei und öffnet die Dateien darüber wieder.]]

## Öffnen und wechseln

- **Ablage ▸ Projekt öffnen…** fragt nach dem Ordner eines Projekts — oder nach einem Ordner, der genau ein Projekt enthält — und öffnet es.
- **Ablage ▸ Benutzte Projekte** nennt die zuletzt geöffneten Projekte; **Menü löschen** leert die Liste.
- Das Öffnen eines Projekts ersetzt alles Geöffnete. Das verlassene Projekt bleibt erhalten, wie es ist, ungesicherte Änderungen eingeschlossen, und es wird nichts gefragt.
- Ist kein Projekt geöffnet, aber etwas anderes, bietet das Programm vor dem Öffnen eines Projekts an, die aktuelle Sitzung als Projekt zu sichern. **Nicht sichern** schließt sie und fragt dabei zu jedem Dokument mit ungesicherten Änderungen nach.
- **Ablage ▸ Projekt schließen** lässt das Projekt, wie es ist, und kehrt zu einem leeren Fenster zurück.
- Ein Projekt ist jeweils nur in [[edition:einem Tab||einem Fenster]] geöffnet. Ein Projekt, das ein anderer Tab bereits geöffnet hat, wird mit der Meldung **Das Projekt ist in einem anderen Tab geöffnet.** abgewiesen.

Ist [[topic:workspace|Arbeitsbereich beim Start wiederherstellen]] eingeschaltet, wird das Projekt, das [[edition:in einem Tab beim Verlassen geöffnet war, wieder geöffnet, wenn die Seite erneut aufgerufen wird||beim Beenden von ByteRipper geöffnet war, beim nächsten Start wieder geöffnet]].

## Was ein Projektordner enthält

Ein Projektordner enthält `Project.json` — einige Kilobyte, die beschreiben, was geöffnet war — und, nur solange es sie gibt, die Bytes, die sonst nirgends auf dem Datenträger liegen: unbenannte Dokumente im Ordner `Untitled` und ungesicherte Änderungen an Dateien im Ordner `Edits`. Ein Projekt ohne ungesicherte Arbeit bleibt klein. Um ein Projekt per Mail oder Messenger zu verschicken, wird sein Ordner zuvor in ein Archiv gepackt.

## Geänderte und fehlende Dateien

Eine Datei, die nicht gefunden wird, wird nicht geöffnet. Eine Datei, die sich auf dem Datenträger geändert hat, während das Projekt geschlossen war, öffnet sich ohne die ungesicherten Änderungen des Projekts an ihr, da diese an anderen Bytes vorgenommen wurden. Eine Meldung nach dem Öffnen nennt beides, wie beim Arbeitsbereich.
