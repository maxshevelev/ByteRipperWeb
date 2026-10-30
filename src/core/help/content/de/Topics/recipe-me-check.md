@source-sha 44d32c06f190ece69c1d137074a26b947e34c09eaa8c45ee8aac09122b9736e5
# Den ME-Bericht lesen

> Was die Registerkarten des ME Analyzer enthalten und wie die einzelnen Zeilen der Übersicht zu lesen sind.

**Werkzeuge ▸ ME Analyzer** analysiert die [[term:me-region|ME-Region]] des Images im zugehörigen Bereich und meldet das Ergebnis auf drei Registerkarten: „Übersicht“, „Konfiguration“ und „Vollständige Angaben“. Das Werkzeug selbst ist unter [[topic:tool-me|ME Analyzer]] beschrieben; diese Seite behandelt den Inhalt des Berichts.

Die Zeilenbezeichnungen der Übersicht stehen in jeder Sprache der Oberfläche auf Englisch. Es sind die Bezeichnungen der Ausgabe des Skripts `MEA.py` aus dem Projekt ME Analyzer, auf dem die Analyse beruht, und sie bleiben unverändert, damit ein Bericht mit der Ausgabe jenes Projekts verglichen werden kann. Siehe [[topic:provenance|Woher dieses Wissen stammt]].

## Wenn keine Firmware gemeldet wird

Die Meldung, dass nichts in der Datei sich als Intel-ME-Firmware lesen lässt, deckt drei verschiedene Fälle ab, die das Werkzeug nicht voneinander unterscheidet:

- das Image enthält keine ME-Region — eine AMD-Plattform, eine Plattform älter als die ME oder der Dump eines anderen Bausteins;
- der Descriptor deklariert eine ME-Region, deren Inhalt gelöscht ist. Die deklarierte Region zeigt das Werkzeug [[topic:tool-uefi|UEFI-Struktur]], und ob sie aus `FF` besteht, ist in der Hex-Ansicht zu sehen;
- die Region ist vorhanden, ihr Anfang aber so weit beschädigt, dass die Tabelle [[term:fpt|$FPT]] nicht gefunden wird.

## Die Zeilen der Übersicht

- **Family**, **Version**, **SKU**, **Release**, **Date** — aus dem Manifest und der Partitionstabelle gelesen. Die Version gibt die Plattformgeneration an, für die die Firmware gebaut wurde.
- **Type** — ob es sich um eine vollständige Firmware, ein Update oder eine aus einem vollständigen Image entnommene Region handelt.
- **Chipset**, **Chipset Stepping**, **NVM Compatibility** — die Plattform, deren Unterstützung die Firmware deklariert.
- **TCB Security Version Number**, **ARB Security Version Number**, **Version Control Number** — die Zähler, über die die Plattform Firmware zurückweist, die älter ist als die bereits angenommene. Siehe [[term:svn|SVN]] und [[term:vcn|VCN]].
- **Production Ready** — ob es ein Serien- oder ein Vorserienstand ist.
- **OEM Configuration** — ob das Image einen Signaturschlüssel des Herstellers oder eine Unlock-Partition enthält.
- **FWUpdate Support** — ob Intels eigenes Update-Werkzeug dieses Image an Ort und Stelle neu schreiben kann.
- **Size** — wie weit die Firmware von ihrer `$FPT`-Tabelle aus reicht. Das ist eine Eigenschaft der Firmware, nicht die Länge der Region oder der Datei.
- **Flash Image Tool** — die Version von Intels Flash Image Tool, mit dem das Image gebaut wurde, soweit das Image sie festhält.
- **File System State** — siehe den nächsten Abschnitt.
- **EOM on First Boot** — das Urteil und, in Klammern dahinter, die zwei Tatsachen, aus denen es gelesen wurde; siehe den Abschnitt „Manufacturing, Boot Guard und der öffentliche OEM-Schlüssel“. Dort stehen auch **Manufacturing Lock**, **Boot Guard**, **RPMC Hardware Binding** und **OEM Public Key Hash**.

Zeilen, die für die jeweilige Familie nicht beantwortet werden konnten, bleiben grau, statt mit einer Vermutung gefüllt zu werden.

## Die Zeile File System State

Die Zeile meldet den Zustand des Dateisystems [[term:mfs|MFS]] in der Region und erscheint nur bei den Familien, die ein solches besitzen. Es gibt drei Werte, und der Parser entscheidet nach den folgenden Merkmalen zwischen ihnen.

