@source-sha 0aee558b6251318b429ac6ef1d7f1428af12418d27cbc6922f21c49636986abb
# Dateien öffnen: ein Bereich oder zwei

> Der Arbeitsbereich hält zwei Dateibereiche. Eine Datei ist ein Editor; eine zweite bringt den Vergleich dazu. Bearbeiten lässt sich in beiden.

Der Arbeitsbereich hält zwei Dateibereiche. Wie viele davon eine Datei halten, entscheidet, was geschieht:

- **Eine Datei offen** — Einzeldateimodus. Der Arbeitsbereich ist ein Hex-Editor für diese Datei; Bearbeiten, Suchen und die Werkzeugbereiche arbeiten wie gewohnt.
- **Zwei Dateien offen** — Vergleichsmodus. Die beiden Dumps stehen nebeneinander (oder übereinander, siehe **Darstellung ▸ Bereiche nebeneinander**), und jedes abweichende Byte ist eingefärbt.

Der zweite Bereich ist freiwillig. Nichts außer dem Vergleich selbst braucht eine zweite Datei.

## Wege, einen Dump zu öffnen

- **Die Öffnen-Taste** auf dem leeren Bildschirm, oder **Ablage ▸ Öffnen…** [[edition:im Menü der Symbolleiste||im Menü]]. Die Datei ersetzt den **aktiven** Bereich; einen zweiten Bereich legt der Befehl nicht von selbst an. Nur wenn beide Bereiche leer sind, füllen die ersten beiden gewählten Dateien sie. Was darüber hinaus gewählt ist, wird nicht geöffnet.
- **Ziehen und Ablegen.** Ziehen Sie eine Datei auf den Arbeitsbereich; die Bänder zeigen, wo sie landet — in diesen Bereich oder daneben. Zwei Dateien auf einmal: die zweite öffnet im anderen Bereich, sofern dieser frei ist.
- **Ablage ▸ Vergleichen mit…** öffnet die Datei im anderen Bereich: im freien, sonst im nicht aktiven. So kommt die zweite Datei für den Vergleich hinzu. Der Befehl ist verfügbar, solange eine Datei offen ist.
- **Ablage ▸ Neue Datei** legt eine leere, unbenannte Datei an — ein Ort, um Bytes hineinzusetzen.

## Wie lange [[edition:der Tab||das Fenster]] die Datei hält

[[edition:Es wird nichts hochgeladen: eine geöffnete Datei wird in diesem Browser-Tab gelesen, und ihre Bytes bleiben auf diesem Rechner. Dafür hält der Tab einen *Verweis* auf die Datei, und der lebt nur, solange die Seite offen ist. Zwei Dinge ergeben sich daraus:||Das Fenster hält die offenen Dateien — nur, solange es offen ist. Schließen Sie es, oder starten Sie die Anwendung neu, und es beginnt wieder beim leeren Bildschirm. **Ablage ▸ Benutzte Dokumente** hält die zuletzt geöffneten zehn Dateien, die jüngsten zuerst, und eine Auswahl aus der Liste öffnet die Datei erneut.]]

[[edition:- **Beim Neuladen sind alle Dateien weg.** Den Tab schließen, neu laden oder morgen wiederkommen — alles beginnt beim leeren Bildschirm, und die Dumps müssen erneut geöffnet werden.||]]
[[edition:- **Die Erlaubnis wird einmal je Datei und Seite erfragt.** Solange die Seite offen ist, fragt der Browser nach dieser Datei nicht noch einmal. In einem Chromium-Browser kann ein Zurückschreiben ein zweites Mal nachfragen — das ist die Frage des Browsers, nicht die des Programms.||]]

[[edition:! Halten Sie Ihre Dumps in einem Ordner, den Sie wiederfinden. Eine Webseite weiß nicht, wo eine Datei liegt, das Programm kann also keine Datei von gestern von selbst wieder öffnen.||! Die Liste hält zehn Dateien, die jüngsten zuerst: ein Dump steht darin, solange er zu den zuletzt zehn geöffneten gehört und seine Datei weder verschoben noch gelöscht wurde.]]

## Eine Aufgabe je [[edition:Browser-Tab||Fenster]]

[[edition:Es gibt keine Tabs im Programm und kein zweites Fenster: **ein Arbeitsbereich ist ein Browser-Tab**||Es gibt keine Tabs im Programm: **ein Arbeitsbereich ist ein Fenster**]]. So hält man mehrere Platinen auf einem Bildschirm auseinander — [[edition:öffnen Sie das Programm in einem weiteren Tab, und es hat eigene Bereiche, eigene Lesezeichen und ein eigenes Widerrufen: BIOS-Dumps im einen Tab verglichen, EC-Dumps im nächsten.||öffnen Sie die Anwendung ein zweites Mal, und sie hat eigene Bereiche, eigene Lesezeichen und ein eigenes Widerrufen: BIOS-Dumps im einen Fenster verglichen, EC-Dumps im anderen.]]

Jeder Bereichskopf nennt seine Datei und ob es ungesicherte Änderungen gibt; die Größe steht in der Statuszeile darunter. Das ✕ im Kopf schließt diesen Bereich und lässt den anderen offen.

## Wenn die Datei schon offen ist

Hier wird nichts abgelehnt — [[edition:ein Tab||ein Fenster]] kann nicht wissen, ob die Datei woanders offen ist:

- **Im anderen Bereich** — erlaubt, und nützlich: die beiden Bereiche sind zwei Dokumente über einer Datei, also lässt sich eines bearbeiten und der Vergleich zum anderen dabei mitlesen. Ihre eigenen Änderungen sieht man ohnehin, in Rot; und wenn Sie wirklich zwei Kopien nebeneinander brauchen, macht **Ablage ▸ Duplizieren** eine im anderen Bereich.
- **[[edition:In einem anderen Browser-Tab||In einem anderen Fenster]]** — [[edition:jener Tab ist ein eigener Arbeitsbereich, und dieser sieht ihn nicht||jenes Fenster ist ein eigener Arbeitsbereich, und dieses sieht es nicht]]. Die Datei öffnet sich auch hier, und die beiden wissen nichts voneinander: in der Datei steht, was zuletzt gesichert wurde.
- **In genau diesem Bereich** — die Datei wird neu gelesen; so nimmt man einen Dump wieder auf, nachdem ein Programmer ihn überschrieben hat.

! Die Datei in einem Bereich mit ungesicherten Änderungen zu ersetzen, verlangt eine Bestätigung — ob die Datei per Drop oder über **Öffnen…** kommt. Verworfene Änderungen lassen sich nicht wiederherstellen.

Siehe auch: [[topic:saving|Sichern]], [[topic:join-duplicate|Zusammenfügen und Duplizieren]], [[topic:large-files|Große Dumps]].
