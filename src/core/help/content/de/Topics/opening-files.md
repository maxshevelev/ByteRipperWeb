@source-sha 0c3c36c2a469360eb7016387dfe38b4c2d80fd7d7db98b92bdaa1e6c63ab7c7c
# Dateien öffnen: ein Bereich oder zwei

> Der Arbeitsbereich hält zwei Dateibereiche. Eine Datei ist ein Editor; eine zweite bringt den Vergleich dazu. Bearbeiten lässt sich in beiden.

Der Arbeitsbereich hält zwei Dateibereiche, **Datei A** und **Datei B**. Wie viele davon eine Datei halten, entscheidet, was geschieht:

- **Eine Datei offen** — Einzeldateimodus. Der Arbeitsbereich ist ein Hex-Editor für diese Datei; Bearbeiten, Suchen und die Werkzeugbereiche arbeiten wie gewohnt.
- **Zwei Dateien offen** — Vergleichsmodus. Die beiden Dumps stehen nebeneinander (oder übereinander, siehe **Darstellung ▸ Bereiche nebeneinander**), und jedes abweichende Byte ist eingefärbt.

Der zweite Bereich ist freiwillig. Nichts außer dem Vergleich selbst braucht eine zweite Datei.

## Wege, einen Dump zu öffnen

- **Die Öffnen-Taste** auf dem leeren Bildschirm, oder **Datei ▸ Öffnen…** im Menü der Symbolleiste.
- **Ziehen und Ablegen.** Ziehen Sie eine Datei auf den Arbeitsbereich; die Bänder zeigen, wo sie landet — in diesen Bereich oder daneben. Zwei Dateien auf einmal füllen beide Bereiche.
- **Datei ▸ Vergleichen mit…** öffnet einen zweiten Dump in den freien Bereich: der Vergleich in einem Schritt.
- **Datei ▸ Neue Datei** legt eine leere, unbenannte Datei an — ein Ort, um Bytes hineinzusetzen.

## Wonach der Browser fragt, und wonach er wieder fragt

Das Programm lädt nichts hoch: eine geöffnete Datei wird in diesem Browser-Tab gelesen, und die Bytes bleiben auf diesem Rechner.

Was der Browser dafür gibt, ist ein *Handle* auf die gewählte Datei, und das lebt so lange wie die Seite. Daraus folgt:

- **Eine neu geladene Seite hat keine Dateien.** Den Tab zu schließen, ihn neu zu laden oder ihn morgen wiederherzustellen beginnt beim leeren Bildschirm, und die Dumps müssen erneut geöffnet werden.
- **Die Erlaubnis wird einmal je Datei und Besuch erfragt.** In einem Chromium-Browser kann das Zurückschreiben ein zweites Mal nachfragen — das ist die Frage des Browsers, nicht die des Programms.

! Halten Sie Ihre Dumps in einem Ordner, den Sie wiederfinden. Das Programm kann die gestrige Datei nicht von selbst öffnen, denn einer Webseite wird nie gesagt, wo eine Datei liegt.

## Eine Aufgabe je Browser-Tab

Es gibt keine Tabs im Programm und kein zweites Fenster: **ein Arbeitsbereich ist ein Browser-Tab**. So hält man mehrere Platinen auf einem Bildschirm auseinander — öffnen Sie das Programm in einem weiteren Tab, und es hat eigene Bereiche, eigene Lesezeichen und ein eigenes Widerrufen.

Jeder Bereichskopf nennt seine Datei und ob es ungesicherte Änderungen gibt; die Größe steht in der Statuszeile darunter. Das ✕ im Kopf schließt diesen Bereich und lässt den anderen offen.

## Wenn die Datei schon offen ist

Hier wird nichts abgelehnt, denn es gibt niemanden zu fragen:

- **Im anderen Bereich** — erlaubt, und nützlich: die beiden Bereiche sind zwei Dokumente über einer Datei, also lässt sich eines bearbeiten und der Vergleich zum anderen dabei mitlesen.
- **In einem anderen Browser-Tab** — jener Tab ist ein eigener Arbeitsbereich, und dieser sieht ihn nicht. Die Datei öffnet sich auch hier, und die beiden wissen nichts voneinander: in der Datei steht, was zuletzt gesichert wurde.
- **In genau diesem Bereich** — die Datei wird neu gelesen; so nimmt man einen Dump wieder auf, nachdem ein Programmer ihn überschrieben hat.

! Einen Bereich mit ungesicherten Änderungen zu ersetzen, fragt vorher — ob die Datei per Ziehen kommt oder über **Öffnen…**. Für einen verworfenen Bereich gibt es kein Widerrufen.

Siehe auch: [[topic:saving|Sichern]], [[topic:join-duplicate|Zusammenfügen und Duplizieren]], [[topic:large-files|Große Dumps]].
