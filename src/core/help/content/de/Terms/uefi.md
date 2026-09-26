@source-sha 7633b218be3e03ef530bc955599e27375128daf7910555f7655f80d37f130591
@term flash-descriptor
@name Flash Descriptor
@short Die ersten `0x1000` Bytes eines Intel-Flash-Images: die Karte des Chips.

Der Descriptor liegt ganz am Anfang des Dumps und sagt, wo jede [[term:region|Region]] beginnt und endet, welche [[term:flash-master|Master]] sie lesen oder beschreiben dürfen und wie die Straps des Chips gesetzt sind.

Er ist die einzige Struktur hier mit echter Hersteller-Dokumentation — beschrieben in Intels Programming Guides zum Chipsatz —, was dem Panel hier mehr als Reverse Engineering unter die Füße legt.

Am Arbeitsplatz schaut man zuerst hierher: ist der Descriptor beschädigt, ist jede Adresse danach unzuverlässig, und die Platine startet meist gar nicht.

@see term:region
@see topic:tool-uefi

@term flash-master
@name Flash Master
@short Ein Gerät auf der Platine, das an den Flash-Chip herankommt: BIOS, ME, GbE oder EC.

Der [[term:flash-descriptor|Descriptor]] vergibt Rechte nicht an Programme, sondern an *Master* — die vier Anfrager, die der Chipsatz auf seinem SPI-Bus auseinanderhält:

- **BIOS** — der Host, also alles, was die CPU ausführt: die Firmware selbst oder ein Flash-Werkzeug unter dem Betriebssystem.
- **ME** — die [[term:me|Management Engine]], die ihre eigene Region schreibt.
- **GbE** — der kabelgebundene Netzwerk-Controller, für seine eigene Region.
- **EC** — der [[term:ec|Embedded Controller]], und nur im Descriptor der Version 2, ab Skylake.

Jeder Master trägt eine Lese- und eine Schreibmaske, ein Bit je [[term:region|Region]]. Die Masken regeln nur das Schreiben über den Chipsatz: ein [[term:programmer|Programmer]] fragt sie nicht, und die Bytes landen in jeder Region. Der Unterschied zeigt sich beim nächsten Start — das [[term:acm|ACM]] prüft den Bootblock, die Engine ihre eigene Region —, und eine Änderung im [[term:ibb|IBB]] oder in der ME-Region ist dann geschrieben und abgewiesen. Was diese Prüfungen nicht abdecken, bleibt geschrieben und läuft.

@see topic:flash-writes
@see term:flash-descriptor

@term descriptor-mode
@name Deskriptor-Modus
@short Ob der Chipsatz den Flash als ein durchgehendes BIOS liest oder als Karte aus Regionen.

Bis zum ICH7 enthielt ein Firmware-Chip BIOS-Code und sonst nichts: keinen Deskriptor, keine Regionen, keine Zugriffsrechte. Ab dem ICH8 kann der Chipsatz auf zwei Arten starten. Der **Deskriptor-Modus** legt einen [[term:flash-descriptor|Flash-Deskriptor]] in die ersten `0x1000` Bytes, teilt den Chip in [[term:region|Regionen]] mit eigenen Rechten und macht [[term:me|Management Engine]], [[term:gbe-region|GbE-Region]] und [[term:soft-straps|Soft-Straps]] überhaupt erst möglich. Der **Modus ohne Deskriptor** ist die alte durchgehende Aufteilung.

Jeder aktuelle Intel-PCH verlangt einen gültigen Deskriptor; den Modus ohne Deskriptor gibt es nicht mehr. Ein Dump von einem heutigen Board ohne die Signatur `0FF0A55A` am Anfang ist also schlecht gelesen oder unvollständig und keine alte Aufteilung.

Ein Board im Deskriptor-Modus kann seine Firmware außerdem auf **zwei Flash-Chips** verteilen. Das Abbild ist dann beides hintereinander — 4 MB gefolgt von 2 MB ergeben ein Abbild von 6 MB — und beide müssen gelesen und zusammengefügt werden, bevor sich hiervon irgendetwas parsen lässt. Genau dafür ist das [[topic:join-duplicate|Zusammenfügen eines zweiten Dumps]] da.

@see term:flash-descriptor
@see topic:join-duplicate

@term soft-straps
@name Soft-Straps
@short Einstellungen für Chipsatz und CPU, die im Deskriptor liegen und beim Einschalten gelesen werden, vor jeder Firmware.

Ein Strap ist ein Konfigurationsbit, das das Silizium selbst liest. Hard-Straps sind Widerstände auf dem Board; Soft-Straps sind dasselbe, nur im [[term:flash-descriptor|Deskriptor]] — nur deshalb stehen sie überhaupt im Dump.

