@source-sha acccce691593f572749d6416e0ddf7b149094679390eec495d31776dad48638f
# Sichern

> Roter Text heißt, die Änderung gibt es nur hier. Sichern Sie, und sie steht in der Datei — oder, in manchen Browsern, in einer heruntergeladenen Kopie.

**Was auf der Taste steht, geschieht auch.** Wo das Programm in die geöffnete Datei zurückschreiben kann, sagt es **Sichern**; wo nicht, sagt es **Herunterladen** — und der leere Bildschirm sagt, was dieser Browser tut, bevor Sie überhaupt etwas geöffnet haben.

- **Sichern** (⌘S) schreibt das Dokument des Bereichs in die Datei zurück, aus der es stammt. Chromium-Browser können das.
- **Herunterladen** (⌘S) gibt den bearbeiteten Dump stattdessen an die Downloads des Browsers. Firefox und Safari können nicht in eine Datei schreiben, die eine Seite geöffnet hat; dort heißt Sichern genau das — die geöffnete Datei bleibt unberührt, und die bearbeitete Kopie landet bei Ihren Downloads.
- **Sichern unter… / Herunterladen als…** schreibt an einen neuen Ort. Nach „Sichern unter…“ folgt der Bereich der neuen Datei; nach „Herunterladen als…“ nicht, denn eine heruntergeladene Kopie sieht die Seite nie wieder.
- **Datei ▸ Auf gesicherten Stand zurück** verwirft Ihre Änderungen und liest die Datei neu. Für einen Bereich, dessen Bytes anderswoher stammen — ein Teil, ein Zusammenfügen —, heißt es **Auf Original zurück**.
- **Im Original aktualisieren** ist das dritte Ziel: für eine [[topic:fragments|Teilansicht]] schreibt es den Teil in das Image zurück, aus dem er stammt, statt in eine Datei.

! Eine per Ziehen abgelegte Datei und eine Datei aus einem Browser ohne File System Access API werden **heruntergeladen**, auch wo das Programm sonst an Ort und Stelle sichern könnte — es gibt kein Handle, durch das geschrieben werden kann. Öffnen Sie sie über **Datei ▸ Öffnen…**, wenn Sie Sichern statt Herunterladen wollen.

## Was ungesichert ist

Von Ihnen geänderte Bytes sind **rot** gezeichnet, bis sie gesichert sind, und der Kopf des Bereichs sagt, dass das Dokument geändert ist. Dieses Paar prüft man, bevor man eine Datei an einen Programmer gibt: kein Rot mehr, und der Kopf sauber.

## Wenn sich die Datei unter Ihnen ändert

Das Programm merkt, wenn die geöffnete Datei ersetzt wurde — etwa weil Ihre Programmer-Software den Chip erneut in denselben Pfad gelesen hat. Ein Browser kann eine Datei nicht beobachten, also fällt es beim nächsten Zugriff auf: dann sagt es das, statt den neuen Inhalt stillschweigend zu überschreiben.

## Dokumente ohne Datei

Manche Dokumente sind bewusst unbenannt und haben nichts, wohin sie zurückgeschrieben werden könnten, also fragt ⌘S, wohin damit:

- **Datei ▸ Neue Datei**.
- Das Ergebnis eines [[topic:join-duplicate|Zusammenfügens]]: aus zwei Dumps entsteht ein *neues* Image, und ein versehentliches ⌘S darf es nicht über eine der Hälften schreiben.
- Das Ergebnis von **Duplizieren**.
- Ein Teil, der aus einem Image geöffnet wurde.

! Bewahren Sie den Original-Dump auf. Sichern Sie Ihre gepatchte Fassung unter neuem Namen — `board_patched.bin` neben `board_original.bin`. Ein überschriebener Dump ist ein Chip, den Sie erneut lesen müssen, und auf einer Platine mit toter Spannungsschiene gelingt das vielleicht kein zweites Mal.
