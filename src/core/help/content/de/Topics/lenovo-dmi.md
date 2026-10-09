@source-sha 46e650a56c13db4861e73d106002c2eb735837e6f4e3faadbb54ef559cb56eef
# Lenovo DMI

> Der Speicher, in dem die Firmware Lenovo InsydeH2O die Identität eines Geräts ablegt – Seriennummer, UUID, Maschinentyp und Modell, Windows-Schlüssel –, so wie der Baum der UEFI-Struktur ihn liest.

**Werkzeuge ▸ UEFI-Struktur** liest den Identitätsspeicher eines Images von Lenovo InsydeH2O als einen Knoten des Baums, **Lenovo DMI**, und dekodiert seinen Inhalt. **DMI-Bereich zeigen** in der Titelzeile des Panels führt zu diesem Knoten, gleich wie tief er im Baum liegt ([[topic:tool-uefi|UEFI-Struktur]]).

Bei diesen Geräten findet eine Suche nach der Seriennummer vom Typenschild im Dump nichts: Lenovo legt die [[term:dmi|DMI]]-Felder nicht im Klartext ab, sondern in einem eigenen Speicher, dessen Bytes sämtlich mit einem Schlüssel per XOR verknüpft sind. Der Baum macht diesen Speicher lesbar.

## Wo der Speicher liegt

Der Speicher besteht aus drei aufeinanderfolgenden Bereichen: dem 8 KiB großen Änderungsprotokoll [[term:ldbg|LDBG]] und zwei [[term:lenv|LENV]]-Blöcken zu je 4 KiB. Seine Lage im Image ist von Platine zu Platine verschieden. Der Baum sucht ihn deshalb über die Signatur `LDBG` an einer 4-KiB-Grenze und erkennt ihn nur an, wenn mindestens einer der beiden Blöcke an der erwarteten Stelle die Signatur `LENV` trägt. In den untersuchten Images führt die [[term:flash-device-map|Insyde Flash Device Map]] dieselben drei Bereiche als Regionen vom Typ Unknown; der Baum zeigt an ihrer Stelle den Knoten des Speichers. In einem Image ohne Map wird der Knoten aus dem Padding gelesen, in dem der Speicher liegt.

Enthält das Image keinen Speicher, hat der Baum keinen solchen Knoten, und in der Titelzeile fehlt **DMI-Bereich zeigen**. Das Image stammt dann von einer anderen Plattform, oder der Bereich wurde herausgeschnitten.

## Was der Baum zeigt

- **Der Knoten des Speichers** fasst ihn in seinen Details zusammen: **Verwendeter Block** nennt den Block, den die Firmware liest, und seine Generation; **Einträge des verwendeten Blocks** führt auf, was dieser Block enthält – zuerst Seriennummer, UUID, Modell und Windows-Schlüssel –, und ein Klick auf einen Eintrag dort öffnet dessen Knoten. Darunter folgen **Problem** oder **Hinweis**: ein leerer Speicher, eine nicht stimmende Prüfsumme, ein gelöschter Block oder voneinander abweichende Blöcke.
- **Darunter** liegen das Änderungsprotokoll und beide Blöcke. Der Knoten eines Blocks nennt seine Generation, und die Spalte **Subtype** sagt, ob er **Verwendet** wird. Ein Schloss in der Zeile zeigt, dass der Block kodiert gespeichert ist; ein offenes Schloss in der Zeile eines dekodiert geöffneten Blocks, dass seine Einträge dort im Klartext stehen. Beim Knoten eines Eintrags steht der Wert neben dem Namen; ein Ereignis des Protokolls nennt Datum, Vorgang und Eintrag.
- **Die Details** eines Blocks oder Eintrags beschreiben seine Felder; das `?` neben dem Namen erklärt den Begriff.

Wie überall im Baum wird der ausgewählte Knoten im Dump umrahmt, und der Text der Details lässt sich auswählen und kopieren.

## Welchen Block die Firmware liest

Der Speicher liegt doppelt vor, in **LENV-Block 1** und **LENV-Block 2**, damit ein durch Stromausfall unterbrochener Schreibvorgang eine unversehrte Kopie hinterlässt. Jeder Blockkopf trägt eine **Generation**: einen Zähler, der wächst, während die Firmware den Speicher neu schreibt. In allen untersuchten funktionierenden Dumps unterscheiden sich die beiden Generationen um eins, etwa 127 und 126, und der Block mit der höheren Nummer enthält den jüngeren Stand. Das passt zu einer Firmware, die jede neue Kopie über den älteren Block schreibt und ihr die nächste Nummer gibt; der Code, der das tut, wurde hier nicht untersucht.

Die Firmware liest den Block mit der höheren Generation; der Baum kennzeichnet ihn als **Verwendet**. Diese Regel stammt aus der Analyse von `LenovoVariableDxe` durch LenovoDMIDecryptor, und die untersuchten Dumps bestätigen sie: Der Eintrag, den das letzte Ereignis des Protokolls entfernt, fehlt im Block mit der höheren Generation und ist im anderen noch vorhanden. Bei gleicher Generation wertet der Baum wie LenovoDMIDecryptor Block 1 als aktiv.

