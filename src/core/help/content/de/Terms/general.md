@source-sha 50639b45cd239c47487ba73158f9994115e84384ab2392b9c9a01ceab9c59869
@term dump
@name Dump
@short Der Inhalt eines Chips, in eine Datei ausgelesen.

Ein Dump ist das, was ein Programmer liefert, wenn er einen Flash-Chip ausliest: jedes Byte der Reihe nach, beginnend bei Adresse null. Seine Größe ist die Kapazität des Chips.

Weil die Datei der Chip ist, ist ein Offset in der Datei eine Adresse auf dem Chip — deshalb vergleicht ByteRipper nach Adresse und verschiebt nie eine Datei gegen die andere.

@see topic:overview
@see term:offset

@term offset
@name Offset (Adresse)
@short Die Position eines Bytes in der Datei, von null an gezählt.

Offsets sind in ByteRipper nullbasiert und werden hexadezimal angezeigt. Offset `0` ist das erste Byte, Offset `0x1000` das 4097.

Überall, wo das Programm einen Offset entgegennimmt, braucht Hex das Präfix `0x` und Dezimal gar keines.

Bereiche sind intern halboffen: `[Anfang, Ende)`, wobei das Ende das erste Byte ist, das **nicht** dazugehört. Ein Dialog darf ein einschließendes Ende anbieten und rechnet es für Sie um.

@see topic:navigation

@term checksum
@name Prüfsumme
@short Eine kleine Zahl in einer Struktur, an der sich erkennen lässt, dass sie beschädigt wurde.

Eine Prüfsumme wird aus den eigenen Bytes einer Struktur berechnet und in ihr abgelegt. Wer die Struktur später liest, rechnet nach: stimmt es nicht überein, hat sich etwas geändert.

Das ist Arithmetik, keine Kryptografie. Nachrechnen kann sie jeder — deshalb kann ByteRipper anbieten, sie zu korrigieren, und deshalb sagt eine korrekte Prüfsumme nichts darüber, wer die Bytes geschrieben hat.

@see topic:recipe-checksums
@see term:crc

@term crc
@name CRC
@short Die kräftigere Prüfsumme, und die, die die meisten Firmware-Strukturen verwenden.

Ein CRC — hier meist CRC-32 — erkennt, was eine einfache Summe übersieht: eine Umstellung, einen verschobenen Block, eine Reihe gekippter Bits. In Firmware-Tabellen ist er verbreitet.

Wie jede Prüfsumme schützt er gegen Zufall, nicht gegen Absicht: wer die Bytes geändert hat, rechnet auch ihn nach.

@see term:checksum

@term signature
@name Signatur
@short Ein Wort für zwei Dinge: eine Magic-Kennung und eine kryptografische Signatur.

Eine **Magic-Signatur** ist eine kurze feste Zeichenfolge am Anfang einer Struktur, die sagt, was sie ist: `_FVH` bei einem Firmware-Volume, `$FPT` bei der ME-Partitionstabelle, `_FIT_` bei der Interface-Tabelle. So findet ein Parser Dinge in einem rohen Dump, und danach sucht man üblicherweise mit [[topic:search|⌘F]].

Eine **kryptografische Signatur** ist eine Zahl, die mit einem privaten Schlüssel über einen Bereich berechnet wurde. Sie beweist, wer diese Bytes hergestellt hat, und ohne den Schlüssel lässt sie sich nicht nachrechnen. Deshalb sind manche Teile eines Firmware-Images grundsätzlich nicht zu ändern.

@see term:manifest
@see term:boot-guard

@term guid
@name GUID
@short Eine 16-Byte-Kennung. UEFI benennt damit fast alles.

Eine GUID sieht so aus: `8C8CE578-8A3D-4F1C-9935-896185C32DD3`. In einem Firmware-Image werden Dateien, Sektionen, Volumes und NVRAM-Variablen über GUIDs identifiziert, nicht über Namen.

Für sich genommen bedeutet eine GUID nichts — deshalb lädt das Programm einen [[topic:databases|Gemeinschaftskatalog]] mit Namen für die bekannten. Eine Zeile mit nackter GUID ist eine Struktur, für die der Katalog keinen Namen hat — kein Fehler.

@see term:ffs-file
@see topic:databases

@term zone
@name Zone
@short Der farbige Umriss, mit dem ein Firmware-Panel einen Byte-Bereich im Dump markiert.

Wählen Sie eine Zeile in einem Firmware-Panel, veröffentlicht das Panel deren Byte-Bereich als Zone: ein Umriss samt Tönung über diesen Bytes in der Hex-Ansicht und ein Band in der [[topic:minimap|Minimap]].

