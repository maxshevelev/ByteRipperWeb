@source-sha 148209c46431231bc5478e9bd5a190ec395f01ca2eb12752bafb0338fccaff80
@term flash-descriptor
@name Flash Descriptor
@short Die ersten `0x1000` Bytes eines Intel-Flash-Images: die Karte des Chips.

Der Descriptor liegt ganz am Anfang des Dumps und sagt, wo jede [[term:region|Region]] beginnt und endet, welche [[term:flash-master|Master]] sie lesen oder beschreiben dürfen und wie die Straps des Chips gesetzt sind.

Er ist die einzige Struktur hier mit echter Hersteller-Dokumentation — beschrieben in Intels Programming Guides zum Chipsatz —, sodass das, was das Werkzeug darüber sagt, auf mehr als Reverse Engineering ruht.

Die Chipsatz-Generation steht nicht im Descriptor. ByteRipper erkennt sie daran, wo der Descriptor seine Abschnitte ablegt und wie lang sie sind — nach denselben Regeln wie flashrom —, und nennt sie in den Details unter **Chipsatz**. Generationen mit gleichem Aufbau lassen sich nicht unterscheiden und werden gemeinsam genannt, etwa Alder Point / Raptor Point; ein Aufbau, den keine Regel erfasst, wird wie der nächstliegende bekannte gelesen und als vermutet gekennzeichnet. Von der Generation hängt ab, wie der Rest zu lesen ist: wie viele Regionen die Tabelle enthält, ob die Masken eines Masters ein Byte oder zwölf Bit breit sind und was ein Taktcode bedeutet.

Aus dem Komponentenabschnitt nennen die Details die Größe jedes Flash-Chips, für den das Image ausgelegt ist (**Größe der Flash-Chips**), bei zwei Chips die Adresse, an der der zweite beginnt; die SPI-Takte, mit denen der Chipsatz ID und Status des Chips liest, schreibt und löscht sowie Fast Read ausführt; und die Opcodes, die der Chipsatz nicht an den Chip sendet (**Gesperrte Opcodes**). Ein Ersatzchip muss für diese Takte ausgelegt sein. Ergeben die Chips zusammen eine andere Länge als der Dump, wird die Zeile hervorgehoben: Der Dump enthält nur einen von zwei Chips oder wurde mit falscher Größe gelesen. Die **Regionstabelle** listet jede Region mit Anfang und Ende so, wie der Descriptor sie angibt.

Ist der Descriptor beschädigt, ist jede danach gerechnete Adresse unzuverlässig.

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

Der Descriptor teilt den Chip in Regionen — Descriptor, BIOS, ME, GbE, PDR, EC und weitere —, jede mit Anfangs- und Endadresse. Eine Region ist die Einheit, die üblicherweise zwischen Images übertragen wird: Jede ist ein für sich geschlossenes Format.

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

Das Statusbyte im Header hält fest, wie weit das Schreiben der Datei gekommen ist: Header geschrieben, Daten geschrieben, zur Aktualisierung markiert, gelöscht. Es kann den Header auch als ungültig markieren; die Firmware übernimmt die Datei dann nicht. ByteRipper liest das Byte sowohl unter der Löschpolarität des Volumes als auch unter dem eigenen Polaritätsbit der Datei. Markiert es den Header in beiden Fällen als ungültig, steht in der Zeile **State** **Header als ungültig markiert**, und beide Prüfsummen werden als nicht geprüft statt als falsch angezeigt: Eine Datei, die die Firmware übergeht, schuldet keine Prüfsumme, und **Fix Checksum** hat nichts zu schreiben. Eine Datei, die unter einer der beiden Lesarten gültig ist, wurde unter der anderen Polarität geschrieben und wird wie gewohnt geprüft.

@see term:section
@see term:pad-file

@term pad-file
@name Padding-Datei
@short Eine Datei, die es nur gibt, damit die nächste echte Datei dort beginnt, wo sie soll.

Eine GUID hat sie nur, weil jeder Datei-Header eine hat — in der Regel lauter Einsen —, und sie benennt nichts. Ist sie leer, kann sie unbedenklich übergangen werden.

Leer ist eine Padding-Datei allerdings nicht immer. Die Datei unmittelbar vor der Volume Top File enthält häufig die Startup AP data: einen Sprung, den die übrigen Prozessorkerne beim Start als Erstes ausführen und der sie zu ihrem Einsprungpunkt in der Volume Top File führt. Ihre Adresse ist fest vorgegeben. ByteRipper zeigt eine solche Datei als **Padding-Datei mit Startup AP data** an; sie darf weder verschoben noch überschrieben werden. Andere Daten in einer Padding-Datei erscheinen als **Nicht-UEFI-Daten**, die Datei selbst als **Nicht leere Padding-Datei**, und die Analyse meldet dies. Mitunter legt der Hersteller dort eigene Strukturen ab, etwa ein Boot-Guard-Key-Manifest; in anderen Fällen handelt es sich um eine Beschädigung.