Generation **0** kommt auf einer funktionierenden Platine nicht vor. Sie zeigt ein Block, dessen Kopf genullt wurde, etwa in einem gelöschten Speicher; einen solchen Block liest die Firmware nicht. Haben beide Blöcke Generation 0, gibt es nichts zu lesen. Ein Block, dessen Bytes sämtlich `FF` sind, wurde gelöscht und seitdem nicht beschrieben; der Baum nennt ihn gelöscht, und die Firmware liest die andere Kopie.

Ob die Firmware auf den anderen Block ausweicht, wenn die Prüfsumme des aktiven nicht stimmt, ist nicht bekannt; die Details weisen an der betreffenden Stelle darauf hin.

Die beiden Blöcke können unterschiedliche Werte enthalten. Nach einem Schreibvorgang ist das normal: Die ältere Kopie behält die vorigen Werte. Ein Wert, der in einen anderen Dump übertragen werden soll, wird daher dem aktiven Block entnommen; die Details jedes Eintrags geben unter **Andere Kopie** an, ob der andere Block denselben Wert enthält.

## Dekodierten Block öffnen

**Dekodierten Block öffnen** im Kontextmenü des Knotens eines Blocks oder eines seiner Einträge – ebenso ein Doppelklick auf einen solchen Knoten – öffnet den ganzen Block in einem [[topic:fragments|Fragment-Panel]], mit dekodierten Einträgen: Seriennummer und Maschinentyp stehen in der Hex-Ansicht als Text und lassen sich dort bearbeiten. Der Kopf bleibt so, wie er gespeichert ist; Schlüssel und Prüfsumme stehen an ihren eigenen Adressen.

**In der Quelle aktualisieren** schreibt den Block als einen Widerrufsschritt in den Dump zurück, kodiert mit dem Schlüssel aus seinem Kopf und mit neu berechneter Prüfsumme. Länge und Generation des Blocks bleiben unverändert, und dem Protokoll wird nichts hinzugefügt. Geschrieben wird nur der geöffnete Block; um beide Kopien zu ändern, öffnen und aktualisieren Sie jede einzeln. Die Kopfzeile des Fragments trägt ein Abzeichen **XOR** mit dem Schlüssel, das daran erinnert, dass seine Bytes nicht die der Datei sind.

**Werkzeuge ▸ UEFI-Struktur**, auf diesem Fragment geöffnet, zeigt den Block als eigenen Knoten, **LENV-Block**, mit seinen Einträgen darunter, so gelesen wie im Dump. Ein Fragment enthält weder das Änderungsprotokoll noch die zweite Kopie; die Details sagen daher nicht, welche Kopie die Firmware liest. Die Prüfsumme im Kopf ist die des kodierten Blocks, und die Details werten sie als solche als gültig. Nach einer Änderung im Fragment stimmt sie nicht mehr und erscheint rot mit dem Wert, den sie haben müsste; **In der Quelle aktualisieren** schreibt diesen Wert.

Der Befehl steht für einen Block zur Verfügung, der Einträge enthält und dessen Kodierung erkannt wurde; für einen leeren Block und für das Protokoll nicht.

## Die Einträge

Ein Eintrag ist durch einen Namensraum und einen Typ bestimmt. Für den Namensraum SMBIOS sind folgende Typen bekannt: der Windows-Schlüssel, die OA3-Schlüssel-ID, die Bezeichnung der Hauptplatine, Maschinentyp und Modell (MTM), die Seriennummer der Hauptplatine, die System-UUID, die Plattform-ID der Hauptplatine und das Suffix des vorinstallierten Betriebssystems. Diese Einträge benennt der Baum und zeigt ihre Werte als Text, die UUID in der Bytereihenfolge von SMBIOS.

In realen Images kommen weitere Typen vor, deren Bedeutung nicht dokumentiert ist. Der Baum bezeichnet sie als unbekannt, nennt die Typnummer und zeigt den Wert als Text, sofern alle Bytes druckbar sind, andernfalls hexadezimal. Die Merkmale eines Eintrags und zwei seiner Felder, die in allen untersuchten Images null sind, werden unverändert wiedergegeben.

**Von der Firmware gelesen** in den Details eines Eintrags nennt die Treiber dieses Images, die den Eintrag bei der Firmware abfragen. Der Baum findet sie, indem er den Code jedes Treibers im Image, auch in komprimierten Sections, nach dem Schlüssel des Eintrags durchsucht, nachdem der Speicher angezeigt ist; die Zeile erscheint, sobald die Suche abgeschlossen ist, in den untersuchten Images innerhalb weniger Sekunden. Dort liest zum Beispiel `InstallMsdm` den Windows-Schlüssel und baut daraus die ACPI-Tabelle MSDM, und `L05SmbiosOverride` oder `OemUpdateSMBios` liest die Einträge, aus denen die SMBIOS-Tabellen gefüllt werden – so zeigt sich, wofür ein Eintrag dient, auch wo seine Bedeutung nicht dokumentiert ist. Ein Treiber, der den Schlüssel zur Laufzeit berechnet, statt ihn als Konstante zu nennen, wird nicht gefunden; **Kein Treiber dieses Images greift darauf zu** bedeutet daher, dass kein Treiber den Schlüssel als Konstante nennt. Für einen Block, der für sich in einem Fragment geöffnet ist, entfällt die Zeile: Um ihn herum gibt es keine Firmware.

