@source-sha 0859c51378d8525f68a4f034010d5a2c03e3b66b193b6d25ad082675ba3d6df3
# Projekte

> Ein Projekt ist ein Arbeitsbereich in einem eigenen Ordner: alles, was für einen Auftrag geöffnet ist, wird als Ganzes wieder geöffnet, und zwischen Projekten lässt sich wechseln.

@covers menu.file.open-project
@covers menu.file.save-as-project
@covers menu.file.open-recent-project
@covers menu.file.close-project

[[edition:**Diese Seite handelt von der Windows-Anwendung.** Eine Seite im Browser kann die Dateien eines Projekts nicht von selbst wieder öffnen; die Browser-Ausgabe hat daher keine Projekte, und nichts hier Beschriebene gibt es dort.||]]

Ein Projekt enthält dasselbe wie der [[topic:workspace|Arbeitsbereich]] — alle Fenster und in jedem die Dateien, die Position in jedem Bereich, die Lesezeichen, die Segmente, die Fragment-Bereiche, die Werkzeugbereiche und den Bereich **Anmerkungen** — einschließlich jeder noch nicht gesicherten Änderung: unbenannte Dokumente, Änderungen in Teilen, die noch nicht zurückgeschrieben sind, und die geänderten Bytes von Dateien, die rot zurückkehren, wie sie waren. Anders als der Arbeitsbereich wird ein Projekt unabhängig von der Einstellung **Arbeitsbereich beim Start wiederherstellen** aufbewahrt.

## Ein Projekt anlegen

**Ablage ▸ Als Projekt sichern…** fragt, wo und unter welchem Namen das Projekt aufbewahrt werden soll, und schreibt alle geöffneten Fenster hinein. Ein neuer Name wird zum Ordner des Projekts. Ein bereits vorhandener Ordner wird unverändert verwendet, wenn er leer ist, wenn sein Name auf `.brw` endet oder wenn er bereits ein Projekt enthält, das dann ersetzt wird. In jedem anderen Ordner — etwa dem Ordner eines Auftrags mit seinen Dumps — wird für das Projekt ein neuer Ordner `Project.brw` angelegt. Danach ist das Projekt das geöffnete und wird fortlaufend geschrieben, alle paar Sekunden und bei jedem Wechsel; einen eigenen Befehl zum Sichern gibt es nicht. Der Name des Projekts steht hinter dem Titel des Fensters.

Projekte dieser Anwendung und von ByteRipper für macOS sind nicht kompatibel: Keine der beiden Anwendungen öffnet die Projekte der anderen. Die macOS-Anwendung speichert in einem Projekt Fenster mit Tabs, diese Anwendung Fenster ohne Tabs. Der Projektordner trägt hier deshalb die Endung `.brw`, nicht `.brp`.

Die Dateien selbst bleiben, wo sie sind; das Projekt verweist auf sie. Es merkt sich den vollständigen Pfad jeder Datei und öffnet die Dateien darüber wieder.

## Öffnen und wechseln

- **Ablage ▸ Projekt öffnen…** fragt nach dem Ordner eines Projekts — oder nach einem Ordner, der genau ein Projekt enthält — und öffnet es.
- **Ablage ▸ Benutzte Projekte** nennt die zuletzt geöffneten Projekte; **Menü löschen** leert die Liste.
- Das Öffnen eines Projekts schließt alle geöffneten Fenster und öffnet an ihrer Stelle die Fenster des Projekts. Das verlassene Projekt bleibt erhalten, wie es ist, ungesicherte Änderungen eingeschlossen, und es wird nichts gefragt.
- Ist kein Projekt geöffnet, aber etwas anderes, bietet das Programm vor dem Öffnen eines Projekts an, die aktuelle Sitzung als Projekt zu sichern. **Nicht sichern** schließt sie und fragt dabei in jedem Fenster zu jedem Dokument mit ungesicherten Änderungen nach.
- **Ablage ▸ Projekt schließen** lässt das Projekt, wie es ist, und kehrt zu einem einzigen leeren Fenster zurück.
- Es ist jeweils ein Projekt geöffnet, und es umfasst alle Fenster: **Ablage ▸ Neues Fenster** fügt ihm ein Fenster hinzu, und ein Fenster zu schließen, während andere offen bleiben, nimmt dieses Fenster aus dem Projekt.

Ist [[topic:workspace|Arbeitsbereich beim Start wiederherstellen]] eingeschaltet, wird das Projekt, das beim Beenden von ByteRipper geöffnet war, beim nächsten Start wieder geöffnet.

## Was ein Projektordner enthält

Ein Projektordner enthält `Project.json` — einige Kilobyte, die beschreiben, was geöffnet war — und, nur solange es sie gibt, die Bytes, die sonst nirgends auf dem Datenträger liegen: unbenannte Dokumente im Ordner `Untitled` und ungesicherte Änderungen an Dateien im Ordner `Edits`. Ein Projekt ohne ungesicherte Arbeit bleibt klein. Um ein Projekt per Mail oder Messenger zu verschicken, wird sein Ordner zuvor in ein Archiv gepackt.

## Geänderte und fehlende Dateien

Eine Datei, die nicht gefunden wird, wird nicht geöffnet. Eine Datei, die sich auf dem Datenträger geändert hat, während das Projekt geschlossen war, öffnet sich ohne die ungesicherten Änderungen des Projekts an ihr, da diese an anderen Bytes vorgenommen wurden. Eine Meldung nach dem Öffnen nennt beides, wie beim Arbeitsbereich.
