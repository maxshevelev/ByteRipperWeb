@source-sha d90d8c7e13b142c87293c9baa3fd8c777d4c70d74f44a046caaa5cdba4bce1d6
# Wofür ByteRipper da ist

> Ein Hex-Editor für Firmware-Images, aufgebaut um den Vergleich zweier Dumps an gleichen Adressen.

ByteRipper öffnet eine oder zwei Binärdateien, zeigt jedes ihrer Bytes und lässt jedes davon bearbeiten. Sind zwei Dateien geöffnet, vergleicht das Programm sie **Byte für Byte an derselben Adresse** und kennzeichnet jede Adresse, an der sie voneinander abweichen.

Die Dateien, für die das Programm gedacht ist, sind Firmware-Dumps: der Inhalt eines BIOS-Bausteins, eines Embedded Controllers oder einer ME-Region, mit einem Programmiergerät von einer Platine gelesen oder als Datei bezogen.

## Was das Programm leistet

- Es vergleicht zwei Images und zeigt alle Adressen, an denen sie sich unterscheiden.
- Es nennt den Anteil des Images, der abweicht, und bewegt die Einfügemarke zwischen den abweichenden Stellen.
- Es bearbeitet einzelne Bytes und schreibt das Ergebnis in eine Datei.
- Es decodiert den Aufbau eines Firmware-Images — Regionen, Volumes, Intel-ME-Partitionen — und meldet, was darin enthalten ist und ob die Strukturen in sich stimmig sind.
- Es entnimmt einen Teil eines Images — eine Region, ein Modul, eine entpackte Sektion — als eigenes Dokument und schreibt ihn zurück.

## Was das Programm nicht leistet

ByteRipper vergleicht ausschließlich über absolute Adressen. Es sucht dieselbe Bytefolge nicht an einer anderen Adresse und verschiebt die Dateien nicht gegeneinander, um die Zahl der gemeldeten Unterschiede zu verringern.

Das ist Absicht. Ein Flash-Dump hat eine feste Aufteilung, in der eine Adresse eine Position auf dem Baustein ist: Ein verschobenes Byte steht an der falschen Adresse, und ein gleiches Byte in der Nähe ändert daran nichts. Ein Vergleich, der zwei Dumps gegeneinander ausrichtet, verbärge genau die Abweichungen, um derentwillen verglichen wird.

! ByteRipper arbeitet nicht mit einem Programmiergerät und schreibt nichts in Hardware. Das Programm bearbeitet Dateien. Das Lesen eines Bausteins und das Schreiben in ihn übernimmt das Programmiergerät.

## Was der Startbildschirm zeigt

In einem Fenster ohne geöffnete Datei zeigt der Startbildschirm unter der Version den ersten Absatz der Notizen des zuletzt veröffentlichten Releases: des laufenden Builds oder eines neueren Releases, wenn eines veröffentlicht wurde. Hat das Fenster Lesezeichen, stehen sie links und die Release-Notizen rechts. Die vollständigen Notizen stehen auf der Seite des Releases auf github.com.

## Zu diesem Handbuch

Das **?** in der Symbolleiste öffnet dieselbe kurze Liste wie der Block **Hilfe** in seinem Menü: diese Seite, den ersten Vergleich, die Einschränkungen beim Bearbeiten und die Glossare. **F1** und **[[key:help]]** öffnen das Handbuch von überall im Programm — auch ohne offene Datei und gleich, was die Tastatur hält.

## Wie es weitergeht

- [[topic:first-comparison|Ihr erster Vergleich]] — der Vergleich zweier Dateien, Schritt für Schritt.
- [[topic:hex-view|Die Hex-Ansicht lesen]] und [[topic:colors|Was die Farben bedeuten]].
- [[topic:tools-overview|Die Werkzeugbereiche]] — den Aufbau eines Images decodieren und nicht nur seine Unterschiede.
- [[topic:bench-safety|Einschränkungen beim Bearbeiten eines Images]] — die Eigenschaften eines Firmware-Images, die zulässige Änderungen begrenzen.
