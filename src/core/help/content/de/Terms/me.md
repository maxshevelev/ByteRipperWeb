@source-sha c9691ee7c3610a27c029dd6579e3f1a4fc31dc8e672dc74a3b82253fa0eb6248
@term me
@name Intel ME / CSME
@short Ein kleiner Prozessor im Chipsatz, mit eigener Firmware in einer eigenen Flash-Region.

Die Management Engine — auf neueren Plattformen die Converged Security and Management Engine — läuft unabhängig von der Haupt-CPU, startet vor ihr und kümmert sich um Energieverwaltung, Provisioning, Firmware-TPM und Verwaltungsfunktionen des Herstellers.

Ihre Firmware liegt in der [[term:me-region|ME-Region]] desselben SPI-Chips wie das BIOS, in einem völlig anderen Format. Alles Weitere in diesem Glossar ist ein Teil dieses Formats.

! Die Engine prüft ihre eigene Firmware, bevor sie sie ausführt. Die Region von Hand zu ändern ergibt keine geänderte Engine, sondern eine Platine, die hängt oder im Takt neu startet.

@see topic:tool-me
@see topic:recipe-me-check

@term fpt
@name Flash Partition Table (`$FPT`)
@short Das Inhaltsverzeichnis der ME-Region: welche Partitionen sie enthält und wo jede beginnt.

`$FPT` ist die erste Struktur, nach der die Analyse sucht. Jede Zeile nennt eine Partition — mit einem Vier-Zeichen-Namen wie `FTPR`, `NFTP`, `MFS`, `UTOK` — und gibt ihren Offset, ihre Größe und einige Flags an.

Am Arbeitsplatz beantwortet `$FPT` die Frage „ist die Region vollständig?“. Fehlt eine in der Tabelle deklarierte Partition tatsächlich, oder passt ihre Größe nicht, ist die Region abgeschnitten oder beschädigt.

Intels Flash-Werkzeug heißt ebenfalls FPT — Flash Programming Tool. Gemeinsam sind nur die drei Buchstaben: dieses `$FPT` ist eine Tabelle im Image, jenes ein Programm, das Images schreibt.

@see term:cpd
@see topic:recipe-me-check

@term cpd
@name Code Partition Directory (`$CPD`)
@short Das Verzeichnis am Anfang einer Code-Partition: die Liste der Module darin.

Während [[term:fpt|$FPT]] die Partitionen der Region aufzählt, zählt ein `$CPD` die **Module** innerhalb einer Partition auf — die ausführbaren Teile der Engine und ihre Metadaten.

Das erste Modul einer Boot-Partition ist ihr [[term:manifest|Manifest]]. Modulrümpfe sind oft mit [[term:huffman|Huffman]] oder LZMA komprimiert.

@see term:fpt
@see term:manifest

@term manifest
@name Manifest (`$MN2` / `$MAN`)
@short Der signierte Kopf einer Partition: Version, Datum, Sicherheitsnummern und eine kryptografische Signatur über den Inhalt.

Aus dem Manifest stammt das meiste, was die Übersicht zeigt: Firmware-Version, Build-Datum, [[term:svn|SVN]], [[term:vcn|VCN]], der öffentliche RSA-Schlüssel und die Signatur selbst.

Es macht die Partition auch im Kern unveränderbar: die Signatur deckt den Inhalt ab, und ohne Intels privaten Schlüssel lässt sie sich nicht neu berechnen.

@see term:signature
@see term:svn

@term cse-extension
@name CSE-Erweiterung (`CSE_Ext_xx`)
@short Ein Block zusätzlicher Angaben am Manifest, über eine Nummer identifiziert.

Auf ein Manifest folgt eine Kette von Erweiterungsblöcken, jeder mit einem Tag: welche Module die Partition enthält und deren Hashes, für welche SKU sie gebaut ist, für welchen Chipsatz, welche Funktionen aktiviert sind.

