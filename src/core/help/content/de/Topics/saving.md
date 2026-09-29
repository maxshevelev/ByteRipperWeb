@source-sha a095a2b1f1d8b7ebbbe4f0a226b48c484e81ea8cf30a20a93fce69265f1b5ef7
# Sichern

> Rot kennzeichnet ein Byte, das von der Datei auf dem Volume abweicht. Das Sichern schreibt diese Bytes in die Datei — oder, in manchen Browsern, in eine heruntergeladene Kopie — und das Rot wird aufgehoben.

**Was auf der Taste steht, geschieht auch.** Wo das Programm in die geöffnete Datei zurückschreiben kann, sagt es **Sichern**; wo nicht, sagt es **Herunterladen** — und der leere Bildschirm sagt, was dieser Browser tut, bevor Sie überhaupt etwas geöffnet haben.

- **Sichern** (⌘S) schreibt das Dokument des Bereichs in die Datei zurück, aus der es stammt. Chromium-Browser können das.
- **Herunterladen** (⌘S) gibt den bearbeiteten Dump stattdessen an die Downloads des Browsers. Firefox und Safari können nicht in eine Datei schreiben, die eine Seite geöffnet hat; dort heißt Sichern genau das — die geöffnete Datei bleibt unberührt, und die bearbeitete Kopie landet bei Ihren Downloads.
- **Sichern unter… / Herunterladen als…** schreibt an einen neuen Ort. Nach „Sichern unter…“ folgt der Bereich der neuen Datei; nach „Herunterladen als…“ nicht, denn eine heruntergeladene Kopie sieht die Seite nie wieder.
- **Ablage ▸ Auf gesicherten Stand zurücksetzen** verwirft Ihre Änderungen und liest die Datei neu. Für einen Bereich, dessen Bytes anderswoher stammen — ein Teil, ein Zusammenfügen —, heißt es **Auf das Original zurücksetzen**.
- **In der Quelle aktualisieren** ist das dritte Ziel: für eine [[topic:fragments|Teilansicht]] schreibt es den Teil in das Image zurück, aus dem er stammt, statt in eine Datei.

! Eine per Ziehen abgelegte Datei und eine Datei aus einem Browser ohne File System Access API werden **heruntergeladen**, auch wo das Programm sonst an Ort und Stelle sichern könnte — es gibt kein Handle, durch das geschrieben werden kann. Öffnen Sie sie über **Ablage ▸ Öffnen…**, wenn Sie Sichern statt Herunterladen wollen.

## Wenn die Datei nicht gesichert ist

Geänderte Bytes erscheinen **rot**, bis sie gesichert sind, und der Bereichskopf weist das Dokument als geändert aus. Das Sichern hebt beide Kennzeichen auf.

## Wenn die Datei sich währenddessen ändert

Das Programm merkt, wenn die geöffnete Datei ersetzt wurde — etwa weil Ihre Programmer-Software den Chip erneut in denselben Pfad gelesen hat. Ein Browser kann eine Datei nicht beobachten, also fällt es beim nächsten Zugriff auf: dann sagt es das, statt den neuen Inhalt stillschweigend zu überschreiben.

## Dokumente ohne Datei

Manche Dokumente haben ihrer Natur nach weder Namen noch Pfad, weshalb ⌘S fragt, wohin sie geschrieben werden sollen:

- **Ablage ▸ Neue Datei**.
- Das Ergebnis eines [[topic:join-duplicate|Zusammenfügens]]: Zwei Dumps zu verbinden ergibt ein *neues* Image, das ⌘S nicht über eine der Hälften schreiben darf.
- Das Ergebnis von **Duplizieren**.
- Ein Teil, der aus einem Image geöffnet wurde.

! **Sichern unter…** schreibt das bearbeitete Image in eine neue Datei und lässt die gelesene Datei unverändert. Ist der ursprüngliche Dump überschrieben, lässt er sich mit den Mitteln des Programms nicht wiederherstellen.