**Initialized.** Entweder enthält das Volume mindestens eine der Low-Level-Dateien mit den Indizes 0–5 oder 8, oder ein EFS-Volume darin enthält Dateiinhalte. Das ist der Zustand einer Region, in der die Engine gelaufen ist und eigene Dateien geschrieben hat.

**Configured.** Solche Dateien fehlen, es existiert aber eine Low-Level-Datei mit Index 7 oder 9 — OEM-Konfiguration und Home Directory — oder das Image enthält eine von Intels Flash Image Tool geschriebene Konfiguration: ein nicht leeres Modul `fitc.cfg` oder eine Partition `FITC`, `CDMD` oder `MFSB`. Das ist der Zustand einer Region, der eine Konfiguration gegeben wurde, in der die Engine aber noch nicht gelaufen ist.

**Unconfigured.** Keine der vorstehenden Bedingungen trifft zu. In diesem Zustand verlässt die Firmware den Plattformhersteller; in ihm befindet sich auch eine Region, deren Dateisystem entfernt wurde.

Ein Übergang verbindet die Zustände. Das erste Einschalten einer Platine mit einer sauberen Region im Zustand **Configured** und einem funktionsfähigen Chipsatz initialisiert sie: Die Engine legt die Dateien an und bindet die Region an diesen Chipsatz, überführt sie also in den Zustand **Initialized**.

Zu diesen Merkmalen gehören zwei Einschränkungen:

- Bei CSME 15, CSME 16 und CSME 13.30 beginnen die Dateien des Volumes am Offset 0 des Systembereichs, die Dateiindizes besagen dort also nichts, und der Parser leitet aus ihnen nichts ab. Ein solches Volume wird allein über die beiden übrigen Regeln bestimmt. Ein Volume, das seine Dateien über eigene Tabellen benennt, sie aber nicht am Offset 0 beginnen lässt — so ist ein CSME-14-Image gebaut —, wird wie jedes andere über die Indizes gelesen; die Tabellen benennen darin nur die Dateien.
- Im zugrunde liegenden Projekt gibt es einen vierten Wert, **Error**, für den Abbruch der Analyse. Die hier verwendeten Decoder setzen ihn nicht.

Auf der Registerkarte **Übersicht** ebenso wie in der Zeile **Firmware** der Registerkarte **Vollständige Angaben** trägt der Zustand das, woraus er gelesen wurde, **in Klammern hinter sich** — wie die Zeile **EOM on First Boot** das ihrige: `Configured (configuration: FITC, CDMD)` oder `Initialized (EFS: holds files)`. Die Klammern nennen das entscheidende Kriterium — `reserved files: 2, 8` (reservierte Dateien), `EFS: holds files` (das EFS enthält Dateien), `configuration: …` (Konfiguration gefunden), `nothing found` (nichts gefunden) — und danach jedes Kriterium, das nicht geprüft werden konnte. Der Zustand selbst steht in seiner Farbe, die Klammern im gewöhnlichen Ton: sie sind Beleg und keine zweite Antwort. Konnte ein Kriterium, das den Zustand hätte anheben können, nicht geprüft werden — meist eine in der Partitionstabelle eingetragene EFS-Partition, deren Volume sich nicht lesen ließ, etwa weil ihre Systemseite gelöscht ist —, steht in den Klammern `EFS: unreadable`, und der Zustand erscheint dann nie grün. **Configured** bedeutet dann nur, dass eine Konfiguration gefunden wurde. Ob das EFS von der Engine geschriebene Dateien enthält — dann wäre der Zustand **Initialized** —, ist unbekannt, und die EFS-Partition ist zu prüfen, bevor man sich auf den Zustand verlässt.

## Manufacturing, Boot Guard und der öffentliche OEM-Schlüssel

Fünf weitere Zeilen beantworten allein aus dem Dump, was vor dem Schreiben eines Images auf eine Platine gefragt wird. Keine davon stammt aus dem Ursprungsprojekt. Wie alle Zeilen der Registerkarte **Übersicht** tragen sie in jeder Sprache der Oberfläche englische Bezeichnungen, und auch ihre Werte sind englisch.

**EOM on First Boot** — ob die Plattform Manufacturing beim ersten Start einer Platine mit diesem Image abschließt. Zwei Dinge entscheiden das, und auf das zweite verlassen sich die Hersteller normalerweise:

