@source-sha 1955ad56a84b4f682b87419473a52757a59ad94f20c5436bbe026fbac2b48d2b
# Einschränkungen beim Bearbeiten eines Images

> Die Eigenschaften eines Firmware-Images, die zulässige Änderungen begrenzen, und die Rückfragen, die das Programm deshalb stellt.

Ein Firmware-Image ist keine beliebige Datei. Seine Adressen sind absolut, ein Teil davon wird von der Plattform geprüft, bevor die Firmware läuft, und ein Teil enthält Werte, die einer einzelnen Platine gehören. Diese Seite hält diese Einschränkungen fest und nennt die Mittel des Programms, die mit jeder von ihnen zu tun haben.

## Die Länge des Images bleibt unverändert

Die Kapazität eines Flash-Bausteins ist fest, und jede Adresse in einem Firmware-Image ist absolut: Der Descriptor legt die Grenzen der Regionen fest, die [[term:fit|FIT]] gibt die Adresse jedes Microcode-Bauteils an, eine Signatur deckt einen festen Bereich ab. Ein eingefügtes oder gelöschtes Byte verschiebt alles dahinter und macht alle diese Angaben falsch.

Daraus folgt das voreingestellte Verhalten beim Bearbeiten:

- Tippen und Einsetzen mit [[key:paste]] überschreiben und verschieben kein nachfolgendes Byte.
- Entf und Rückschritt füllen mit `0x00`, statt die Datei zu kürzen; **Bearbeiten ▸ Auswahl füllen mit…** füllt die Auswahl mit einem gewählten Byte.
- Die drei Vorgänge, die die Länge doch ändern — das Einschalten des Einfügemodus, ein [[key:paste]] darin und **Bearbeiten ▸ Bytes löschen…** — fragen vor der Ausführung nach. Die Rückfragen lassen sich in den [[topic:settings|Einstellungen ▸ Bearbeiten]] abschalten.

Die Größe der Datei steht in der Statuszeile unter jedem Bereich. Siehe [[topic:editing|Bytes bearbeiten]].

## Ein Teil des Images wird von der Plattform geprüft

Aktuelle Intel-Plattformen prüfen einen Teil des Images, bevor der Prozessor Firmware-Code ausführt, und der Descriptor kann ganze Regionen für das Schreiben sperren.

- Deklariert ein Image geschützte Bereiche von [[term:boot-guard|Boot Guard]], nennt das UEFI-Werkzeug ihre Anzahl in der Übersichtszeile. Die Signatur eines solchen Bereichs lässt sich ohne den privaten Schlüssel des Herstellers nicht neu berechnen.
- Die [[term:me-region|ME-Region]] prüft die Engine vor ihrem Start selbst. Eine an Ort und Stelle geänderte Region nimmt sie nicht an; welche Zustände einer Region das Werkzeug meldet, steht unter [[topic:recipe-me-check|Den ME-Bericht lesen]].
- Die Rechte der [[term:flash-master|Flash-Master]] im Descriptor gelten für Schreibvorgänge **über den Chipsatz** — etwa durch ein Werkzeug wie Intels Flash Programming Tool oder durch ein Firmware-Update des Herstellers. Ein Programmiergerät am Baustein selbst geht am Chipsatz vorbei und unterliegt ihnen nicht. Ausführlich unter [[topic:flash-writes|Wer in den Flash schreibt]].

Die beiden Mechanismen sind auseinanderzuhalten, weil sie voneinander unabhängig sind: Ein vom Descriptor erlaubter Schreibvorgang kann ein Image ergeben, das die Plattform beim Start zurückweist, und ein Schreibvorgang mit dem Programmiergerät umgeht die Zugriffsrechte, nicht aber die Prüfung.

## Ein Teil des Images gehört einer bestimmten Platine

Ein Image von einer anderen Platine oder aus öffentlicher Quelle enthält die Identifikationsdaten jener Platine oder, wenn die veröffentlichende Seite sie entfernt hat, leere Felder an deren Stelle. Woraus diese Daten bestehen und warum zwei Platinen eines Modells sich unterscheiden, steht unter [[topic:recipe-board-data|Platinenspezifische Daten]].

## Was das Programm auseinanderhält

- **Die Datei auf der Festplatte ändert sich erst beim Sichern.** Geänderte Bytes werden rot dargestellt und bestehen bis zum [[key:save]] nur innerhalb von ByteRipper ([[topic:saving|Sichern]]).
- **Jede Änderung ist ein Widerrufsschritt**, auch die großen: das Zusammenfügen von Dateien, das Füllen, ein von einem Werkzeug geschriebener Vorgang, das Zurückschreiben eines Fragments in die Ausgangsdatei.
- **Ablage ▸ Duplizieren** kopiert den Inhalt eines Bereichs als neues, ungesichertes Dokument in den freien Bereich, sodass die Kopie bearbeitet wird und nicht die Ausgangsdatei.
- **Der Vergleich mit der Ausgangsdatei** zeigt alle Adressen, an denen das bearbeitete Image von ihr abweicht.

! ByteRipper arbeitet nicht mit einem Programmiergerät und schreibt nichts in Hardware. Das Programm bearbeitet Dateien; das Lesen eines Bausteins und das Schreiben in ihn übernimmt das Programmiergerät.