@term section
@name Sektion
@short Ein Teil einer FFS-Datei: ihr Code, ihr Name, ihre Version oder ein ganzes weiteres Volume.

Eine Datei besteht aus Sektionen, und Sektionen können ineinander liegen. Die üblichen sind das ausführbare Abbild (PE32), eine komprimierte Sektion (in der wieder Sektionen stecken), eine Oberflächensektion (der lesbare Name der Datei) und eine Versionssektion.

Eine **komprimierte Sektion** kann ByteRipper entpackt öffnen — das Werkzeug klappt sie auf und zeigt, was wirklich darin steckt.

@see topic:fragments

@term free-space
@name Freier Speicher
@short Der unbeschriebene Rest eines Volumes hinter seiner letzten Datei.

Das Werkzeug führt ihn mit Absicht auf: daran sieht man, ob noch ein Modul in ein Volume passt, und seine Größe ist eine schnelle Probe darauf, dass das Längenfeld des Volumes stimmt.

@see term:padding

@term padding
@name Padding
@short Raum zwischen Strukturen, in den nie jemand geschrieben hat.

Gelöschtes Padding ist die Füllmasse eines Dumps — meist `FF`. Der Baum blendet es aus, bis Sie danach fragen: ein großer Dump ist voll davon, und eine Zeile, hinter der nichts steht, ist eine Zeile zum Vorbeiscrollen.

Padding, das **Daten enthält**, wird immer aufgeführt: da liegt etwas, ob der Parser es versteht oder nicht.

Erweisen sich diese Daten als Bild — etwa als JPEG-Boot-Logo —, erhält es eine eigene Zeile; siehe [[term:picture|Bild]]. Für UEFITool bleibt eine solche Zeile Padding.

@see term:free-space

@term picture
@name Bild
@short Ein Logo, ein Symbol oder ein Startbildschirm, den die Firmware als gewöhnliche Bilddatei ablegt: JPEG, PNG, GIF oder BMP.

Die meisten Bilder einer Firmware bilden den Datenteil einer Raw-[[term:section|Section]]: das Boot-Logo, der Startbildschirm des Herstellers, die Symbole des Setup-Bildschirms, häufig innerhalb eines komprimierten Volumes. Manche Hersteller legen das Boot-Logo außerhalb aller Volumes im [[term:padding|Padding]] ab. Das [[topic:tool-uefi|UEFI-Werkzeug]] erkennt alle vier Formate an beiden Stellen und zeigt jedes Bild als eigene Zeile, benannt nach Format und Größe in Pixeln, etwa `BMP 300×300` oder `JPEG 800×480`.

Ein Bild wird an seinen Anfangsbytes erkannt und nur dann übernommen, wenn sich seine Struktur bis zum Ende lesen lässt: bei JPEG die Segmente bis zur Endmarke, bei PNG die Chunks bis `IEND`, bei GIF die Blöcke bis zum Abschlussbyte, bei BMP der Kopf samt der darin angegebenen Größe. Daraus ergibt sich zugleich die Länge, denn keines der vier Formate gibt sie an einer einzigen Stelle an.

Die Details nennen das Format — mit `JFIF` oder `Exif`, der GIF-Version oder der Farbtiefe eines BMP — sowie die Größe in Pixeln und zeigen darunter das Bild selbst. **… sichern unter…** schlägt eine Datei mit der Endung des Formats vor, die jeder Bildbetrachter öffnet.

! Gibt der Kopf eines BMP mehr Bytes an, als seine Section enthält, wird das Bild bis zum Ende der Section gezeigt, und die Details melden die angegebene Größe als Fehler: Die Zeilen jenseits des Endes fehlen im Abbild. Ein solches Logo fand sich in einem Dell-Dump.

Für UEFITool ist eine Bildzeile Padding, und die Spalte „Typ“ weist sie so aus.

@see term:section
@see term:padding

@term flash-device-map
@name Insyde Flash Device Map
@short Die Tabelle einer Insyde-Firmware, die angibt, wo jeder Bestandteil des BIOS-Abbilds liegt.

Insyde-H2O-Firmware enthält eine Tabelle mit der Signatur `HFDM`, häufig in zwei Exemplaren. Sie verzeichnet die Bestandteile des Abbilds: die Firmware-Volumes, den Variablenspeicher, die EC-Firmware, die BIOS-Versionstabelle, die Passwörter und weitere. Jeder Eintrag nennt Regionstyp, Adresse und Größe; für manche Regionen prüft die Firmware beim Start zudem einen Hash.