Die PCH-Straps sagen, wie viele Flash-Chips es gibt, wie schnell sie getaktet werden dürfen, ob der Bus im Dual- oder Quad-Modus läuft, und tragen unter vielem anderen das [[term:hap|HAP-Bit]], mit dem die Management Engine per Software stillgelegt wird. Die CPU-Straps sind überwiegend Debug-Einstellungen: Kernzahl, Hyper-Threading.

ByteRipper nennt die Anzahl der Strap-Wörter im Deskriptor und nicht, was jedes einzelne bedeutet. Ihre Belegung wechselt mit jeder Chipsatzgeneration, und kaum etwas davon ist veröffentlicht; eine Zahl, die das Programm nicht begründen kann, zeigt es nicht.

@see term:flash-descriptor
@see term:hap

@term region
@name Region
@short Ein Bereich des Flash auf oberster Ebene, vom Descriptor festgelegt.

Der Descriptor teilt den Chip in Regionen — Descriptor, BIOS, ME, GbE, PDR, EC und weitere —, jede mit Anfangs- und Endadresse. Eine Region ist die Einheit, die am Arbeitsplatz üblicherweise zwischen Images wandert: jede ist ein für sich geschlossenes Format.

@see term:flash-descriptor
@see term:bios-region
@see term:me-region

@term bios-region
@name BIOS-Region
@short Die Firmware, die der Prozessor ausführt: Volumes, Dateien und Sektionen.

Die größte Region der meisten Images. In ihr liegen [[term:volume|Firmware-Volumes]] und darin die [[term:ffs-file|Dateien]] und [[term:section|Sektionen]], aus denen die UEFI-Firmware besteht: Startcode, Setup-Bildschirme, Treiber.

Das ist die Region, die ein Firmware-Update ersetzt, und die, um die es bei den meisten BIOS-Reparaturen geht.

@see term:volume
@see topic:tool-uefi

@term me-region
@name ME-Region
@short Intel-Management-Engine-Firmware — das Betriebssystem eines eigenen Prozessors, in einer eigenen Region.

Die ME (auf neueren Plattformen CSME) ist ein kleiner eigenständiger Prozessor im Chipsatz mit eigener Firmware, die in einer eigenen Region desselben Flash-Chips liegt. Sie läuft vor und neben der Haupt-CPU und kümmert sich um Energieverwaltung, Provisioning und Sicherheitsfunktionen.

Mit dem Code des BIOS selbst hat sie nichts zu tun und ist ein völlig anderes Format — deshalb hat ByteRipper dafür ein [[topic:tool-me|eigenes Panel]].

! Die ME prüft ihre eigene Firmware, bevor sie sie ausführt. Eine von Hand geänderte ME-Region ergibt keine geänderte Engine, sondern eine Platine, die hängt oder im Takt neu startet.

@see topic:tool-me
@see topic:recipe-me-check

@term gbe-region
@name GbE-Region
@short Die Konfiguration des integrierten Netzwerk-Controllers — mitsamt der MAC-Adresse der Platine.

Klein und platinenspezifisch. Wer die GbE-Region eines Spenders übernimmt, übernimmt dessen MAC-Adresse.

@see topic:recipe-board-data

@term pdr-region
@name PDR-Region
@short „Platform Data Region“ — ein Bereich, den der Platinenhersteller für Eigenes nutzen darf.

Was darin steht, hängt ganz am Hersteller. Behandeln Sie sie als möglicherweise platinenspezifisch: hat der Spender eine und Sie auch, vergleichen Sie beide, bevor Sie überschreiben.

@see topic:recipe-board-data

@term ec-region
@name EC-Region
@short Firmware für den Embedded Controller — den kleinen Chip für Tastatur, Lüfter, Akku und Einschaltsequenz.

In Notebooks liegt die EC-Firmware mal als eigene Region im selben SPI-Chip wie das BIOS, mal in einem eigenen Chip. Eine Platine, die gar nicht angeht oder sofort wieder ausgeht, ist häufiger ein EC- als ein BIOS-Problem.

@term ifwi
@name IFWI
@short „Integrated Firmware Image“ — eine andere Aufteilung des ganzen Chips, zu finden auf Atom- und TXE-Plattformen.

Statt der gewohnten getrennten Regionen trägt ein IFWI-Abbild eine IFWI-Region, die in zwei **logische Bootpartitionen** geteilt ist (LBP1 und LBP2, gleich groß). Jede beginnt mit einer [[term:bpdt|BPDT]], die die darin liegenden Unterpartitionen auflistet: die Firmware der Engine, die IA-Firmware — das ist das BIOS —, die des Power-Management-Controllers, den CPU-Mikrocode. Eine eigene logische Datenregion hält die nichtflüchtigen Daten und das UEFI-[[term:nvram|NVRAM]].

