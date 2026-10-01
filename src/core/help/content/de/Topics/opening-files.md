@source-sha 91d75c7f594e85ae28cd3a327d016234851064321184975ea1cf8bc435bd2da4
# Dateien öffnen: ein Bereich oder zwei

> Der Arbeitsbereich hält zwei Dateibereiche. Eine Datei ist ein Editor; eine zweite bringt den Vergleich dazu. Bearbeiten lässt sich in beiden.

Der Arbeitsbereich hält zwei Dateibereiche. Wie viele davon eine Datei halten, entscheidet, was geschieht:

- **Eine Datei offen** — Einzeldateimodus. Der Arbeitsbereich ist ein Hex-Editor für diese Datei; Bearbeiten, Suchen und die Werkzeugbereiche arbeiten wie gewohnt.
- **Zwei Dateien offen** — Vergleichsmodus. Die beiden Dumps stehen nebeneinander (oder übereinander, siehe **Darstellung ▸ Bereiche nebeneinander**), und jedes abweichende Byte ist eingefärbt.

Der zweite Bereich ist freiwillig. Nichts außer dem Vergleich selbst braucht eine zweite Datei.

## Wege, einen Dump zu öffnen

- **Die Öffnen-Taste** auf dem leeren Bildschirm, oder **Ablage ▸ Öffnen…** im Menü der Symbolleiste. Sind beide Bereiche leer, füllen die ersten beiden gewählten Dateien sie; ist einer frei, geht die Datei dorthin; sind beide belegt, ersetzt sie den **aktiven** Bereich. Was darüber hinaus gewählt ist, wird nicht geöffnet.
- **Ziehen und Ablegen.** Ziehen Sie eine Datei auf den Arbeitsbereich; die Bänder zeigen, wo sie landet — in diesen Bereich oder daneben. Zwei Dateien auf einmal: die zweite öffnet im anderen Bereich, sofern dieser frei ist.
- **Ablage ▸ Vergleichen mit…** öffnet einen zweiten Dump in den freien Bereich: der Vergleich in einem Schritt.
- **Ablage ▸ Neue Datei** legt eine leere, unbenannte Datei an — ein Ort, um Bytes hineinzusetzen.

## Wie lange der Tab die Datei hält

Es wird nichts hochgeladen: eine geöffnete Datei wird in diesem Browser-Tab gelesen, und ihre Bytes bleiben auf diesem Rechner. Dafür hält der Tab einen *Verweis* auf die Datei, und der lebt nur, solange die Seite offen ist. Zwei Dinge ergeben sich daraus:

- **Beim Neuladen sind alle Dateien weg.** Den Tab schließen, neu laden oder morgen wiederkommen — alles beginnt beim leeren Bildschirm, und die Dumps müssen erneut geöffnet werden.
- **Die Erlaubnis wird einmal je Datei und Seite erfragt.** Solange die Seite offen ist, fragt der Browser nach dieser Datei nicht noch einmal. In einem Chromium-Browser kann ein Zurückschreiben ein zweites Mal nachfragen — das ist die Frage des Browsers, nicht die des Programms.

! Halten Sie Ihre Dumps in einem Ordner, den Sie wiederfinden. Eine Webseite weiß nicht, wo eine Datei liegt, das Programm kann also keine Datei von gestern von selbst wieder öffnen.

## Eine Aufgabe je Browser-Tab

Es gibt keine Tabs im Programm und kein zweites Fenster: **ein Arbeitsbereich ist ein Browser-Tab**. So hält man mehrere Platinen auf einem Bildschirm auseinander — öffnen Sie das Programm in einem weiteren Tab, und es hat eigene Bereiche, eigene Lesezeichen und ein eigenes Widerrufen: BIOS-Dumps im einen Tab verglichen, EC-Dumps im nächsten.

Jeder Bereichskopf nennt seine Datei und ob es ungesicherte Änderungen gibt; die Größe steht in der Statuszeile darunter. Das ✕ im Kopf schließt diesen Bereich und lässt den anderen offen.

## Wenn die Datei schon offen ist

Hier wird nichts abgelehnt — ein Tab kann nicht wissen, ob die Datei woanders offen ist:

- **Im anderen Bereich** — erlaubt, und nützlich: die beiden Bereiche sind zwei Dokumente über einer Datei, also lässt sich eines bearbeiten und der Vergleich zum anderen dabei mitlesen. Ihre eigenen Änderungen sieht man ohnehin, in Rot; und wenn Sie wirklich zwei Kopien nebeneinander brauchen, macht **Ablage ▸ Duplizieren** eine im anderen Bereich.
- **In einem anderen Browser-Tab** — jener Tab ist ein eigener Arbeitsbereich, und dieser sieht ihn nicht. Die Datei öffnet sich auch hier, und die beiden wissen nichts voneinander: in der Datei steht, was zuletzt gesichert wurde.
- **In genau diesem Bereich** — die Datei wird neu gelesen; so nimmt man einen Dump wieder auf, nachdem ein Programmer ihn überschrieben hat.

! Die Datei in einem Bereich mit ungesicherten Änderungen zu ersetzen, verlangt eine Bestätigung — ob die Datei per Drop oder über **Öffnen…** kommt. Verworfene Änderungen lassen sich nicht wiederherstellen.

Siehe auch: [[topic:saving|Sichern]], [[topic:join-duplicate|Zusammenfügen und Duplizieren]], [[topic:large-files|Große Dumps]].