Manche Tags sind gut verstanden und benannt; der Rest erscheint mit seiner Nummer und seinem rohen Inhalt, denn einem undokumentierten Block einen sicher klingenden Namen zu geben wäre geraten. Siehe [[topic:provenance|Woher dieses Wissen stammt]].

@term svn
@name SVN (Security Version Number)
@short Ein Zähler, der nur steigt, damit alte Firmware nicht zurückkann.

Behebt Intel ein Sicherheitsproblem, trägt die korrigierte Firmware ein höheres SVN. Die Plattform merkt sich das höchste je gesehene SVN und weist alles Niedrigere ab — das ist Anti-Rollback.

Am Arbeitsplatz erklärt das, warum ein Downgrade still scheitern kann: das Image ist in Ordnung, und die Plattform nimmt es trotzdem nicht. **TCB SVN** ist dasselbe für die Trusted Computing Base.

@see term:arb-svn
@see term:vcn

@term arb-svn
@name ARB SVN (Anti-Rollback SVN)
@short Der Anti-Rollback-Zähler, so wie das Image ihn angibt.

Der Wert, den die Firmware für die unter [[term:svn|SVN]] beschriebene Prüfung mitbringt. Wer Firmware zwischen Platinen bewegt: ein ARB SVN unter dem, was die Zielplatine bereits vermerkt hat, ist Firmware, die diese Platine nicht annimmt.

@see term:svn

@term vcn
@name VCN (Version Control Number)
@short Ein Zähler für Konfigurationskompatibilität, getrennt von der Version.

Das VCN sagt, ob sich das **Format der Konfiguration** geändert hat. Ein Update mit anderem VCN kann die alte Konfiguration nicht einfach übernehmen — die Einstellungen müssen neu entstehen.

Praktisch: zwei Images derselben Version mit verschiedenem VCN sind nicht so austauschbar, wie man erwarten würde.

@see term:svn

@term mfs
@name MFS (ME File System)
@short Das eigene Dateisystem der Engine in der Region: ihre Konfiguration und ihr Zustand.

MFS ist ein seitenweise organisierter Bereich mit Dateien — Konfiguration der Engine, provisionierte Werte, Protokolle und Zustand. ByteRipper läuft die Seiten ab, setzt die Chunks zusammen und führt die Dateien auf, die bekannten mit Namen.

Das ist der Teil einer ME-Region, der **platinenspezifisch** ist: zwei Platinen mit derselben Firmware-Version haben verschiedene MFS-Inhalte. Eine ME-Region vom Spender bringt dessen MFS mit.

@see term:efs
@see topic:recipe-board-data

@term efs
@name EFS (Extended File System)
@short Das Gegenstück zu [[term:mfs|MFS]] in der neueren Aufteilung, als eigene Partition.

Ab CSME 15 ist die Konfiguration in eigene Flash-Partitionen gewandert — EFS und `FITC` für den vom Hersteller einstellbaren Teil — statt in einem Modulrumpf zu liegen. Die Rolle ist dieselbe: die Dateien und Einstellungen der Engine.

@see term:mfs
@see term:fitc

@term fitc
@name FITC / OEM-Konfiguration
@short Die Einstellungen, die der Platinenhersteller gewählt hat, geschrieben von Intels Flash Image Tool.

FIT (Flash Image Tool) ist Intels eigenes Werkzeug zum Zusammenbauen eines Flash-Images; damit setzt der Hersteller die Optionen der Engine für eine Platine. Was es geschrieben hat, ist diese Partition, und das Panel beschriftet sie mit „OEM Configuration“.

Die Namen dieser Einstellungen — und Wendungen wie „OEM configurable“ und Pfade wie `/home/bup/si_features` — sind Intels eigene, aus den Konfigurationsdateien jenes Werkzeugs.

@see term:oem-config
@see topic:provenance

@term oem-config
@name OEM-Konfiguration
@short Die Engine-Einstellungen des Platinenherstellers, als Einträge im Image.