Üblich dort, wo die Firmware auf eMMC statt auf einem SPI-Baustein liegt.

@see term:bpdt
@see term:region

@term volume
@name Firmware-Volume (FV)
@short Ein Container in der BIOS-Region, der Dateien enthält. Sein Header beginnt mit `_FVH`.

Ein Firmware-Volume ist die Einheit, auf der das Dateisystem der Firmware aufbaut. Eine BIOS-Region enthält meist mehrere: ein Boot-Block-Volume, ein oder mehrere Haupt-Volumes, ein NVRAM-Volume.

Der Header eines Volumes nennt seine Länge und seine eigene Prüfsumme, und der Platz hinter der letzten Datei ist sein **freier Speicher** — daran sieht man, wie viel noch hineinpasst.

@see term:ffs-file
@see term:free-space

@term ffs-file
@name FFS-Datei
@short Eine Datei in einem Firmware-Volume, identifiziert über eine [[term:guid|GUID]].

Dateien sind das, was ein Volume enthält. Jede hat eine GUID statt eines Namens, einen Typ (Treiber, Anwendung, Rohdaten, Volume-Abbild) und einen Header mit eigenen Prüfsummen. In einer Datei liegen [[term:section|Sektionen]].

Eine Zeile mit lesbarem Namen wie „DxeCore“ ist eine FFS-Datei, deren GUID der [[topic:databases|Katalog]] kennt.

@see term:section
@see term:pad-file

@term pad-file
@name Füll-Datei
@short Eine Datei, die es nur gibt, damit die nächste echte Datei dort beginnt, wo sie soll.

Eine GUID hat sie nur, weil jeder Datei-Header eine hat — in der Regel lauter Einsen —, und sie benennt nichts. Sie zu übergehen kostet nichts.

@term section
@name Sektion
@short Ein Teil einer FFS-Datei: ihr Code, ihr Name, ihre Version oder ein ganzes weiteres Volume.

Eine Datei besteht aus Sektionen, und Sektionen können ineinander liegen. Die üblichen sind das ausführbare Abbild (PE32), eine komprimierte Sektion (in der wieder Sektionen stecken), eine Oberflächensektion (der lesbare Name der Datei) und eine Versionssektion.

Eine **komprimierte Sektion** kann ByteRipper entpackt öffnen — das Panel klappt sie auf und zeigt, was wirklich darin steckt.

@see topic:fragments

@term free-space
@name Freier Speicher
@short Der unbeschriebene Rest eines Volumes hinter seiner letzten Datei.

Das Panel führt ihn mit Absicht auf: daran sieht man, ob noch ein Modul in ein Volume passt, und seine Größe ist eine schnelle Probe darauf, dass das Längenfeld des Volumes stimmt.

@see term:padding

@term padding
@name Padding
@short Raum zwischen Strukturen, in den nie jemand geschrieben hat.

Gelöschtes Padding ist die Füllmasse eines Dumps — meist `FF`. Der Baum blendet es aus, bis Sie danach fragen: ein großer Dump ist voll davon, und eine Zeile, hinter der nichts steht, ist eine Zeile zum Vorbeiscrollen.

Padding, das **Daten enthält**, wird immer aufgeführt: da liegt etwas, ob der Parser es versteht oder nicht.

@see term:free-space

@term ec-firmware
@name EC-Firmware in einem BIOS-Abbild
@short Der Code des Embedded Controllers, der oft in der BIOS-Region liegt, ohne dass ihn dort etwas benennt.

Seit Skylake kann ein Board eine richtige [[term:ec-region|EC-Region]] haben, die der Deskriptor deklariert. Davor — und auf etlichen Boards auch danach — ist die EC-Firmware schlicht ein Block in der BIOS-Region, den der Parser als [[term:padding|Füllung]] zeigt, meist als die erste.

Woran man sie üblicherweise erkennt:

- **Die Größe.** Verbreitet sind 128 KB (131 072 Bytes) und 192 KB (196 608 Bytes).
- **ITE-Controller** beginnen mit einer Folge von `A5`-Bytes — `A5 A5 A5 A5 A5 A5`.
- **ENE-Controller** tragen die Zeichenfolge `ENE` in den ersten Bytes.
- **Microchip-Firmware (MEC)** liegt häufiger im ersten Volume der BIOS-Region als in einer Füllung.

! Das sind Anzeichen und kein Beweis, und sie stammen aus einer einzelnen Quelle der Community, nicht aus einem Datenblatt. Ein Block ganz ohne Kennzeichen ist völlig normal. Geklärt wird das so, wie dieses Programm gebaut ist: durch den Vergleich mit einem bekannt guten Dump desselben Boards.