Ein Teil dieser Regionen liegt außerhalb aller Firmware-Volumes und besitzt keine eigene Signatur, sodass allein die Map ihre Bedeutung angibt. UEFITool stellt sie als Padding dar. ByteRipper wertet die Map aus und bezeichnet jede dieser Regionen nach ihrem Typ — **EC Firmware**, **BIOS Version Data Table**, **Lenovo User Password**; in der Spalte „Typ“ steht weiterhin Padding. Die Regionen sind Zeilen innerhalb des Paddings, das sie enthält: Das Padding behält im Baum seinen Platz und seine Grenzen, und Bytes, denen die Map nichts zuordnet, stehen als Padding-Zeilen zwischen den Regionen. Eine Region vom Typ **Variable Defaults** wird weiter zerlegt: Sie enthält die Variablenspeicher mit den Standardwerten der Einstellungen.

Eine leere Region ist gelöscht und enthält nichts. Ob dies beispielsweise bedeutet, dass kein Passwort gesetzt ist, hängt vom Hersteller ab und ist nicht dokumentiert.

Die Typbezeichnungen stammen aus UEFITool. Ein dort unbekannter Typ erscheint als seine GUID.

Die Map gibt Adressen im Adressraum des Prozessors an. ByteRipper rechnet sie anhand des Endes der BIOS-Region in Adressen des Dumps um. Auf AMD-Boards endet der Dump nicht mit einer Volume Top File; dann entnimmt ByteRipper die Umrechnung dem eigenen Eintrag der Map, dem Eintrag vom Typ Flash Device Map, da die Lage der Map im Dump bekannt ist. Ist beides nicht möglich, bleiben die Regionen Padding.

@see term:bvdt
@see term:ec-firmware
@see term:vss
@see term:padding

@term bvdt
@name BIOS Version Data Table
@short Der Eintrag von Insyde über die BIOS-Version, das Produkt, für das die Firmware erstellt wurde, und den zugrunde liegenden Insyde-Kernel.

Insyde-Firmware enthält eine kleine Tabelle, die mit der Signatur `$BVDT$` beginnt. Die [[term:flash-device-map|Flash Device Map]] bezeichnet ihre Region als **BIOS Version Data Table**, und die Detailliste gibt wieder, was die Tabelle angibt:

- **BIOS version** — die Version in der Zählung des Herstellers, etwa `J2CN57WW` auf einem Lenovo-Board.
- **Product name** — das Modell oder das Board, etwa `Legion 570 Series Intel`.
- **Kernel version** — die Version des InsydeH2O-Kernels, auf dem die Firmware aufbaut, etwa `05.43.44`.
- **Release date** — das Datum aus dem Eintrag `$RDATE` der Tabelle.
- **Compiler** — die Version des Microsoft-Compilers, mit dem die Firmware erstellt wurde, aus dem Eintrag `$_MSC_VER=`, und die zugehörige Version von Visual Studio.
- **ESRT firmware class** — die GUID, unter der das Betriebssystem die System-Firmware des Boards in der EFI System Resource Table führt. Windows zeigt sie als Hardware-ID `UEFI\RES_{…}` des Geräts „System Firmware“ an und ordnet ihr BIOS-Updatepakete zu; zwei Dumps mit unterschiedlicher GUID enthalten daher Firmware für unterschiedliche Boards.
- **ESRT version** — die neben dieser GUID gespeicherte Firmware-Version. Auf den meisten untersuchten Dumps entspricht ihr niedrigstes Byte der Build-Nummer in der BIOS-Version.

Der Eintrag `$BME$` listet Bereiche der BIOS-Region auf; die Tabelle **Bereiche in $BME$** gibt ihre Adressen im Dump an und nennt, was genau in diesen Grenzen liegt. Auf den untersuchten Dumps sind das die eigene Region der Tabelle, das Microcode-Volume und auf zwei Boards die Region der EC-Firmware. Ein Klick auf eine Zeile, deren Bereich im Dump liegt, umrandet diesen Bereich im Dump. Was die Firmware oder ihr Flash-Werkzeug mit diesen Bereichen macht, ist nicht dokumentiert.

Anhand der Tabelle lässt sich am schnellsten feststellen, welche Firmware ein Dump enthält und ob zwei Dumps dieselbe Version enthalten.