Per Definition platinenspezifisch: hier hat der Hersteller gesagt, was die Engine auf genau dieser Platine tun soll. Vom Spender übernommen, übernimmt man dessen Entscheidungen.

@see term:fitc
@see topic:recipe-board-data

@term me-configuration
@name Konfiguration der ME-Region
@short Der boardspezifische Teil einer ME-Region — alles darin, was nicht Intels eigener Code ist.

Eine ME-Region besteht überwiegend aus Firmware, die Intel geschrieben hat und die auf jedem Board dieser Generation identisch ist. Darin eingemischt ist ein kleiner Teil, der zu *diesem* Board gehört und vom Hersteller mit Intels Flash Image Tool geschrieben wurde:

- **`fitc.cfg`** — das eigene Konfigurationsmodul dieses Werkzeugs, im betrieblichen [[term:cpd|`$CPD`]].
- **Die Partitionen `FITC`, `CDMD`, `MFSB`** — Konfiguration als eigenständige Partitionen.
- **Einträge der [[term:oem-config|OEM Configuration]]** — die Antworten des Herstellers, abgelegt in [[term:mfs|MFS]] oder [[term:efs|EFS]].
- **[[term:utok|UTOK]] und OEM-Berechtigungseinträge**, wo ein Board sie hat.

Ein Teil davon beschreibt das *Board*: wie viele SPI-Chips, welche Funktionen der Engine freigegeben sind, was die Plattform darf. Ein Teil beschreibt die *Maschine* — das hat die Engine geschrieben, nachdem sie gelaufen war.

Diese Zweiteilung ist der Grund, warum eine ME-Region von einem Spender nicht einfach austauschbar ist. Sie trägt die Antworten des Spenders auf beide Arten von Frage.

@see term:file-system-state
@see topic:recipe-board-data

@term file-system-state
@name File System State
@short Wie weit das eigene Dateisystem der Engine eingerichtet ist: Unconfigured, Configured oder Initialized.

Das [[term:mfs|MFS]]- oder [[term:efs|EFS]]-Volume ist das Dateisystem der Engine. Woraus es besteht, sagt, wie weit dieses Abbild von der Stock-Firmware entfernt ist, die Intel ausliefert, und das [[topic:tool-me|ME-Panel]] zeigt es als eine Zeile.

- **Unconfigured** — nichts im Volume sagt, dass es überhaupt eingerichtet wurde. Ein sauberes Abbild, so wie es von Intel kommt.
- **Configured** — die Einstellungen des Herstellers sind da: Dateien der OEM Configuration oder des Home-Verzeichnisses im Volume oder eine Konfigurationspartition im Abbild. Der Boardhersteller hat seine Antworten geschrieben; die Engine muss dafür nie gelaufen sein.
- **Initialized** — im Volume liegen die Low-Level-Dateien, die die Engine sich selbst anlegt. Das Dateisystem wurde an Ort und Stelle initialisiert.

Warum das zählt, bevor Sie etwas auf ein Board schreiben: Die Zeile sagt, welche Art von Abbild Sie in der Hand haben. Eine Stock-Region von Intel ist Unconfigured und trägt überhaupt keine Boardeinstellungen; ein Dump von einer laufenden Maschine ist Initialized und trägt deren Einstellungen. Das eine dorthin zu setzen, wo das andere hingehört, ist genau der Weg zu einem Board ohne eigene oder mit fremden Einstellungen.

! Dass eine saubere Region Unconfigured ist, ist kein Fehler. So soll sie ankommen; gefüllt wird sie danach vom Werkzeug des Herstellers und dann von der Engine selbst.

@see term:me-configuration
@see topic:recipe-me-check

@term hap
@name HAP-Bit
@short Ein [[term:soft-straps|Soft-Strap]] im Flash-Deskriptor, der die Engine nach ihrem frühen Start anhalten lässt.