@see term:ec-region
@see topic:recipe-donor

@term serial-data
@name Seriennummern, MAC und Lizenzdaten
@short Boardspezifische Daten, die eine Reparatur überleben müssen — und die Stellen, an denen sie sich verstecken.

Ein sauberes Abbild vom Hersteller trägt weder die Seriennummer dieses Boards noch seine MAC-Adresse noch seine Windows-Lizenz. Sie aus dem alten Dump herüberzuholen ist oft die ganze Arbeit, und ein universelles Werkzeug dafür gibt es nicht: Es läuft auf den Vergleich zweier Abbilder hinaus, und dafür ist dieses Programm da.

Wo zu suchen ist:

- **[[term:nvram|NVRAM]]** — die meisten Einstellungen und viele Seriennummern.
- **[[term:padding|Füllung]] zwischen Strukturen.** Auf den meisten Intel-Notebooks von ASUS liegen Seriennummer, Windows-Schlüssel und einige Einstellungen im *zweiten* nicht leeren Füllblock der BIOS-Region.
- **`SMBiosFlashData`** — eine ASUS-Struktur mit der GUID `FD44820B-F1AB-41C0-AE4E-0C55556EB9BD`, die Seriendaten und MAC-Adresse enthält.
- **[[term:gbe-region|GbE-Region]]** — die MAC-Adresse auf Boards mit Intel-Netzwerkcontroller. Nicht jeder Hersteller legt sie dorthin.
- **[[term:slic|SLIC / MSDM]]** — die OEM-Windows-Lizenz.

@see topic:recipe-board-data
@see topic:recipe-donor

@term nvram
@name NVRAM
@short Wo die Firmware ihre Einstellungen zwischen zwei Starts ablegt: Setup-Optionen, Boot-Reihenfolge, Secure-Boot-Schlüssel.

NVRAM liegt in einem eigenen Bereich der BIOS-Region, in einem Format, das vom Firmware-Hersteller abhängt. ByteRipper liest die gängigen — [[term:vss|VSS/VSS2]], FTW, EVSA, FDC und einige herstellereigene — und führt die Variablen darin auf.

Am Arbeitsplatz zählt NVRAM aus zwei Gründen: man kann ihn meist gefahrlos vom Spender übernehmen (die Firmware baut sich neu auf, was sie braucht), und seine Beschädigung ist eine häufige Ursache für eine Platine, die am Herstellerlogo hängt oder bei jedem Start ihre Einstellungen vergisst.

@see term:vss
@see topic:recipe-board-data

@term vss
@name VSS / VSS2
@short Das häufigste NVRAM-Format: ein Speicher benannter Variablen.

Jeder Eintrag ist eine Variable mit Namen (`BootOrder`, `PK`, `Setup`), Hersteller-GUID und Wert. ByteRipper benennt die Zeile nach dem Variablennamen statt nach der GUID: viele Variablen teilen sich eine Hersteller-GUID.

Im selben Bereich finden sich verwandte Speicher: **FTW** (der Eintrag eines fehlertoleranten Schreibvorgangs — das Journal, das ein Variablen-Update einen Stromausfall überstehen lässt), **EVSA**, **FDC**, **CMDB** und herstellereigene Flash-Maps. Das sind die Antworten verschiedener Hersteller auf dieselbe Aufgabe.

@see term:nvram

@term dmi
@name DMI (Desktop Management Interface)
@short Die standardisierten Angaben, die eine Maschine über sich selbst meldet — Seriennummer, UUID, Modell — und der Teil des Abbilds, in dem sie stehen.

DMI ist ein DMTF-Standard, und in der Praxis meinen „DMI" und „SMBIOS" dasselbe: die Tabellen, die die Firmware veröffentlicht, damit ein Betriebssystem sagen kann, auf welcher Maschine es läuft. `dmidecode` unter Linux liest genau diese.

Für die Werkbank zählt, dass dort die Identität der Platine selbst liegt: die Seriennummern von System und Baseboard, die Maschinen-UUID, die Inventarnummer, der Modellname. All das wird im Werk geschrieben und nicht berechnet. Eine Platine mit leeren Feldern verliert Garantieabfrage, Lizenzaktivierung und Verwaltungswerkzeuge.

Verlorene Felder sind nicht immer endgültig verloren. Einige Hersteller — darunter HP und Acer — liefern Service-Werkzeuge, die die Identität neu schreiben; Seriennummer und der Rest werden vom Aufkleber am Gehäuse oder auf der Platine übernommen. Wo es ein solches Werkzeug nicht gibt, bleibt die Übernahme aus dem alten Dump.