! Eine Spezifikation der Tabelle ist nicht veröffentlicht. Ihr Aufbau ist aus Dumps abgeleitet, und die Bedeutung des Datums ist eine Schlussfolgerung: Auf allen untersuchten Dumps stimmt es mit der BIOS-Version überein. Die Bedeutung der ESRT-Version und der Bereiche in `$BME$` ist ebenfalls aus Dumps abgeleitet; der Eintrag `$QUIRK` wird nicht ausgewertet.

@see term:flash-device-map

@term ec-firmware
@name EC-Firmware in einem BIOS-Abbild
@short Der Code des Embedded Controllers, der oft in der BIOS-Region liegt, ohne dass ihn dort etwas benennt.

Seit Skylake kann ein Board eine richtige [[term:ec-region|EC-Region]] haben, die der Deskriptor deklariert. Davor — und auf etlichen Boards auch danach — ist die EC-Firmware schlicht ein Block in der BIOS-Region, den der Parser als [[term:padding|Füllung]] zeigt, meist als die erste. In Insyde-Firmware benennt die [[term:flash-device-map|Flash Device Map]] diesen Block, und der Baum zeigt ihn als **EC Firmware**.

Woran man sie üblicherweise erkennt:

- **Die Größe.** Verbreitet sind 128 KB (131 072 Bytes) und 192 KB (196 608 Bytes).
- **ITE-Controller** enthalten bei Offset `0x40` oder `0x80` vom Anfang des Abbilds einen Signaturblock aus sechs `A5`-Bytes, auf den eine Kennung folgt.
- **ENE-Controller** tragen die Zeichenfolge `ENE` in den ersten Bytes.
- **Microchip-Abbilder (MEC)** beginnen mit dem Header `PHCM`. Der Header ist das Format von Microchip, bestimmt aber nicht den Chip: Auf einem Lenovo-Board mit AMD-Prozessor stammen beide Controller von ITE, und dennoch beginnt eines der Abbilder dort mit `PHCM`. Auf einem Board mit EC-Region liegen sie in dieser Region; nach derselben Quelle der Community befinden sie sich auf älteren Boards häufiger im ersten Volume der BIOS-Region.

Beginnt ein EC-Abbild am Anfang eines Padding-Blocks, der Region **EC Firmware** aus der Map oder der EC-Region des Deskriptors, benennt ByteRipper die Zeile nach diesem Abbild und gibt dessen Größe an: ein ITE-Abbild nach der Kennung hinter seinem Signaturblock, etwa **EC Firmware (ITE8380-EC-V1.43, 256 KB)** oder **EC firmware (ITE8226-EC-V0.00, 172 KB)**, ein Abbild mit dem Header `PHCM`, der weder Chip noch Version nennt, als **PHCM image**; die Details nennen das Format des Headers, den Hersteller nennen sie nicht. Enthält eine Region der [[term:flash-device-map|Flash Device Map]] ein einziges Abbild, ist die Größe die des Map-Eintrags, den gelöschten Rest eingeschlossen: Der Eintrag ist die eigene Angabe der Firmware über ihren Platz. Andernorts, auch in einer Region mit mehreren Abbildern, deren Eintrag die Größe der ganzen Region und nicht eines einzelnen Abbilds nennt, reicht ein Abbild bis zu seinem letzten beschriebenen Byte. Ein Block kann mehrere Abbilder enthalten, jedes an einer 4-KiB-Grenze — die Firmware eines zweiten Controllers oder eine zweite Kopie. Jedes Abbild erhält dann eine eigene Zeile mit seinem Namen und seiner Größe, etwa **ITE8380-EC-V0.00, 192 KB**; der Block selbst nennt keines davon — **EC Firmware**, **EC region** oder **EC firmware** —, und der Raum zwischen den Abbildern bleibt Padding. Ein Abbild, das ein früheres Byte für Byte wiederholt, trägt den Zusatz **(Kopie)**; ob der Controller es als Sicherung verwendet, ist nicht dokumentiert.

Ein ITE-Abbild muss nicht am Anfang eines Padding-Blocks stehen. Auf AMD-Boards beginnt der erste Padding-Block mit den Daten des [[term:psp|PSP]], und die EC-Firmware liegt weiter hinten. Der Block bleibt in den Grenzen, die die umgebenden Strukturen vorgeben, und behält seinen Namen; das Abbild wird zu einer Zeile innerhalb des Blocks, zwischen Padding-Zeilen für die Bytes davor und danach, etwa **EC firmware (ITE8380-EC-V0.00, 108 KB)**. Seine Größe reicht bis zum letzten beschriebenen Byte; nennt die [[term:flash-device-map|Flash Device Map]] die Region, umfasst die Zeile die Region in den Grenzen der Map. Der Header `PHCM` ist zu kurz, um ihn abseits eines Blockanfangs zu erkennen; ein Abbild mit diesem Header wird daher nur am Anfang eines Blocks oder einer Region gefunden.