Eine Zone ist ein Umriss und keine Hintergrundfüllung, verdeckt also nie einen Unterschied oder eine ungesicherte Änderung darunter.

@see topic:tools-overview
@see topic:tool-zones

@term flash-chip
@name SPI-Flash-Chip
@short Der Chip, in dem die Firmware steckt: feste Kapazität, gelöscht heißt `FF`.

Ein serieller Flash-Chip trägt die Firmware der Platine. Zwei Eigenschaften zählen hier:

- **Seine Größe steht fest.** Ein Image für einen 8-MB-Chip muss exakt 8 MB groß sein. Deshalb darf am Arbeitsplatz nichts die Länge eines Dumps verändern.
- **Gelöscht heißt `FF`.** Flash wird auf Einsen gelöscht. Eine lange Kette `FF` im Dump ist leerer Raum, kein Schaden; eine lange Kette `00` ist dagegen meist beschriebene Fläche.

@see topic:bench-safety

@term programmer
@name Programmer
@short Die Hardware, die den Chip liest und schreibt. ByteRipper spricht nicht mit ihr.

ByteRipper arbeitet mit Dateien. Die Bytes vom Chip zu holen und wieder daraufzuschreiben ist Sache des Programmers — Clip, Sockel oder In-Circuit-Verbindung, mit seiner eigenen Software.

Diese Trennung ist Absicht: das Programm lässt sich mit dem Dump jedes Programmers benutzen, und es kann niemals versehentlich auf eine Platine schreiben.

@term bios
@name BIOS
@short „Basic Input/Output System“ — die Firmware, die einen PC hochbringt, bevor irgendein Betriebssystem läuft.

Das BIOS ist der erste Code, den der Prozessor ausführt. Es erkennt und initialisiert die Hardware, fährt den [[term:post|Einschaltselbsttest]] und übergibt an einen Bootloader auf einem Laufwerk.

Streng genommen meint das Wort die ältere Firmware vor UEFI; auf einem heutigen Board läuft [[term:uefi|UEFI]]. An der Werkbank werden beide Wörter nebeneinander benutzt, und „BIOS-Chip“ heißt der Flash mit der Firmware, egal welche davon es ist.

@see term:uefi
@see term:bios-region

@term uefi
@name UEFI
@short „Unified Extensible Firmware Interface“ — die heutige Standard-Firmware eines PCs und das Format, das dieses Programm liest.

UEFI ersetzte das BIOS durch eine festgelegte Schnittstelle zwischen Firmware und Betriebssystem und durch Firmware, die aus Treibern und Anwendungen besteht statt aus einem monolithischen Block. Diese Modularität ist der Grund, warum ein UEFI-Abbild sich als Baum aus Volumes, Dateien und Sections öffnet und nicht als Wand aus Bytes.

Die Referenzimplementierung ist das quelloffene TianoCore EDK II. Firmware-Hersteller forken es, Boardhersteller ändern es noch einmal — deshalb können zwei Abbilder für zwei verschiedene Boards gleich aufgebaut sein und fast kein Byte gemeinsam haben.

@see term:bios
@see topic:tool-uefi

@term post
@name POST
@short „Power-On Self-Test“ — die Prüfung der Hardware, die die Firmware selbst vornimmt, noch vor jedem Bootvorgang.

Die Firmware erkennt und prüft Speicher, Grafik und Laufwerke, bevor sie nach einem Betriebssystem sucht. Ein Board, das „keinen POST macht“, ist bis dahin nicht gekommen — an der Werkbank heißt das: frühe Firmware, [[term:me|Management Engine]] oder die Hardware selbst, aber nicht das Betriebssystem.

@see topic:bench-safety

@term spi
@name SPI
@short „Serial Peripheral Interface“ — der Bus aus wenigen Leitungen, an dem der Firmware-Chip hängt.

Der Flash-Chip spricht über vier Signale plus Versorgung mit dem Chipsatz. Der Bus ist langsam und einfach — deshalb kommt ein Programmiergerät mit Klammer damit zurecht, und deshalb dauert ein vollständiger Dump von 16 MB Minuten statt Sekunden.

Manche Plattformen fahren den Bus im Dual- oder Quad-Modus, mit zwei oder vier Datenleitungen statt einer. Welchen Modus ein Board nutzt, steht in den [[term:soft-straps|Straps]] des [[term:flash-descriptor|Deskriptors]].

@see term:flash-chip
@see term:programmer

@term pch
@name PCH / ICH / FCH
@short Der Chipsatz: der zweite Baustein auf dem Board, dem der Firmware-Flash gehört.