Wo diese Felder im Abbild stehen, ist nicht standardisiert. Jeder Hersteller legt sie dorthin, wo er will, und die Aufteilung wandert von Generation zu Generation — deshalb ist das Übertragen Vergleichsarbeit und nichts, was ein Werkzeug abnimmt.

@see term:serial-data
@see topic:recipe-board-data

@term slic
@name SLIC / MSDM
@short OEM-Lizenzdaten von Windows, in der Firmware abgelegt.

Eine ACPI-Tabelle, die die Firmware veröffentlicht, damit ein vorinstalliertes Windows ohne Schlüssel aktiviert. Auf älteren Maschinen ist das SLIC, auf neueren MSDM. Die Daten hängen an Platine und Lizenz: mit denen eines Spenders überschrieben, aktiviert die Maschine unter Umständen nicht mehr.

@see topic:recipe-board-data

@term capsule
@name Capsule
@short Eine Update-Datei in einer Hülle, kein rohes Chip-Abbild.

Ein beim Hersteller geladenes Firmware-Update ist oft eine Capsule: das Image plus ein Header, der sagt, was womit aktualisiert wird. ByteRipper liest durch die Hülle hindurch und zeigt, was darin steckt.

Öffnet sich eine Datei als Capsule, denken Sie daran: das ist ein **Update**, kein Dump, und es muss nicht jede Region enthalten, die der Chip hat.

@term microcode
@name Microcode-Update
@short Ein Patch für den Prozessor selbst, geladen vor jedem Firmware-Code.

Intel legt Microcode-Updates in das Firmware-Image. Der Prozessor lädt sehr früh im Start das zu seiner Signatur passende — über die [[term:fit|FIT]].

Jedes Update trägt in seinem Header die CPU-Signatur, eine Revisionsnummer und ein Datum; danach benennt ByteRipper sie.

@see term:fit
@see topic:recipe-microcode

@term fit
@name FIT (Firmware Interface Table)
@short Eine Tabelle dessen, was der Prozessor laden muss, bevor er BIOS-Code ausführt.

Die FIT wird über einen Zeiger an einer festen Adresse nahe der oberen Flash-Grenze gefunden. Ihre Einträge zeigen — mit absoluten Adressen — auf [[term:microcode|Microcode-Updates]], ACMs, Boot-Guard-Manifeste und Policy-Einträge.

Weil die Adressen absolut sind, darf sich nichts bewegen, worauf eine FIT zeigt. Ein FIT-Eintrag, der in gelöschten Flash zeigt, ist eine Platine, die gar nicht erst startet.

@see topic:tool-fit
@see topic:recipe-microcode

@term reset-vector
@name Reset-Vektor
@short Die Adresse, an der ein x86-Prozessor zu arbeiten beginnt: ganz oben im Adressraum, bei `0xFFFFFFF0`.

Das obere Ende der Adresskarte liegt am Firmware-Chip, also kommt der allererste Befehl, den die CPU je ausführt, aus dem Flash — sechzehn Bytes vor dem Ende des Abbilds, und darin ein Sprung in die [[term:sec-phase|Security-Phase]]. Der Zeiger auf die [[term:fit|FIT]] liegt knapp darunter, bei `0xFFFFFFC0`.

Auf einem heutigen Board ist das nicht mehr der Anfang der Geschichte. Die [[term:me|Management Engine]] läuft zuerst an und nimmt die CPU erst danach aus dem Reset; der [[term:microcode|Mikrocode]], den die FIT nennt, wird vor dem Reset-Vektor angewendet; und auf einer [[term:boot-guard|Boot-Guard]]-Plattform hat längst ein [[term:acm|ACM]] den Code geprüft, zu dem der Reset-Vektor gehört. Der Reset-Vektor ist früh, aber nicht der Erste.

@see term:fit
@see term:sec-phase

@term sec-phase
@name SEC (Security-Phase)
@short Die erste UEFI-Phase: eine Maschine, in der noch kein Speicher arbeitet.

In SEC ist das System vollständig unkonfiguriert — die CPU ist noch im 16-Bit-Modus, DRAM läuft nicht. Die ganze Aufgabe der Phase ist, bis zur nächsten zu kommen: in den 32-Bit-Modus wechseln, einen vorläufigen Speicher einrichten (meist den CPU-Cache als RAM), den Flash in den Adressraum einblenden, [[term:pei-phase|PEI]] prüfen und übergeben.

@see term:reset-vector
@see term:ibb

@term pei-phase
@name PEI (Pre-EFI Initialization)
@short Die Phase, die den Speicher hochbringt, Modul für Modul.