Intel hat es für ein US-Regierungsprogramm eingebaut, die High Assurance Platform, und es ist das Bit, das die Werkzeuge zum Abschalten der ME setzen. Ab ME 11 heißt es HAP; das Gegenstück älterer Generationen ist als AltMeDisable bekannt. In beiden Fällen liegt es im PCH-Strap-Abschnitt des Deskriptors und nicht in der ME-Region.

Die Engine startet weiterhin und prüft weiterhin ihre eigene Firmware. Das Bit hält sie nur davon ab, weiterzugehen.

ByteRipper dekodiert es nicht. Seine Position wandert mit der Chipsatzgeneration, und Intel dokumentiert sie nicht — deshalb nennt das Deskriptor-Panel die Anzahl der Strap-Wörter und überlässt das Lesen eines bestimmten Bits einem Werkzeug, das dafür gebaut ist.

! Dieses Bit zu setzen ist keine Reparatur. Ein Board mit tatsächlich beschädigter ME-Region kommt meist gar nicht hoch, und die Engine abzuschalten ändert daran nichts.

@see term:soft-straps
@see term:flash-descriptor

@term ptt
@name PTT
@short „Platform Trust Technology“ — ein TPM, das die Management Engine bereitstellt, ohne eigenen Baustein.

Mit aktiviertem PTT zeigt die Engine dem Betriebssystem ein TPM. Auf den meisten Notebooks liegen dort die Schlüssel von BitLocker — deshalb kann eine Arbeit, die den Zustand der Engine zurücksetzt, eine Platte hinterlassen, die niemand mehr öffnet.

PTT kann am Werk auch dauerhaft in den [[term:otp|Fuses]] des Chipsatzes abgeschaltet werden.

! Bevor Sie die ME-Region einer Maschine mit verschlüsselter Platte anfassen, fragen Sie nach dem Wiederherstellungsschlüssel. Danach ist es zu spät.

@see term:me
@see topic:bench-safety

@term amt
@name AMT
@short „Active Management Technology“ — Fernwartung durch die Engine, unabhängig vom Betriebssystem.

AMT ist die Funktion, um die herum die Management Engine überhaupt gebaut wurde: Eine Administration erreicht die Maschine über das Netz, während sie ausgeschaltet oder ihr Betriebssystem tot ist. Sie findet sich auf Geschäftsmodellen, und was dafür eingerichtet wird, gehört zu dem, was die Engine im [[term:mfs|MFS]] hält.

@see term:me
@see term:mfs

@term me-power-states
@name M0 / M3 / M-Off
@short Die Engine hat eigene Energiezustände — deshalb kann sie laufen, während die Maschine „aus“ ist.

- **M0** — die Engine läuft, und der Host ist an.
- **M1** und **M3** — die Engine ist voll versorgt, der Host nicht. In M3 steht ihr der Hauptspeicher nicht zur Verfügung.
- **M-Off** — die Engine ist aus; nichts ist versorgt.

Welche davon eine Plattform tatsächlich umsetzt, hängt von ihrem Aufbau ab. Für die Werkbank heißt das praktisch: Eine Maschine, die am Netz hängt, ist keine tote Maschine.

@see term:me

@term mfs-backup
@name MFS-Sicherung (`MFSB`)
@short Eine Ersatzkopie des Dateisystems, um sich von einem beschädigten zu erholen.

Ein Bereich, der mit der Kennung `MFSB` statt mit einem Seiten-Tag beginnt. Dass es ihn gibt, ist normal. Beginnt dagegen der **eigentliche** MFS-Bereich mit dieser Kennung, ist das Volume in einem ungewöhnlichen oder beschädigten Zustand.

@see term:mfs

@term integrity-table
@name Integritätstabelle
@short Hashes und Zähler, an denen die Engine eine hinter ihrem Rücken geänderte Datei erkennt.

Jede geschützte Datei im [[term:mfs|Dateisystem]] hat einen Eintrag mit dem Hash, den sie haben sollte, samt Nonce und einem [[term:anti-replay|Anti-Replay]]-Zähler. Die Engine prüft ihn, bevor sie der Datei traut.