Kein bekannter Header gibt die Länge eines Abbilds an. ByteRipper nimmt an, dass ein Abbild bis zu seinem letzten beschriebenen Byte vor dem nächsten reicht und eine Kopie so lang ist wie das Abbild, das sie wiederholt; die Größe im Namen ist diese Länge, auf 4 KB aufgerundet. Die Detailliste einer Abbild-Zeile nennt Hersteller, Kennung, beschriebene Länge und bei einer Kopie die Adresse des Originals.

! Die Kennung ist ein Text, den der Entwickler der Firmware in das Abbild geschrieben hat. Sie nennt den Controller, für den die Firmware erstellt wurde, und muss nicht mit dem Modell des tatsächlich auf dem Board bestückten Controllers übereinstimmen: Eine Firmware kann für mehrere kompatible Controller bestimmt sein, und die Version in der Kennung wird nicht immer gepflegt — mehrere Dumps tragen `V0.00`. Welcher Controller bestückt ist, zeigt die Beschriftung auf seinem Gehäuse.

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

NVRAM liegt in einem eigenen Bereich der BIOS-Region, in einem Format, das vom Firmware-Hersteller abhängt. ByteRipper liest die gängigen — [[term:vss|VSS/VSS2]], [[term:nvar|NVAR]] von AMI, [[term:dvar|DVAR]] von Dell, FTW, EVSA, FDC und einige herstellereigene — und führt die Variablen darin auf.

Zwei Eigenschaften des NVRAM sind festzuhalten: Fehlenden Inhalt legt die Firmware größtenteils neu an, und geschrieben wird er bei jeder Änderung von Einstellungen und nicht nur bei einem Firmware-Update.

Für jeden Speicher gibt die Detailliste an, wie weit er gefüllt ist. **Belegt** und **Freier Platz** nennen die beschriebenen und die noch gelöschten Bytes. Die Einträge werden in drei Gruppen gezählt: **Gültige Einträge** enthalten den aktuellen Wert einer Variablen; **Ersetzte Einträge** wurden durch einen späteren Eintrag derselben Variablen — mit demselben Namen und derselben GUID — abgelöst; **Gelöschte Einträge** gehören zu Variablen, die der Speicher nicht mehr enthält.

Die Firmware überschreibt eine Variable nicht an Ort und Stelle: Sie hängt einen neuen Eintrag an und kennzeichnet den bisherigen. Ist der freie Platz erschöpft, bereinigt sie den Speicher — sie kopiert die gültigen Einträge und löscht den Rest. Ein nahezu voller Speicher, der überwiegend aus ersetzten Einträgen besteht, steht daher kurz vor einer solchen Bereinigung. Wird sie unterbrochen, etwa durch einen Stromausfall auf einem Board, dessen Firmware diesen Fall nicht absichert, kann der Speicher beschädigt zurückbleiben.

Bis zu dieser Bereinigung enthält der Speicher also auch die früheren Werte einer Variablen. Die Detailliste eines VSS-, NVAR- oder DVAR-Eintrags zeigt sie unter **Verlauf der Variable**: jede Kopie derselben Variablen — mit demselben Namen und derselben GUID — in diesem Speicher, die älteste zuerst. Zu jeder Kopie stehen ihre Adresse, ihr Zustand — aktuell, ersetzt oder die Kopie, als die die Variable gelöscht wurde —, die Größe ihres Werts und das, was sie gegenüber der vorigen Kopie geändert hat: die neue Größe und die Offsets der abweichenden Bytes innerhalb des Werts. Der ausgewählte Eintrag ist mit ▸ markiert, und ein Klick auf eine Kopie zeigt sie an. Der Baum zeigt eine Zeile je Variable, sofern ersetzte Einträge nicht eingeblendet sind ([[topic:tool-uefi|UEFI-Struktur]]). Ein ersetzter Eintrag, den der Baum wie UEFITool Invalid nennt, nennt seine Variable in der Zeile **Variable**. Eine Variable, die bei jedem Start geschrieben wird, liegt in Hunderten von Kopien vor; die Tabelle zeigt die letzten 40. Was ein geändertes Byte bedeutet, steht hier nicht: Der Speicher enthält Werte, nicht ihre Bedeutung.

Speicher mit Standardwerten, etwa die **Variable Defaults** von Insyde, werden einmalig beschrieben und sind in der Regel vollständig belegt; ein Defekt ist das nicht.

@see term:vss
@see topic:recipe-board-data