Die PEI-Module — PEIMs — laufen in der Reihenfolge ihrer Abhängigkeiten: Cache und Takt der CPU, der Speichercontroller, der I/O-Hub und schließlich das DRAM selbst. PEI endet mit der Prüfung des Bootmodus: Eine Rückkehr aus S3 geht ins Boot-Script, alles andere übergibt an [[term:dxe-phase|DXE]].

Jedes PEIM liegt als eigene [[term:ffs-file|FFS-Datei]] eines eigenen Typs im Abbild — deshalb lohnt sich die Spalte „Typ“ in der Panel-Ansicht, wenn man frühen von spätem Code unterscheiden will.

@see term:sec-phase
@see term:ibb

@term dxe-phase
@name DXE / BDS
@short Die Phase, in der die eigentlichen Treiber laufen, und die, die auswählt, wovon gebootet wird.

Der größte Teil eines Firmware-Abbilds sind DXE-Treiber: Laufwerke, Netzwerk, Grafik, die Setup-Bildschirme, die Zutaten des Herstellers. Sie werden in den [[term:volume|Volumes]] gefunden, auf ihre Bedingungen geprüft und ausgeführt, bis keiner mehr übrig ist. Danach entscheidet der Treiber Boot Device Select (BDS), wovon gebootet wird, und tut es.

DXE ist der Teil, den [[term:boot-guard|Boot Guard]] nicht selbst prüft — siehe [[term:ibb|IBB / OBB]]. Deshalb kann eine Änderung hier auf einem Board durchgehen, auf dem eine Änderung am Bootblock nie durchginge.

@see term:volume
@see term:ibb

@term boot-guard
@name Boot Guard
@short Eine im Silizium verankerte Prüfung, dass die frühe Firmware die ist, die der Boardhersteller signiert hat.

Boot Guard macht das Silizium und nicht die Firmware zu dem, was entscheidet, ob die Firmware laufen darf. Was bei einer fehlgeschlagenen Prüfung geschieht, steht am Ende der Fertigung in den [[term:otp|Fuses]] des Chipsatzes fest, und nichts, was in den Flash geschrieben wird, ändert daran etwas.

Wie ein Board mit Boot Guard hochkommt:

1. Die [[term:me|Management Engine]] startet aus ihrem eigenen ROM auf dem Die, prüft ihre eigene Firmware und nimmt erst danach die Haupt-CPU aus dem Reset.
2. Die CPU findet die [[term:fit|FIT]] und wendet den [[term:microcode|Mikrocode]] an, den die Tabelle nennt.
3. Die CPU lädt das Startup-[[term:acm|ACM]], das die FIT nennt, und führt es aus dem Cache aus. Der Mikrocode prüft das ACM gegen einen Schlüssel, den Intel in den Prozessor gebrannt hat — die Kette beginnt also bei etwas, dem das Silizium ohnehin vertraut.
4. Das ACM liest den Schlüssel-Hash des Herstellers und das [[term:boot-guard-profile|Profil]] aus den Fuses des Chipsatzes.
5. Das ACM prüft das [[term:key-manifest|Key Manifest]] im Abbild gegen diesen gebrannten Hash. Das ist das Glied, das *diesen* Flash an *diesen* Chipsatz bindet.
6. Das Key Manifest bürgt für den Schlüssel, der die [[term:boot-policy|Boot Policy]] signiert; die Boot Policy nennt die Bereiche des [[term:ibb|IBB]] und ihre Hashes; das ACM prüft sie.
7. Erst dann läuft der [[term:reset-vector|Reset-Vektor]] — innerhalb von Code, der bereits geprüft ist.

Welche Bereiche abgedeckt sind, erklärt das Abbild selbst. Das [[topic:tool-uefi|UEFI-Panel]] zählt diese **geschützten Bereiche** in seiner Zusammenfassungszeile.

! Bytes innerhalb eines geschützten Bereichs lassen sich nicht ändern. Die Signatur passt dann nicht mehr, und ohne den privaten Schlüssel des Herstellers ist sie nicht neu zu berechnen. Kein Werkzeug repariert das; genau darin besteht der Sinn der Sache.

@see term:boot-guard-profile
@see topic:bench-safety

@term acm
@name ACM (Authenticated Code Module)
@short Ein kleines signiertes Modul, das die CPU aus ihrem eigenen Cache ausführt, bevor es brauchbaren Speicher gibt.

Ein ACM ist von Intel signiert und wird vom Mikrocode der CPU gegen einen im Die gebrannten Schlüssel geprüft. Nur das macht es zum ersten Glied einer Vertrauenskette: Im Flash bürgt nichts für es.