Intels Namen dafür, vom ältesten an: ICH (I/O Controller Hub), dann PCH (Platform Controller Hub). AMDs Gegenstück heißt FCH (Fusion Controller Hub). Alle drei enden auf Hub — deshalb sagt die Werkbank ebenso oft Hub wie Chipsatz.

Hier ist er gleich doppelt wichtig. Den Flash liest der Chipsatz, nicht die CPU, und er setzt auch durch, welcher Master welche [[term:region|Region]] beschreiben darf. Und bei Intel sitzt die [[term:me|Management Engine]] physisch in ihm — zusammen mit den [[term:otp|Fuses]], in denen die [[term:boot-guard|Boot-Guard]]-Konfiguration des Boards liegt.

@see term:region
@see term:otp

@term ec
@name EC
@short „Embedded Controller“ — der kleine Mikrocontroller für Tastatur, Lüfter, Akku und Einschaltreihenfolge.

In einem Notebook bekommt der EC als Erstes Strom und entscheidet, ob das Hauptsystem überhaupt hochkommt. Er hat eine eigene Firmware, die auf einem eigenen Chip liegen oder sich den Flash mit dem BIOS teilen kann.

@see term:ec-region
@see term:ec-firmware

@term otp
@name OTP / Fuses
@short „One-Time Programmable“ — Bits in einem Chip, die einmal gesetzt und nie wieder gelöscht werden.

Field-programmable Fuses werden am Ende der Fertigung gebrannt. Danach sind sie endgültig nur noch lesbar: keine Firmware, kein Programmiergerät und kein noch so häufiges Neubeschreiben des Flashes ändert sie.

Genau deshalb lässt sich [[term:boot-guard|Boot Guard]] nicht aus einem Dump heraus abschalten. Seine Konfiguration und der Hash des Herstellerschlüssels liegen in Fuses im Chipsatz.

@see term:boot-guard
@see term:pch

@term lpc
@name LPC
@short „Low Pin Count“ — ein alter, langsamer Bus, der für Embedded Controller und TPM-Header noch in Gebrauch ist.

Manche Boards lassen sich so konfigurieren, dass die Firmware über LPC statt über SPI gelesen wird. Selbst dann braucht eine Intel-Plattform noch einen gültigen [[term:flash-descriptor|Deskriptor]] am SPI-Bus.

@see term:spi

@term bmc
@name BMC
@short „Baseboard Management Controller“ — der Fernwartungsprozessor eines Serverboards, mit eigener Firmware.

Ein BMC ist das, was ein Desktop nicht hat: Er läuft, während die Maschine aus ist, und stellt eine entfernte Konsole bereit. Seine Firmware ist ein eigenes Abbild auf einem eigenen Chip und nicht Teil eines UEFI-Dumps.

@term psp
@name AMD PSP
@short „Platform Security Processor“ — AMDs Gegenstück zur Intel Management Engine.

Der PSP ist ein kleiner Prozessor im AMD-Chipsatz mit eigener Firmware und eigener Rolle beim Start. Anders als die [[term:me-region|ME-Region]] ist er keine Region, die der Deskriptor deklariert: In einem AMD-Abbild liegt die PSP-Firmware zwischen den UEFI-Dateisystemen eingebettet.

@see term:me

@term ibv
@name OEM / IBV / ODM
@short Wer welchen Teil der Firmware gemacht hat, die Sie gerade ansehen.

- **IBV** — Independent BIOS Vendor: AMI, Insyde, Phoenix. Sie nehmen EDK II und bauen daraus die Plattform, mit der ein OEM anfängt.
- **OEM** — die Marke auf dem Gehäuse: Dell, HP, ASUS, Lenovo. Sie konfigurieren und erweitern die Firmware des IBV.
- **ODM** — das Werk, das das Board tatsächlich entwirft und baut.

Beim Lesen eines Abbilds lohnt es sich, das auseinanderzuhalten: Der Aufbau aus Volumes und Dateien stammt meist vom IBV, die Einstellungen, das Logo und die [[term:serial-data|boardspezifischen Daten]] vom OEM.

@see term:serial-data

@term tcb
@name TCB
@short „Trusted Computing Base“ — der Teil eines Systems, dem alles andere vertrauen muss, weil ihn selbst nichts prüft.

Jede Prüfkette hört irgendwo auf. Auf einem Intel-Board hört sie im Mikrocode der CPU und in den [[term:otp|Fuses]] des Chipsatzes auf: Sie prüfen das [[term:acm|ACM]], das die Manifeste prüft, die die Firmware prüfen — und sie selbst prüft niemand. Das ist die TCB.

Praktisch gelesen: Je kleiner der Teil ist, den niemand prüft, desto besser — und alles, was Sie in einem Dump ändern können, liegt per Definition außerhalb davon.

@see term:boot-guard