@term nvar
@name NVAR
@short Das NVRAM-Format der AMI-Aptio-Firmware. Eine Variable ist als Kette von Einträgen abgelegt; ihren aktuellen Wert enthält nur der letzte Eintrag der Kette.

Ein NVAR-Speicher besitzt keinen eigenen Header. Er belegt den Datenteil einer FFS-Datei oder einer Section vom Typ Raw und besteht aus lückenlos aufeinanderfolgenden Einträgen, die jeweils mit der Signatur `NVAR` beginnen. Auf die Einträge folgt freier Speicher; die letzten Bytes des Speichers bilden eine GUID-Tabelle, auf die sich die Einträge über einen Index beziehen.

Beim Ändern einer Variablen überschreibt die Firmware den vorhandenen Eintrag nicht. Sie setzt entweder das **Valid**-Bit des bisherigen Eintrags zurück und legt einen neuen an, oder sie verlängert eine Kette. In diesem Fall verbleiben Name und GUID im ersten Eintrag, dessen Feld **Next entry** auf einen späteren Eintrag verweist, der ausschließlich den neuen Wert enthält. Einer Variablen können daher mehrere Zeilen im Baum entsprechen, jede von einer der folgenden Arten:

- **Full** — die vollständige Variable in einem einzigen Eintrag.
- **Link** — ein Eintrag, dem in seiner Kette ein weiterer folgt. Sein Wert ist nicht mehr gültig.
- **Data** — der abschließende Eintrag einer Kette; er enthält den aktuellen Wert. ByteRipper versieht ihn mit dem Namen der Kette.
- **Invalid** — ein ersetzter Eintrag. Er verbleibt im Speicher, bis die Firmware den belegten Platz freigibt.
- **Invalid link** — ein Dateneintrag, dessen Kette sich auf keinen gültigen Eintrag zurückführen lässt.

Soll eine Variable in zwei Dumps verglichen werden, ist ihr Eintrag der Art **Data** oder **Full** maßgeblich, nicht der erste Eintrag, der den Namen trägt.

Im selben Format legt AMI die Standardwerte ab: in der Datei `StdDefaults` sowie in den Dateien für PEI- und BB-Defaults. Sie enthalten die Werte, die die Firmware beim Zurücksetzen der Einstellungen wiederherstellt, nicht die aktuell wirksamen Einstellungen.

Ein Eintrag mit erweitertem Header kann eine Prüfsumme enthalten. ByteRipper prüft sie und kennzeichnet den Eintrag, wenn sie nicht übereinstimmt.

Wie der Füllstand eines Speichers und die Zahl seiner ersetzten Einträge ermittelt werden, erläutert der Eintrag [[term:nvram|NVRAM]].

@see term:nvram
@see term:vss

@term dvar
@name DVAR-Speicher
@short Das NVRAM-Format von Dell: Variablen, die durch eine Nummer innerhalb eines Namensraums bezeichnet werden.

Dell-Firmware legt ihre eigenen Einstellungen in einem Speicher ab, der mit der Signatur `DVAR` beginnt — neben einem [[term:vss|VSS]]-Speicher oder an seiner Stelle. Jedes Feld nach der Signatur ist als Komplement gespeichert; ein Wert wird also durch Löschen von Bits geschrieben, so wie ein Flash-Chip programmiert wird.

Eine DVAR-Variable hat keinen eigenen Namen. Sie ist eine Nummer, die **Name ID**, innerhalb eines Namensraums, der durch eine GUID bezeichnet ist. Ein Eintrag, der einen Namensraum deklariert, enthält dessen GUID und die Nummer, unter der der Speicher ihn führt, die **Namespace ID**; alle übrigen Einträge verweisen über diese Nummer auf ihren Namensraum. Benennt keine Setup-Seite die Variable, benennt ByteRipper ihre Zeile nach der Name ID, etwa `0x40`; der Namensraum steht in der Detailliste. Nach einem Gleichheitszeichen nennt die Zeile den Wert der Variablen, gelesen als Little-Endian-Zahl: `SecureBoot = Nicht angehakt (0x0)`, wenn das Setup angibt, was der Wert bedeutet, sonst `0x40 = 0x1`. Bei einem Wert, der länger als acht Byte ist, steht stattdessen seine Größe: `0x2 (16 Byte)`.

Jeder Eintrag hat einen Zustand: Storing, Stored, Deleting oder Deleted. Nur ein Eintrag im Zustand Stored enthält den aktuellen Wert einer Variablen; die übrigen sind frühere Werte oder gelöschte Variablen, und der Baum nennt sie wie UEFITool Invalid. Ein Eintrag, der einen Namensraum deklariert, wird unabhängig von seinem Zustand als gültig angezeigt, weil die Deklaration weiter gilt; der Wert, den er trägt, wird wie jeder andere ersetzt. Auf einem der untersuchten Dumps folgen zwei Speicher aufeinander.