## Der Eintrag des Windows-Schlüssels

Im Eintrag des Windows-Schlüssels steht vor dem Produktschlüssel ein Kopf von 20 Bytes. Er ist die Lizenzstruktur der ACPI-Tabelle [[term:slic|MSDM]], wie die Spezifikation von Microsoft ([[web:https://learn.microsoft.com/en-us/previous-versions/windows/hardware/design/dn653305(v=vs.85)|Microsoft Software Licensing Tables (SLIC and MSDM)]]) sie festlegt und die Firmware Test Suite sie prüft ([[web:https://lists.ubuntu.com/archives/fwts-devel/2015-July/006546.html|fwts MSDM test]]). Alle Felder sind 32 Bit breit, niederwertiges Byte zuerst:

- **Version** – in allen untersuchten Dumps 1; die Firmware Test Suite prüft sie nicht.
- **Reserviert** – null.
- **Datentyp** – 1, ein Produktschlüssel.
- **Daten reserviert** – null.
- **Datenlänge** – 29 (`1D000000`), die Länge des Schlüssels.
- **Daten** – der Schlüssel selbst, `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`.

Die ersten 16 Bytes lauten daher stets `01000000 00000000 01000000 00000000`, und die Details behandeln sie als Signatur. Als Wert erscheint nur der Schlüssel; der Kopf wird in den Details unter **Schlüsselkopf** beschrieben. Der Schlüssel wird nur dann vom Kopf getrennt, wenn die Signatur vorhanden ist und die angegebene Länge der Zahl der folgenden Bytes entspricht; andernfalls wird der Eintrag als Bytes gezeigt und als fehlerhaft markiert, und **Schlüsselkopf** nennt die Bedingung, die nicht erfüllt ist.

## Das Änderungsprotokoll

Das Protokoll hält fest, was die Firmware wann in den Speicher geschrieben hat: Datum und Uhrzeit aus der Echtzeituhr, den Vorgang, den Eintrag und die Zahl der Bytes. Werte enthält es nicht. Bei einem Ereignis, das vor dem Stellen der Uhr geschrieben wurde, stehen statt des Datums dessen Bytes. Ein **Schreiben** von null Bytes erscheint als **Entfernen**: In den untersuchten Images fehlt der Eintrag danach im neueren Block.

## Was bekannt ist und was nicht

Das Format hat das Projekt [[web:https://github.com/Shmurkio/LenovoDMIDecryptor|LenovoDMIDecryptor]] aus dem Modul `LenovoVariableDxe` rekonstruiert; das Projekt [[web:https://github.com/Shmurkio/LenovoVar|LenovoVar]] desselben Autors, das den Speicher über das Protokoll der Firmware selbst liest und schreibt, bestätigt die Eintragstypen und die Bytereihenfolge der UUID. Das Lesen wurde an realen Dumps überprüft. Wo die Beschreibung des Projekts und die Dumps voneinander abweichen, folgt es den Dumps: Ein Protokollereignis ist 32 Bytes lang, obwohl die Feldoffsets der Beschreibung zusammen 24 ergeben, und das Jahr eines Ereignisses ist als BCD-Jahrhundert und BCD-Jahr gespeichert, nicht als 2000 plus ein Byte.

Nicht bestätigt ist, wie die Firmware auf die Schreibschutzbits eines Blocks und eines Eintrags reagiert, und was die unbekannten Typen und Felder enthalten. Das Änderungsprotokoll ist nicht immer mit dem Schlüssel der Blöcke kodiert: In einem der untersuchten Dumps sind die Blöcke mit `A0` und das Protokoll mit `88` kodiert. Der freie Platz des Protokolls besteht aus kodierten Nullen; das wiederholte Byte nach dem letzten Ereignis ist daher sein Schlüssel, und der Baum entnimmt ihn dort.

! Der Baum selbst ändert nichts am Speicher: Bearbeitet wird in einem Fragment, das mit „Dekodierten Block öffnen“ geöffnet und mit „In der Quelle aktualisieren“ zurückgeschrieben wird; ob die Platine danach mit den neuen Werten startet, ist nicht bestätigt. Sind beide Blöcke leer, wurde der Speicher gelöscht oder nie beschrieben: Seriennummer und UUID der Platine sind in diesem Image nicht enthalten. Sie lassen sich dann nur einem früheren Dump derselben Platine, sofern einer aufbewahrt wurde, oder dem Typenschild entnehmen.

Siehe auch: [[topic:recipe-board-data|Platinenspezifische Daten]], [[term:dmi|DMI]].