- die **Zugriffsrechte im Flash-Descriptor**. Ein Serien-Image lässt dem Master „Host-CPU / BIOS“ die Werksrechte statt der lauter Einsen eines Service-Images, das dem Host das Überschreiben aller Bereiche erlaubt, und die Plattform schließt Manufacturing beim ersten Start ab. So wurde End of Manufacturing gehandhabt, bevor das Flash Image Tool die Einstellung unten bekam, und so werden Serien-Images ohne jede Einstellung noch heute gebaut;
- die **Einstellung `EOM on first boot`** — `CsePlugin:EomNvar`, Bit 0 der MFS-Datei `/home/mca/eom_config` — eine ausdrückliche Anweisung darüber hinaus. Hersteller setzen sie nicht; sie wird bewusst im Flash Image Tool gesetzt.

Eine nicht gesetzte Einstellung heißt also nicht, dass Manufacturing offen bleibt: sie heißt, dass der Descriptor antwortet. Die Zeile nimmt diese Werte:

- **Will close on the EOM flag** — die Einstellung ist gesetzt: Das Flash Image Tool wurde angewiesen, Manufacturing beim ersten Start nach dem Schreiben dieses Images abzuschließen, und die Zeile darunter nennt, was das sperrt.
- **Will close on the descriptor's rights** — die Einstellung ist nicht gesetzt oder fehlt, und der Descriptor trägt die Werksrechte: Die Plattform schließt Manufacturing beim ersten Start von selbst ab. Das ist das Serien-Image, und das, was ein Hersteller-Dump trägt.
- **Will not close** — die Einstellung ist nicht gesetzt und die Zugriffsrechte im Descriptor sind offen. Das ist das Image, das eine Werkstatt sich selbst bereitet, wenn die Platine starten und bearbeitbar bleiben soll.
- **Will close on the EOM flag, with the descriptor open** — die Einstellung ist gesetzt, während die Zugriffsrechte offen sind. Das Flash Image Tool weigert sich, ein solches Image zu bauen; beides wurde also von einem anderen Werkzeug oder von Hand gesetzt.
- **Not readable from this image** — die Einstellung ist nicht gesetzt oder fehlt, und es wurde kein Flash-Descriptor mit der Region gelesen: so sieht eine einzeln herausgelöste ME-Region aus. Was ihre Zugriffsrechte sagen würden, ist dann unbekannt.
- **No such switch in this firmware** — eine Generation, die das gar nicht entscheidet: vor CSME 11, deren Descriptoren die Rechte entnommen werden. Für sie entfällt die Zeile in der Übersicht ganz.

Das Urteil trägt das, woraus es gelesen wurde, **in Klammern hinter sich**: `Will not close (EOM: off, descriptor: open)` — das Flag, wie das Image es führt, und ob die Zugriffsrechte im Descriptor offen oder gesperrt sind. Die Farbe der Zeile trägt das Urteil; die Klammern stehen im gewöhnlichen Schriftbild und Ton, denn sie sind Beleg und keine zweite Antwort. Eine Tatsache, die das Image nicht hergibt, fehlt in den Klammern, statt durch einen Gedankenstrich ersetzt zu werden: ein Image ohne einen solchen Eintrag sagt das im Urteil selbst.

Was End of Manufacturing sperrt, ist die eigene Einstellung des Images, `FlexibleEomSettings` — ein Feld derselben Konfigurationsdatei wie das Flag, in den vier Werten des Flash Image Tool, und unabhängig vom Flag gespeichert: ein Image, das nichts abschließt, sagt trotzdem, was es sperren würde, wenn es abschlösse.

Die Urteile sind farbig. Eine Platine, die Manufacturing **nicht** abschließt, startet und bleibt bearbeitbar: grün. Eine, die abschließt, und der Fall, in dem die Einstellung bei offenem Descriptor gesetzt ist, tragen denselben Ton, den der Dateisystemzustand für **Initialized** trägt — das Image legt sich fest, und was danach geschrieben wird, ist endgültig. Eine Zeile, die nur meldet, dass das Image keinen Eintrag trägt, bleibt im gewöhnlichen Ton.

**Manufacturing Lock** — was die **Platine, von der der Dump stammt**, bereits getan hat. Dieses Byte ihres Dateisystems schreibt die Plattform selbst, ein Build lässt es unberührt: **Locked** — die Platine hat End of Manufacturing durchlaufen — oder **Not locked**. Ein Byte mit einem anderen Wert wird so angegeben, wie es ist. Die Zeile erscheint, wo das Dateisystem seine Dateien über eine Dateitabelle benennt; hat eine Platine den Eintrag nie geschrieben, steht dort ein Gedankenstrich. Über die Platine, auf die das Image erst geschrieben wird, sagt die Zeile nichts; für deren ersten Start antwortet **EOM on First Boot**.

