@source-sha 813491aede3957bc7235957b76199f7793f636dc4963185d73aa8fc27a2be7c3
# Prüfsummen

> Welche Strukturen eines Firmware-Images eine Prüfsumme tragen, welche davon das Programm prüft und welche es schreiben kann.

Viele Firmware-Strukturen tragen eine [[term:checksum|Prüfsumme]] über ihren Header oder ihren Rumpf. Wird ein Byte in einer solchen Struktur geändert und der alte Prüfsummenwert stehen gelassen, stimmt die Struktur nicht mehr mit ihrer eigenen Prüfsumme überein, und wer sie liest — die Firmware, ein Schreibwerkzeug, ein Parser — hält sie für beschädigt.

## Was das UEFI-Werkzeug prüft

[[topic:tool-uefi|UEFI-Struktur]] prüft die Header, während es sie decodiert:

- Ein Knoten, dessen Prüfsumme nicht aufgeht, wird in seiner Zeile rot markiert.
- Die Detailliste nennt den gespeicherten Wert und den richtigen.
- **Prüfsumme korrigieren** im Kontextmenü des Knotens schreibt den richtigen Wert. Das ist ein Schreibvorgang und ein Widerrufsschritt; die Bytes bleiben rot, bis die Datei gesichert wird ([[topic:saving|Sichern]]).

Der Befehl greift bei drei Arten von Knoten:

- **Ein Firmware-Volume** — die Prüfsumme in seinem Header.
- **Eine FFS-Datei** — die Prüfsumme des Headers und die des Rumpfes. Ist das Prüfsummen-Attributbit der Datei nicht gesetzt, muss im Rumpffeld der feste Wert stehen, den die Revision des umgebenden Volumes vorgibt; genau den schreibt der Befehl.
- **Ein Microcode-Bauteil** — die Prüfsumme in seinem Header.

Bei einem Knoten innerhalb einer komprimierten Sektion greift der Befehl nicht: Die Datei hält diese Bytes komprimiert, und das Werkzeug komprimiert sie nicht erneut. Es meldet das und schreibt nichts.

## Was das FIT-Werkzeug prüft

Das Werkzeug [[topic:tool-fit|FIT-Tabelle]] prüft die Prüfsumme der Tabelle selbst und meldet eine Abweichung in seiner Liste der Verstöße, mit dem gespeicherten und dem richtigen Wert. **Prüfsumme korrigieren** im Kontextmenü der Header-Zeile schreibt ihn. Führt das Image eine übereinstimmende [[term:top-swap|Top-Swap]]-Sicherungskopie des Blocks, wird der Wert in beide Kopien geschrieben, und das Werkzeug sagt es.

Eine Microcode-Datei, die **Microcode hinzufügen…** angeboten wird, wird vor dem Schreiben geprüft: Ihre Prüfsumme muss aufgehen. Siehe [[topic:recipe-microcode|Microcode und die FIT-Tabelle]].

## Was eine nicht aufgehende Prüfsumme besagt

Eine nicht aufgehende Prüfsumme ist eine Tatsache über die Bytes. Sie lässt mehrere Erklärungen zu, und das Werkzeug wählt zwischen ihnen nicht aus:

- die Struktur wurde geändert und die Prüfsumme nicht neu berechnet;
- die Bytes der Struktur weichen von den geschriebenen ab, was bei einem von einem Baustein gelesenen Dump ebenso den Lesevorgang wie den Baustein betrifft;
- die Struktur ist nicht das, wofür der Parser sie gehalten hat — dann betrifft die Abweichung die Deutung und nicht die Bytes. Wo die Werkzeuge unsicher sind, sagen sie es; siehe [[topic:provenance|Woher dieses Wissen stammt]].

## Was „Prüfsumme korrigieren“ nicht leistet

Der Befehl schreibt **Prüfsummen** — arithmetische Summen und [[term:crc|CRC]]-Werte, die sich aus den abgedeckten Bytes berechnen lassen und jedem zugänglich sind, der diese Bytes hat.

Er schreibt keine **Signaturen**. Eine kryptografische Signatur über einen Bereich lässt sich ohne den privaten Schlüssel des Herstellers nicht neu berechnen. Ist der Bereich von [[term:boot-guard|Boot Guard]] oder von einem ME-Manifest gedeckt, erzeugt kein Editor eine Signatur, die die Plattform annimmt; das ist eine Eigenschaft der Plattform. Siehe [[topic:flash-writes|Wer in den Flash schreibt]] und [[topic:bench-safety|Einschränkungen beim Bearbeiten eines Images]].