Das **Startup-ACM** ist dasjenige, das [[term:boot-guard|Boot Guard]] benutzt. Ein Eintrag in der [[term:fit|FIT]] benennt es, und es hat die strengste Platzierungsregel der ganzen Tabelle: In dem Bereich, aus dem es läuft, darf nichts außer ihm selbst stehen.

@see term:fit
@see term:boot-guard

@term key-manifest
@name Boot Guard Key Manifest (KM)
@short Die Hälfte der Bindung „dieser Flash — dieser Chipsatz“, die im Abbild liegt.

Das Key Manifest enthält den öffentlichen Schlüssel des Boardherstellers und den Hash des Schlüssels, der die [[term:boot-policy|Boot Policy]] signiert. Das Startup-[[term:acm|ACM]] hasht den Herstellerschlüssel darin und vergleicht das Ergebnis mit dem Wert, der in die [[term:otp|Fuses]] des Chipsatzes gebrannt ist.

Dieser gebrannte Hash ist alles, was das Silizium über den Hersteller weiß: ein Wert, einmal gesetzt, nie neu geschrieben. Er ist es, der ein signiertes Abbild zu einer Boardfamilie gehören lässt statt zu Firmware im Allgemeinen.

! Das Key Manifest durch ein selbst signiertes zu ersetzen funktioniert nicht: Ihr Schlüssel hasht zu etwas anderem, und der gebrannte Wert lässt sich nicht daran anpassen. Die Reparatur besteht darin, die Originalbytes des Herstellers zurückzuschreiben — ein weiterer Grund, warum der Sicherungsdump die wertvollste Datei an der Werkbank ist.

@see term:boot-policy
@see term:boot-guard

@term boot-policy
@name Boot Policy Manifest (BPM)
@short Was genau geschützt ist: die Bereiche des Bootblocks und ihre Hashes.

Die Boot Policy nennt die Bereiche, aus denen der [[term:ibb|Initial Boot Block]] besteht, und hält für jeden einen Hash fest, damit das [[term:acm|ACM]] genau diese Bytes prüfen kann. Signiert ist sie mit einem Schlüssel, für den das [[term:key-manifest|Key Manifest]] bürgt — so erbt sie das Vertrauen, das die Fuses begonnen haben.

Die geschützten Bereiche, die das [[topic:tool-uefi|UEFI-Panel]] zählt, sind die, die hier deklariert werden.

@see term:key-manifest
@see term:ibb

@term ibb
@name IBB / OBB
@short „Initial Boot Block“ — der Teil der Firmware, den Boot Guard selbst prüft; der Rest ist Sache des Herstellers.

Der IBB ist ungefähr der Code von [[term:sec-phase|SEC]] und [[term:pei-phase|PEI]]: die frühe Firmware bis zu dem Punkt, an dem der Speicher arbeitet. Genau den hasht das [[term:acm|ACM]] und vergleicht ihn mit der [[term:boot-policy|Boot Policy]].

Alles danach ist der **OBB**, der „OEM Boot Block“, praktisch die [[term:dxe-phase|DXE]]-Hälfte. Vom IBB wird erwartet, dass er den OBB prüft, bevor er ihn ausführt — mit Code, den der Boardhersteller schreibt. Ob ein bestimmter Hersteller das tut, bleibt ihm überlassen.

Daher kommt es, dass ein Panel manche Bereiche als geschützt kennzeichnet und andere nicht, und dass dieselbe Art von Änderung im einen Teil eines Abbilds unmöglich und im anderen Alltag ist.

@see term:boot-guard
@see term:boot-policy

@term boot-guard-profile
@name Boot-Guard-Profil
@short Was das Board tut, wenn die Prüfung fehlschlägt — in den Chipsatz gebrannt, nicht im Abbild gespeichert.

Drei voneinander unabhängige Dinge, und die Namen setzen sich daraus zusammen:

- **Verified Boot (V)** — die Firmware wird gegen die Signatur geprüft und bei Abweichung abgelehnt.
- **Measured Boot (M)** — die Firmware wird in das TPM gehasht, damit später etwas bemerken kann, dass sie sich geändert hat. Für sich genommen hält es nichts auf.
- **Durchsetzung** — sofortiges Abschalten, Abschalten nach einem Timeout oder gar nichts.

Die Profile in ihrer üblichen Schreibweise:

- `No_FVME` — Boot Guard abgeschaltet.
- `VE` — Verified Boot, Abschalten nach Timeout.
- `VME` — Verified und Measured, Abschalten nach Timeout.
- `VM` — Verified und Measured, aber **ohne Durchsetzung**: Das Board bootet trotzdem.
- `FVE` — Verified Boot, sofortiges Abschalten.
- `FVME` — Verified und Measured, sofortiges Abschalten.