**Boot Guard** — das Profil, für das das Image gebaut ist, so wie es das Flash Image Tool, MEInfo und die Reparaturwerkzeuge ausgeben: `0 - No_FVME`, `3 - VM`, `4 - FVE` oder `5 - FVME`; die Kürzel stehen für verifizierten und gemessenen Start. Das Profil brennt die Plattform beim Abschluss von Manufacturing in die Fuses des Chipsatzes, und Fuses lassen sich nicht zurücknehmen; deshalb lohnt es sich, es vor dem Schreiben eines Images zu lesen. Die Zeile meldet das Profil, das das Image trägt. Verwahrt wird es an einer von zwei Stellen, und beide werden gelesen: ein mit MFIT gebautes Image führt einen Eintrag darüber in der Konfiguration der CDMD-Partition, ein mit dem älteren Flash Image Tool gebautes führt die vier Einstellungen selbst als Bits in seinem UEP-Bereich — im Eintrag des Bereichs bei CSME 12, 13 und 14, dessen Offset innerhalb des Eintrags je Generation anders liegt, und im ersten Bit-Array bei CSME 15 und 16. Für eine Generation, deren Bereich anders aufgebaut ist, wird gemeldet, dass kein Profil-Eintrag vorliegt, statt zu raten. (Ein CSME-16-Image führt beides, und beides stimmt überein.) Trägt ein Image keines von beiden, steht in der Übersicht **No profile record in this image**, und das Profil ist mit MEInfo von der Platine selbst zu nehmen. Keine Zeile sagt, was eine Platine bei einem Widerspruch zwischen Image und Fuses tut, denn was in den Fuses steht, sagt der Dump nicht.

**RPMC Hardware Binding** — ab CSME 13: ob die Plattform den Flash-Baustein an den Chipsatz bindet. Das ist die Einstellung *Hardware Binding* des Flash Image Tool, wie das Dateisystem des Images sie verwahrt. **Disabled** — die Platine nimmt einen neuen Flash-Baustein an — erscheint grün, **Enabled** im Ton eines festgelegten Zustands. Verwahrt ein Image keinen solchen Eintrag, steht dort **Not recorded in this image**.

**OEM Public Key Hash** — der Hash des öffentlichen Schlüssels, mit dem das Schlüsselmanifest des Herstellers signiert ist, in der ME-Region: ein SHA-384 bei CSME 15 und neuer (96 Hexadezimalzeichen) und ein SHA-256 bei CSME 12–14 (64 Zeichen), jeweils aus dem Eintrag, den die Generation dafür führt. Er ist der Wert der Einstellung *OEM Public Key Hash* des Flash Image Tool und die Zeile, die die Reparaturwerkzeuge ausgeben; zwei Dumps derselben Platine tragen denselben Hash, und gegen ihn wird ein Schlüsselmanifest geprüft. Ein Schlüssel gehört einem Hersteller, ein Wert also, den zwei Hersteller zu teilen scheinen, ist per Definition falsch gelesen; die Zeile liest das Feld des Eintrags, statt die Region nach passenden Bytes zu durchsuchen.

Enthält dieses Feld keinen Schlüssel, sagt die Zeile, welcher der drei Befunde es ist — drei verschiedene Zustände einer Startkette:

- **Not set (all zeros)** — die Einstellung ist da und ist die Null-Einstellung: das „OEM signing is disabled when this hash is set to all 0s" des Flash Image Tool. Die Signatur des Schlüsselmanifests ist abgeschaltet.
- **Not set (the area is erased)** — das Feld ist `FF`: dorthin wurde nie geschrieben. So sieht eine Region aus, die nie eingerichtet wurde.
- **Layout not recognized** — das Feld enthält etwas anderes, oder der Bereich hat dort keinen Eintrag: Der Aufbau des Images ist keiner, den dieses Werkzeug liest, und über seinen Schlüssel wird nichts behauptet. So antwortet eine ältere Generation mit anders aufgebautem Bereich, und ebenso eine Region ohne einen solchen Bereich.

## Eine Region auf eine andere Platine übertragen