Wofür eine Name ID steht, veröffentlicht Dell nicht; die Setup-Seiten der Firmware selbst geben es jedoch an. Der Setup-Treiber verknüpft jede Frage, deren Wert in DVAR gespeichert wird, mit dem Namensraum und der Name ID, und ByteRipper liest diese Seiten aus dem Dump. Die Zeile trägt dann das Schlüsselwort der Frage, etwa `AllowBiosDowngrade` — unter diesem Namen führen die Konfigurationswerkzeuge von Dell die Option. Die Detailliste nennt die Option so, wie die Seite sie formuliert (**Setup-Option**), die Seite selbst (**Setup-Seite**), die Bedeutung des gespeicherten Werts (**Wert im Setup**: angehakt oder nicht oder der gewählte Listeneintrag) und den Hilfetext der Seite (**Setup-Hilfe**). Da die Seiten in einem komprimierten Volume liegen, erscheinen die Namen einige Sekunden nach dem Öffnen des Dumps. Variablen, nach denen keine Seite fragt — Zähler, Zeitstempel, Protokolle —, behalten Namensraum und Nummer. Lassen sich die komprimierten Volumes eines Dumps nicht entpacken, gibt es ebenfalls keine Namen. Die Texte sind das Englisch der Firmware in der kompilierten Form; eine Zeile, die die Firmware erst zur Laufzeit füllt, erscheint als der im Treiber hinterlegte Platzhalter.

Wie voll ein Speicher ist und welche früheren Werte eine Variable hatte, ist unter [[term:nvram|NVRAM]] erklärt.

@see term:nvram
@see term:vss

@term vss
@name VSS / VSS2
@short Das häufigste NVRAM-Format: ein Speicher benannter Variablen.

Jeder Eintrag ist eine Variable mit Namen (`BootOrder`, `PK`, `Setup`), Hersteller-GUID und Wert. ByteRipper benennt die Zeile nach dem Variablennamen statt nach der GUID: viele Variablen teilen sich eine Hersteller-GUID.

Im selben Bereich finden sich verwandte Speicher: **FTW** (der Eintrag eines fehlertoleranten Schreibvorgangs — das Journal, das ein Variablen-Update einen Stromausfall überstehen lässt), **EVSA**, **FDC**, **CMDB** und herstellereigene Flash-Maps. Das sind die Antworten verschiedener Hersteller auf dieselbe Aufgabe.

Insyde-Firmware legt auch ihre Standardwerte in VSS-Speichern ab, allerdings außerhalb aller Firmware-Volumes: als Folge von Speichern in dem Bereich, den die Flash Device Map als **Variable Defaults** ausweist. ByteRipper ermittelt ihre Lage anhand dieser Tabelle. Sie enthalten die Werte, die die Firmware beim Zurücksetzen der Einstellungen wiederherstellt, nicht die aktuell wirksamen Einstellungen.

Wie der Füllstand eines Speichers und die Zahl seiner ersetzten Einträge ermittelt werden, erläutert der Eintrag [[term:nvram|NVRAM]].

@see term:nvram

@term dmi
@name DMI (Desktop Management Interface)
@short Die standardisierten Angaben, die eine Maschine über sich selbst meldet — Seriennummer, UUID, Modell — und der Teil des Abbilds, in dem sie stehen.

DMI ist ein DMTF-Standard, und in der Praxis meinen „DMI" und „SMBIOS" dasselbe: die Tabellen, die die Firmware veröffentlicht, damit ein Betriebssystem sagen kann, auf welcher Maschine es läuft. `dmidecode` unter Linux liest genau diese.

Dort liegt die Identität der Platine selbst: die Seriennummern von System und Baseboard, die Maschinen-UUID, die Inventarnummer, der Modellname. All das wird im Werk geschrieben und nicht berechnet. Eine Platine mit leeren Feldern verliert Garantieabfrage, Lizenzaktivierung und Verwaltungswerkzeuge.

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