Am Arbeitsplatz: deshalb kann man keinen Wert im ME-Dateisystem ändern und erwarten, dass er benutzt wird. Die Änderung wird bemerkt.

@see term:anti-replay

@term anti-replay
@name Anti-Replay
@short Schutz davor, alte, aber gültige Daten wieder unterzuschieben.

Eine Signatur oder ein Hash beweist, dass Bytes nicht verändert wurden — ein **alter** Satz Bytes ist aber ebenso unverändert. Anti-Replay fügt einen Zähler hinzu, den die Engine mitführt, sodass ein früherer Zustand sich nicht wiederherstellen lässt.

Deshalb führt es nicht immer zum erwarteten Ergebnis, eine ME-Region zu sichern und später zurückzuspielen.

@see term:integrity-table
@see term:svn

@term huffman
@name Huffman-Modul
@short Ein Modul, komprimiert mit Intels eigenem Huffman-Verfahren; ohne Wörterbuch nicht zu entpacken.

Der Code der Engine ist komprimiert: teils mit LZMA, teils mit einem Huffman-Verfahren, dessen Wörterbücher nicht veröffentlicht sind. ByteRipper lädt die Wörterbücher der Gemeinschaft zusammen mit der [[topic:databases|ME-Datenbank]] und entpackt die gängigen Versionen.

Ein Modul, das das Panel als Huffman anzeigt, aber nicht aufklappt, ist eines, für dessen Wörterbuch-Version kein Wörterbuch vorliegt — kein Schaden.

@term iup
@name IUP (Independently Updated Partition)
@short Eine Partition mit eigener Version und eigenem Update-Zyklus: PMC, PCHC, PHY und Verwandte.

Teile der Plattform-Firmware werden getrennt von der Engine ausgeliefert und aktualisiert — der Power Management Controller, die Chipsatz-Konfiguration, die USB-Type-C-Physik. Jeder Teil hat eigenes Manifest, eigene Version und eigenen Ziel-Chipsatz.

Am Arbeitsplatz: ein IUP von einem anderen Chipsatz-Stepping ist eine echte Inkompatibilität, auch wenn die Engine-Version passt. Das Panel nennt Chipsatz und Stepping, für die jedes IUP gebaut ist.

@see term:cpd

@term rbe-pm
@name RBE / BUP / `pm`
@short Die frühesten Boot-Module der Engine und die Metadatentabellen darin.

`RBE` und `BUP` (Bring-up) sind der erste Code, den die Engine ausführt; `pm` ist das Modul für die Energieverwaltung. In ihren Rümpfen liegen Metadatentabellen, die Hardware über Vendor- und Device-ID benennen — daran erkennt das Panel, für welches Silizium eine Firmware gebaut ist.

Tiefe Interna. Zu lesen nützlich, zu ändern nicht.

@term utok
@name UTOK / STKN — Unlock-Token
@short Ein signierter Token, der Debug-Funktionen auf einem bestimmten Exemplar freischaltet.

Ein Debug-Unlock-Token liegt, wenn vorhanden, in einer eigenen Partition (`UTOK` oder `STKN`) und endet mit einer Flag-Struktur (`UTFL`). Er ist signiert und an ein bestimmtes Exemplar gebunden, lässt sich also nicht zwischen Platinen bewegen.

In einem Seriendump ist seine Anwesenheit ungewöhnlich und einen Blick wert.

@term pch-init
@name Chipsatz-Initialisierungstabelle
@short Chipsatzabhängige Initialisierungsdaten, die die Engine früh im Start anwendet.

Eine Tabelle von Einträgen, jeder nennt einen Chipsatz und die Steppings, für die er gilt. Das ist eine der Stellen, an denen ein Image an bestimmtes Silizium gebunden ist: ein Image, dessen Initialisierungstabelle den vorliegenden Chipsatz nicht abdeckt, gehört zu einer anderen Platinen-Generation.