Den *gebrannten* Wert bekommt kein Werkzeug aus dem Die eines [[term:pch|Chipsatzes]] heraus, der bereits auf einem Board verbaut ist, ByteRipper eingeschlossen: Er liegt in den [[term:otp|Fuses]], und nichts im Abbild sagt, womit ein bestimmtes Exemplar gebrannt wurde.

Wohl aber kann ein Abbild sagen, womit es einen neuen [[term:pch|Chipsatz]] brennen wird, der noch nie auf einem Board verbaut war. Genau das ist der Fall nach einem Tausch des [[term:pch|Hubs]]: Das Profil und der Schlüssel-Hash des Herstellers liegen als Konfiguration in der [[term:me-region|ME-Region]], von Intels Image-Werkzeug dort hineingeschrieben, und daneben steht die Einstellung, ob sie beim ersten Einschalten des Boards übernommen werden. Diese beiden Felder liest ByteRipper noch nicht. Was es heute zeigt, sind die [[term:boot-policy|geschützten Bereiche]], die das Abbild deklariert.

! Ein Board mit dem Profil `VM` bootet auch mit verändertem Bootblock. Genau deshalb macht eine Änderung, die auf einer Maschine „funktioniert hat“, die nächste zum Briefbeschwerer: Das Profil ist eine Eigenschaft des Boards, nicht des Abbilds.

@see term:boot-guard
@see term:otp

@term secure-boot
@name Secure Boot
@short Etwas anderes als Boot Guard: Hier prüft die Firmware den Bootloader des Betriebssystems.

Secure Boot gehört zur UEFI-Spezifikation und liegt im [[term:nvram|NVRAM]] als ein Satz von Datenbanken:

- **db** — die Datenbank erlaubter Abbilder: Schlüssel und Hashes von Bootloadern, die laufen dürfen.
- **dbx** — die Datenbank verbotener Abbilder, die Widerrufsliste.
- **dbt** und **dbr** — die Datenbanken für Zeitstempel und Wiederherstellung.

Darüber stehen die Key Exchange Keys (**KEK**), die diese Datenbanken aktualisieren dürfen, und der Platform Key (**PK**), dem die KEKs gehören und der den Eigentümer des Boards vertritt.

! Nicht mit [[term:boot-guard|Boot Guard]] verwechseln. Secure Boot schaut nach außen, auf das, was die Firmware zu booten im Begriff ist, und lässt sich im Setup abschalten. Boot Guard schaut nach innen, auf die Firmware selbst, und lässt sich gar nicht abschalten. Wer NVRAM von einem Spender übernimmt, ersetzt damit die Secure-Boot-Schlüssel dieser Maschine durch die des Spenders — ein häufiger Grund dafür, dass eine reparierte Maschine ein Betriebssystem nicht mehr bootet, mit dem vorher alles in Ordnung war.

@see term:nvram
@see term:boot-guard

@term top-swap
@name Top Swap
@short Eine Chipsatz-Funktion, die eine zweite Kopie des Boot-Blocks einblendet, wenn die erste versagt.

Die Platine hält zwei Boot-Blöcke, und ein Chipsatz-Bit entscheidet, welchen der Prozessor sieht. Das ist ein Wiederherstellungsmechanismus: ein missglücktes Beschreiben der einen Kopie kann überlebbar sein.

Am Arbeitsplatz gut zu wissen, weil ein Image damit berechtigterweise zwei fast gleiche Boot-Blöcke enthalten kann — und ein Vergleich zeigt beide.

@see topic:tool-fit

@term vscc
@name VSCC-Tabelle
@short Die Liste der Flash-Chips, die der Descriptor anzusteuern weiß.

„Vendor Specific Component Capabilities“: je unterstütztem Chip die Befehle und Zeiten, die der Chipsatz mit ihm verwenden soll. Wurde eine Platine mit einem Flash-Chip repariert, dessen ID nicht in dieser Tabelle steht, funktioniert das Beschreiben „von innen“ womöglich nicht — ein externer Programmer schon.

@see term:flash-descriptor

@term non-uefi-data
@name Nicht-UEFI-Daten
@short Bytes im Image, die der Parser als keine bekannte Struktur erkennt.

Kein Fehler. Hersteller legen ständig Eigenes in Firmware-Images, und ein EC-Image oder ein Option-ROM innerhalb einer BIOS-Region ist ein Format für sich.

Es ist aber die Stelle, an der man nachsieht, wenn etwas nicht aufgeht: eine Region, die Volumes sein sollte und sich als Nicht-UEFI-Daten liest, ist eine beschädigte Region.

@see topic:tool-zones