Eine Region im Zustand **Initialized** enthält mehr als die Einstellungen, die die Engine auf einer bestimmten Platine geschrieben hat. Die Dateien ihres Dateisystems [[term:mfs|MFS]] sind durch eine [[term:integrity-table|Integritätstabelle]] geschützt, und ein Teil von ihnen ist zusätzlich verschlüsselt, wobei Integrität und Vertraulichkeit mit getrennten Schlüsseln geschützt werden. Diese Schlüssel leiten sich aus der [[term:svn|SVN]] und aus einem Root-Geheimnis in den Fuses des Chipsatzes ab, das für den einzelnen Baustein eindeutig ist; im Image steht dieses Geheimnis nicht. Die Bindung entsteht bei der Initialisierung — beim ersten Einschalten einer Platine mit einer Region im Zustand **Configured**.

Eine initialisierte Region auf eine andere Platine zu übertragen, ist deshalb an sich nicht korrekt. Es gelten zwei Einschränkungen, die voneinander unabhängig sind:

- **Die Daten sind an einen Baustein gebunden.** Eine vollständig und unverändert übertragene Region bleibt die Region eines fremden Chipsatzes: Ein anderer Chipsatz leitet andere Schlüssel ab und nimmt die geschützten Dateien nicht an. Ein gleiches Platinenmodell und ein gleiches Chipsatzmodell ändern daran nichts — das Geheimnis ist für den einzelnen Baustein eindeutig, nicht für das Modell.
- **Eine Bearbeitung wird gesondert erkannt.** Die Engine prüft die Integrität vor dem Start, weshalb eine an Ort und Stelle geänderte Region zurückgewiesen wird, gleich wem sie gehört.

Der in der Zeile gemeldete Zustand ist die Tatsache, die das Werkzeug feststellt. Was eine Platine mit einer fremden Region tut, ist es nicht: Ein einheitliches Ergebnis gibt es nicht, und es hängt von der Chipsatzgeneration, von der jeweiligen Platine und von ihrer Systemkonfiguration ab. Die Reparaturgemeinschaft berichtet von einem langsamen Einschalten, von einzelnen Funktionen, die danach nicht arbeiten, von einem Neustart nach fester Zeit und auf aktuellen Chipsätzen von gar keinem Einschalten mehr.

Eine Region im Zustand **Unconfigured** aus dem Update-Paket des Herstellers enthält überhaupt keine gerätespezifischen Werte, auch nicht die der Platine, auf der die Firmware gebaut wurde.

Intels **Flash Image Tool** aus dem CSME-Paket für Hersteller ist das Werkzeug, mit dem aus einem Firmware-Image und einer Konfigurationsdatei eine konfigurierte Region erzeugt wird. Es wird hier genannt, weil die Zeile **Flash Image Tool** seine Version meldet und das von ihm geschriebene Modul `fitc.cfg` eines der oben genannten Merkmale ist. Mit der [[term:fit|Firmware Interface Table]], die das Werkzeug [[topic:tool-fit|FIT-Tabelle]] liest, hat es trotz der gleichlautenden Abkürzung nichts zu tun.

! ByteRipper baut keine ME-Regionen, konfiguriert sie nicht und schreibt nichts auf eine Platine. Das Programm meldet, was die Region in der geöffneten Datei enthält.

## Die Registerkarte „Vollständige Angaben“

Die Registerkarte enthält die decodierten Strukturen als Baum, in dem jeder Zeile tatsächliche Bytes der Datei entsprechen:

- **[[term:fpt|$FPT]]** — die Partitionstabelle mit Adressen und Längen der Partitionen, die die Region deklariert. Eine Partition, deren Bytes fehlen, oder eine, deren deklarierte Länge nicht zur Region passt, wird eigens ausgewiesen.
- **[[term:cpd|Code-Partitionen]]** und die Module darin.
- **[[term:manifest|Manifeste]]** und ihre Erweiterungen.
- **[[term:mfs|MFS]]** — das Dateisystem und seine Konfiguration, an der der oben beschriebene Zustand bestimmt wird.
- **[[term:oem-config|OEM-Konfiguration]]** und **[[term:utok|Unlock-Token]]**, soweit vorhanden.

Die Auswahl einer Zeile scrollt den Dump zu den betreffenden Bytes und umrandet sie. Die Detailliste unter dem Baum enthält die Felder des Headers der gewählten Struktur. Eine gelöschte Partition und eine Partition der Länge null werden grau dargestellt: ein deklarierter Platz in der Aufteilung, der nichts enthält.

## Den Bericht kopieren

Die beiden Tasten in der Registerkartenzeile kopieren die Registerkarte „Übersicht“ als Text oder als Bild des Bereichs.

Die Begriffe, die das Werkzeug verwendet, erklärt das Glossar: Zeile auswählen und **?** neben der Detailliste drücken, um den Artikel zu dieser Zeile zu öffnen.
