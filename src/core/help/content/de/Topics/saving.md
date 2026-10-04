@source-sha f4b782a41e25a1cc35ebb5526377ef2b8d11051243ed17b4b9db925a774d5e04
# Sichern

> Rot kennzeichnet ein Byte, das von der Datei auf dem Volume abweicht. Das Sichern schreibt diese Bytes [[edition:in die Datei — oder, in manchen Browsern, in eine heruntergeladene Kopie —||zurück in die Datei,]] und das Rot wird aufgehoben.

**Was auf der Taste steht, geschieht auch.** [[edition:Wo das Programm in die geöffnete Datei zurückschreiben kann, sagt es **Sichern**; wo nicht, sagt es **Herunterladen** — und der leere Bildschirm sagt, was dieser Browser tut, bevor Sie überhaupt etwas geöffnet haben.||Das Fenster schreibt in die Datei zurück, die es geöffnet hat, daher sagt die Taste **Sichern**, und der leere Bildschirm sagt es, bevor Sie überhaupt etwas geöffnet haben.]]

- **Sichern** ([[key:save]]) schreibt das Dokument des Bereichs in die Datei zurück, aus der es stammt. [[edition:Chromium-Browser können das.||Das Fenster kann das für jede Datei, die es öffnet.]]
- [[edition:**Herunterladen** ([[key:save]]) gibt den bearbeiteten Dump stattdessen an die Downloads des Browsers. Firefox und Safari können nicht in eine Datei schreiben, die eine Seite geöffnet hat; dort heißt Sichern genau das — die geöffnete Datei bleibt unberührt, und die bearbeitete Kopie landet bei Ihren Downloads.||**Eine per Ziehen abgelegte Datei wird ebenfalls an Ort und Stelle gesichert.** Ein Drop trägt einen eigenen Verweis auf die Datei, daher wird ein Sichern im Fenster nie eine Kopie.]]
- [[edition:**Sichern unter… / Herunterladen als…** schreibt an einen neuen Ort. Nach „Sichern unter…” folgt der Bereich der neuen Datei; nach „Herunterladen als…” nicht, denn eine heruntergeladene Kopie sieht die Seite nie wieder.||**Sichern unter…** schreibt an einen neuen Ort, und danach folgt der Bereich der neuen Datei.]]
- **Ablage ▸ Auf gesicherten Stand zurücksetzen** verwirft Ihre Änderungen und liest die Datei neu. Für einen Bereich, dessen Bytes anderswoher stammen — ein Teil, ein Zusammenfügen —, heißt es **Auf das Original zurücksetzen**.
- **In der Quelle aktualisieren** ist das dritte Ziel: für eine [[topic:fragments|Teilansicht]] schreibt es den Teil in das Image zurück, aus dem er stammt, statt in eine Datei.

[[edition:! Eine per Ziehen abgelegte Datei und eine Datei aus einem Browser ohne File System Access API werden **heruntergeladen**, auch wo das Programm sonst an Ort und Stelle sichern könnte — ein Zurückschreiben ist dort schlicht nicht möglich. Öffnen Sie sie über **Ablage ▸ Öffnen…**, wenn Sie Sichern statt Herunterladen wollen.||]]

## Wenn die Datei nicht gesichert ist

Geänderte Bytes erscheinen **rot**, bis sie gesichert sind, und der Bereichskopf weist das Dokument als geändert aus. Das Sichern hebt beide Kennzeichen auf.

## Wenn die Datei sich währenddessen ändert

[[edition:Ein Browser kann eine Datei nicht beobachten, deshalb merkt das Programm nicht,||Das Programm beobachtet keine Datei, deshalb merkt es nicht,]] wenn die geöffnete Datei auf dem Datenträger geändert wird — etwa weil Ihre Programmer-Software den Chip erneut in denselben Pfad gelesen hat. Der Bereich hält die Bytes, die beim Öffnen gelesen wurden, und nimmt neuen Inhalt nicht von selbst auf. Einzige Prüfung ist das Sichern, und sie ist schmal: Eine Datei, die kürzer geworden ist, wird abgelehnt, denn die fehlenden Bytes würden sonst als Nullen zurückgeschrieben; ein Überschreiben mit derselben Größe — genau das, was ein erneutes Lesen hervorbringt — wird nicht bemerkt, und das Sichern überschreibt den neuen Inhalt mit dem alten. Haben Sie den Chip erneut gelesen, öffnen Sie die Datei vor dem Sichern erneut, damit der Bereich hält, was tatsächlich auf dem Datenträger liegt.

## Dokumente ohne Datei

Manche Dokumente haben ihrer Natur nach weder Namen noch Pfad, weshalb [[key:save]] fragt, wohin sie geschrieben werden sollen:

- **Ablage ▸ Neue Datei**.
- Das Ergebnis eines [[topic:join-duplicate|Zusammenfügens]]: Zwei Dumps zu verbinden ergibt ein *neues* Image, das [[key:save]] nicht über eine der Hälften schreiben darf.
- Das Ergebnis von **Duplizieren**.
- Ein Teil, der aus einem Image geöffnet wurde.

! **Sichern unter…** schreibt das bearbeitete Image in eine neue Datei und lässt die gelesene Datei unverändert. Ist der ursprüngliche Dump überschrieben, lässt er sich mit den Mitteln des Programms nicht wiederherstellen.