@term sku
@name SKU
@short Welche Variante der Firmware das ist: Consumer, Corporate, Slim — samt Chipsatz-Buchstabe.

Intel baut von jeder Engine-Firmware mehrere Varianten. „Consumer H“, „Corporate LP“ und so fort verbinden den Funktionsumfang mit dem Chipsatz, für den die Firmware gedacht ist.

Ein Auseinanderfallen von SKU im Image und Platine ist ein häufiger Grund, warum die ME-Region eines Spenders nicht läuft: die Version passt, die Variante nicht.

@see term:iup

@term gsc
@name GSC
@short Firmware des Graphics System Controller — dasselbe Containerformat, für ein Grafikgerät.

Manche Images sind gar keine Chipsatz-Engine-Firmware, sondern Firmware für ein Grafikgerät in derselben Aufteilung aus `$FPT` und Manifesten. Das Panel erkennt sie und liest die Partition „INFO“, die das Image und seine Partitionen beschreibt.

@term orom
@name Option-ROM (OROM)
@short Firmware eines Geräts, die die Plattform während des Starts ausführt.

Ein Option-ROM ist ein kleines Stück Code, das ein Gerät mitbringt, damit die Plattform es vor dem Laden eines Betriebssystems nutzen kann: ein RAID-Controller, ein Netzwerk-Boot-ROM, ein Grafik-BIOS. In Firmware-Images tauchen sie als eigene Abbilder mit eigenen Headern auf.

@term mme
@name `$MME`-Verzeichnis
@short Das Modulverzeichnis älterer ME-Firmware vor CSE.

Die Aufteilung vor `$CPD`: ältere ME-Firmware-Generationen führen ihre Module in einem `$MME`-Verzeichnis auf. Sehen Sie das, stammt das Image aus einer älteren Plattform-Generation — und damit ist auch der Rest anders aufgebaut, als die Nachbareinträge hier beschreiben.

@see term:cpd

@term cse-layout-table
@name CSE Layout Table
@short Die Karte eines vollständigen IFWI-Images: wo Boot-, Daten- und Temp-Bereiche liegen.

Auf neueren Plattformen liegt im Flash ein IFWI-Image, dessen Teile von einer Layout-Tabelle statt von einer einzelnen `$FPT` beschrieben werden. Das Panel liest sie, um zu finden, wo die Partitionstabelle selbst liegt.

@see term:fpt
@see term:bpdt

@term bpdt
@name BPDT — Boot Partition Descriptor Table
@short Die Tabelle, die die Boot-Partitionen eines IFWI-Images beschreibt.

`BPDT` und ihre zweite Ebene führen die Unterpartitionen des Boot-Bereichs auf: Namen, Offsets, Größen. Sie ist das Gegenstück zur Partitionstabelle für den Boot-Pfad in der IFWI-Aufteilung.

@see term:cse-layout-table

@term fwupdate
@name FWUpdate-Unterstützung
@short Ob sich dieses Image mit Intels eigenem Firmware-Update-Werkzeug aktualisieren lässt.

Eine Eigenschaft des Images, die die Übersicht meldet. Ein Image ohne sie muss mit einem Programmer geschrieben werden statt im laufenden System aktualisiert.

@term production-ready
@name Production / Pre-Production
@short Eine freigegebene Fassung oder eine Entwicklungsfassung.

Ein Pre-Production-Image in einer Kundenmaschine ist ungewöhnlich und einen Vermerk wert: es kann mit einem anderen Schlüssel signiert sein und sich anders verhalten als die freigegebene Firmware derselben Version.

@term redundant-copy
@name Redundante Kopie
@short Das Image trägt zwei Kopien einer Partition, damit ein missglücktes Update zurückkann.

Normal auf Plattformen, die Updates im Feld unterstützen. Wer das weiß, versteht, warum ein Vergleich zweier Dumps zwei fast gleiche große Blöcke zeigt.
