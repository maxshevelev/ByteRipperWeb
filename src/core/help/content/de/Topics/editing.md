@source-sha 34a7e1c09eef33c999f1452655e058b3d2ba96f62e0b139afdd1c27cab9d11e2
# Bytes bearbeiten

> Tippen überschreibt die vorhandenen Bytes. Jeder Vorgang, der die Länge der Datei ändert, fragt vorher nach.

Hex-Ziffern werden in der Hex-Spalte eingegeben, Zeichen in der Textspalte. Beides ändert dieselben Bytes.

In der Hex-Spalte ersetzt die erste eingegebene Ziffer das obere Halbbyte und die zweite das untere, danach rückt die Einfügemarke weiter. In der Textspalte schreibt ein druckbares Zeichen sein Byte; alles außerhalb von ASCII wird übergangen.

## Überschreiben ist die Vorgabe

Tippen **überschreibt**, und Einsetzen mit [[key:paste]] überschreibt. Kein Byte wird verschoben, und jede Adresse in der Datei bezeichnet weiterhin das, was sie vorher bezeichnete.

Das folgt aus dem Aufbau eines Firmware-Images, in dem eine Adresse eine Position auf dem Baustein ist: Eine Tabelle zeigt auf `0x800000`, eine Signatur deckt einen festen Bereich ab, eine Regionsgrenze steht im Descriptor. Ein einziges vorn eingefügtes Byte macht alle diese Angaben falsch.

- **Entf und Rückschritt kürzen die Datei nicht.** Sie füllen mit `0x00`: Entf das Byte an der Einfügemarke, Rückschritt das davor. Eine Auswahl wird durchgehend mit `0x00` gefüllt.
- **Bearbeiten ▸ Auswahl füllen mit…** füllt die Auswahl mit einem gewählten Byte. Im Flash-Speicher ist das meist `FF`, der Wert gelöschter Zellen.

## In den anderen Bereich kopieren

**Bearbeiten ▸ In den anderen Bereich kopieren** schreibt die Auswahl des aktiven Bereichs in den anderen Bereich, über dieselben Adressen. Das ist Kopieren und Einsetzen in einem Schritt — ohne Zwischenablage und ohne den Bereich ein zweites Mal auszuwählen. Der Befehl braucht zwei geöffnete Dateien und eine Auswahl. Derselbe Befehl steht im Kontextmenü über einer Auswahl; dort kopiert er aus dem Bereich, auf den geklickt wurde, ob dieser aktiv ist oder nicht. Ein Tastenkürzel hat er hier nicht: [[edition:das ⌥⌘C der macOS-Ausgabe behält jeder Browser auf dem Mac seinen eigenen Entwicklerwerkzeugen vor||die macOS-Ausgabe hat dafür ⌥⌘C, und diese Ausgabe weist ihm keine Taste zu]].

Die Kopie überschreibt wie [[key:paste]] und ist ein Widerrufsschritt in der Datei, in die sie geschrieben wurde. Danach ist der Bereich in dieser Datei ausgewählt. Widerrufen wird der Schritt dort: Der Bereich wird aktiv gemacht, dann [[key:undo]].

Der Befehl lehnt ab und schreibt nichts, wenn die Auswahl über das Ende der anderen Datei hinausreicht. Die andere Datei wird dadurch nicht länger.

## Vorgänge, die die Länge doch ändern

Drei Vorgänge ändern sie doch, und jeder fragt vor der Ausführung nach:

- **Bearbeiten ▸ Bytes löschen…** — wirklich löschen und alles dahinter verschieben.
- **Einfügemodus** — ein Tippmodus, in dem Tasten einfügen und löschen statt zu überschreiben, und [[key:paste]] in die Datei einfügt statt darüber. Die Anzeige **OVR** / **INS** rechts in der Statuszeile des Bereichs schaltet ihn ein und aus, ebenso die **Einfg**-Taste; einen Menüpunkt wie die macOS-Ausgabe gibt es hier nicht, weil die Statuszeile den Modus ohnehin zeigt ([[topic:hex-view|Die Hex-Ansicht lesen]]). Er fragt einmal je Datei statt bei jedem Anschlag, sagt es in der Statuszeile und ändert die Form der Einfügemarke.

Die Rückfragen lassen sich in den [[topic:settings|Einstellungen ▸ Bearbeiten]] abschalten oder über das Kästchen „Nicht mehr fragen“ im Dialog selbst. Sie sind voreingestellt, weil diese Vorgänge jede Adresse hinter der Stelle ändern, an der sie wirken.

! Die Länge eines SPI-Dumps darf sich nicht ändern, da die Kapazität des Bausteins fest ist. Siehe [[topic:bench-safety|Einschränkungen beim Bearbeiten eines Images]].

## Widerrufen

Jede Änderung ist ein Widerrufsschritt ([[key:undo]]), auch die großen: ein Zusammenfügen, ein Füllen, ein von einem [[topic:tools-overview|Werkzeug]] geschriebener Vorgang, ein in die Quelle zurückgeschriebenes Fragment. Widerrufen wird je Dokument geführt: [[key:undo]] widerruft in dem Dump, der vorn ist — eine Änderung in einer [[topic:fragments|Teilansicht]] wird also im Fragment widerrufen und nicht im Image darunter.