Die Strukturen, auf die eine FIT zeigt, liegen in der Regel innerhalb eines Volumes; manche Hersteller legen sie jedoch außerhalb aller Volumes ab — im Padding oder im Datenteil einer [[term:pad-file|Padding-Datei]]. Das [[topic:tool-uefi|UEFI-Werkzeug]] zeigt solche Strukturen als Zeilen innerhalb des Paddings, das sie enthält: FIT, Startup ACM, Boot Guard Key Manifest und Boot Guard Boot Policy. Das Padding behält im Baum seinen Platz und seine Grenzen, und die Bytes zwischen den Strukturen stehen daneben als Padding-Zeilen. Eine Zeile beginnt an der Adresse, die die FIT angibt, und ihre Länge entnimmt das Werkzeug dem Kopf der Struktur selbst. Die Details nennen Version und SVN aus dem Kopf, beim ACM zusätzlich dessen Datum. Für UEFITool bleibt eine solche Zeile Padding, und die Spalte „Typ“ weist sie auch so aus. In einer [[term:top-swap|Top-Swap]]-Kopie finden sich dieselben Strukturen an denselben Stellen.

Voraussetzung ist, dass das Abbild mit seinem Volume Top File endet. Ein Dump, an den hinter dem Ende des Abbilds Bytes angehängt sind, behält das Padding unverändert.

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

Welche Bereiche abgedeckt sind, erklärt das Abbild selbst. Das [[topic:tool-uefi|UEFI-Werkzeug]] zählt diese **geschützten Bereiche** in seiner Zusammenfassungszeile.

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

! Das Key Manifest durch ein selbst signiertes zu ersetzen funktioniert nicht: Ihr Schlüssel hasht zu etwas anderem, und der gebrannte Wert lässt sich nicht daran anpassen. Nur die zurückgeschriebenen Originalbytes des Herstellers stellen diesen Zustand wieder her.

@see term:boot-policy
@see term:boot-guard

@term boot-policy
@name Boot Policy Manifest (BPM)
@short Was genau geschützt ist: die Bereiche des Bootblocks und ihre Hashes.

Die Boot Policy nennt die Bereiche, aus denen der [[term:ibb|Initial Boot Block]] besteht, und hält für jeden einen Hash fest, damit das [[term:acm|ACM]] genau diese Bytes prüfen kann. Signiert ist sie mit einem Schlüssel, für den das [[term:key-manifest|Key Manifest]] bürgt — so erbt sie das Vertrauen, das die Fuses begonnen haben.

Die geschützten Bereiche, die das [[topic:tool-uefi|UEFI-Werkzeug]] zählt, sind die, die hier deklariert werden.

@see term:key-manifest
@see term:ibb

@term ibb
@name IBB / OBB
@short „Initial Boot Block“ — der Teil der Firmware, den Boot Guard selbst prüft; der Rest ist Sache des Herstellers.

Der IBB ist ungefähr der Code von [[term:sec-phase|SEC]] und [[term:pei-phase|PEI]]: die frühe Firmware bis zu dem Punkt, an dem der Speicher arbeitet. Genau den hasht das [[term:acm|ACM]] und vergleicht ihn mit der [[term:boot-policy|Boot Policy]].

Alles danach ist der **OBB**, der „OEM Boot Block“, praktisch die [[term:dxe-phase|DXE]]-Hälfte. Vom IBB wird erwartet, dass er den OBB prüft, bevor er ihn ausführt — mit Code, den der Boardhersteller schreibt. Ob ein bestimmter Hersteller das tut, bleibt ihm überlassen.

Daher kommt es, dass ein Werkzeug manche Bereiche als geschützt kennzeichnet und andere nicht, und dass dieselbe Art von Änderung im einen Teil eines Abbilds unmöglich und im anderen Alltag ist.

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

Daraus folgt, dass ein Image berechtigterweise zwei fast gleiche Boot-Blöcke enthalten kann, und ein Vergleich zeigt beide.

ByteRipper erkennt die Kopie an ihrer FIT: Als Kopie gilt der Block unmittelbar unter dem obersten Block der BIOS-Region, wenn er einen FIT-Zeiger mit demselben Wert und eine FIT-Tabelle an derselben Stelle enthält. Die äußeren Zeilen der Kopie tragen den Zusatz **(Top-Swap-Kopie)**, und die Detailliste der äußeren Zeilen beider Blöcke gibt an, wo die jeweils andere Kopie liegt und ob die beiden Kopien übereinstimmen. Das Kontextmenü jeder Zeile beider Blöcke bietet **Zur Top-Swap-Kopie** oder **Zum Original** an; der Befehl wählt dieselbe Zeile im anderen Block aus.

Die Boot-Guard-Bereiche beziehen sich auf den obersten Block. Bei gesetztem Top Swap blendet der Chipsatz die Kopie unter denselben Adressen ein, und geprüft wird dann sie. Eine Änderung am Boot-Block ist deshalb in beiden Kopien vorzunehmen; das FIT-Panel tut dies für die Tabelle, die es bearbeitet.

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

Eine Region, die aus Volumes bestehen sollte und sich als Nicht-UEFI-Daten liest, ist dagegen eine beschädigte Region.

