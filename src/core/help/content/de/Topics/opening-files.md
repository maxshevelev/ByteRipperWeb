@source-sha 8bfbc3d43887707b6a34bc4585de3f4ba8ccd95c7c446a2506a2717dbf579214
# Dateien öffnen: A und B

> Der Arbeitsbereich hat zwei Plätze. Eine Datei ist ein Editor; eine zweite bringt den Vergleich dazu. Bearbeiten lässt sich in beiden Bereichen.

Der Arbeitsbereich hält zwei Dateiplätze, **Datei A** und **Datei B**. Auf welchem Platz eine Datei landet, entscheidet, was geschieht:

- **Eine Datei offen** — Einzeldateimodus. Der Arbeitsbereich ist ein Hex-Editor für diese Datei; Bearbeiten, Suchen und die Firmware-Panels arbeiten wie gewohnt.
- **Zwei Dateien offen** — Vergleichsmodus. Die beiden Dumps stehen nebeneinander (oder übereinander, siehe **Darstellung ▸ Bereiche nebeneinander**), und jedes abweichende Byte ist eingefärbt.

Datei B ist freiwillig. Nichts außer dem Vergleich selbst braucht eine zweite Datei.

## Wege, einen Dump zu öffnen

- **Die Öffnen-Taste** auf dem leeren Bildschirm, oder **Datei ▸ Öffnen…** im Menü der Symbolleiste.
- **Ziehen und Ablegen.** Ziehen Sie eine Datei auf den Arbeitsbereich; die Bänder zeigen, wo sie landet — in diesen Bereich oder daneben. Zwei Dateien auf einmal füllen beide Plätze.
- **Datei ▸ Vergleichen mit…** öffnet einen zweiten Dump auf dem freien Platz: der Vergleich in einem Schritt.
- **Datei ▸ Neue Datei** legt eine leere, unbenannte Datei an — ein Ort, um Bytes hineinzusetzen.

## Wonach der Browser fragt, und wonach er wieder fragt

Das Programm lädt nichts hoch: eine geöffnete Datei wird in diesem Browser-Tab gelesen, und die Bytes bleiben auf diesem Rechner.

Was der Browser dafür gibt, ist ein *Handle* auf die gewählte Datei, und das lebt so lange wie die Seite. Daraus folgt:

- **Eine neu geladene Seite hat keine Dateien.** Den Tab zu schließen, ihn neu zu laden oder ihn morgen wiederherzustellen beginnt beim leeren Bildschirm, und die Dumps müssen erneut geöffnet werden.
- **Die Erlaubnis wird einmal je Datei und Besuch erfragt.** In einem Chromium-Browser kann das Zurückschreiben ein zweites Mal nachfragen — das ist die Frage des Browsers, nicht die des Programms.

! Halten Sie Ihre Dumps in einem Ordner, den Sie wiederfinden. Das Programm kann die gestrige Datei nicht von selbst öffnen, denn einer Webseite wird nie gesagt, wo eine Datei liegt.

## Eine Aufgabe je Browser-Tab

Es gibt keine Tabs im Programm und kein zweites Fenster: **ein Arbeitsbereich ist ein Browser-Tab**. So hält man mehrere Platinen auf einem Bildschirm auseinander — öffnen Sie das Programm in einem weiteren Tab, und es hat eigene Plätze, eigene Lesezeichen und ein eigenes Widerrufen.

Jeder Bereichskopf nennt seine Datei und ob es ungesicherte Änderungen gibt; die Größe steht in der Statuszeile darunter. Das ✕ im Kopf schließt diesen Bereich und lässt den anderen offen.

## Wenn die Datei schon offen ist

Eine Datei zu öffnen, die bereits auf dem anderen Platz liegt, ist erlaubt — eine Datei mit sich selbst zu vergleichen, während man eine Kopie bearbeitet, ist ein legitimes Vorgehen. Sie auf den Platz zu öffnen, auf dem sie schon liegt, tut nichts.

! Einen Bereich mit ungesicherten Änderungen zu ersetzen, fragt vorher. Für einen verworfenen Bereich gibt es kein Widerrufen.

Siehe auch: [[topic:saving|Sichern]], [[topic:join-duplicate|Zusammenfügen und Duplizieren]], [[topic:large-files|Große Dumps]].
