@source-sha a749aa344a7f6bcadb5dd744521863644af4742fd51cd18ea8571a6f155170b7
# Platinenspezifische Daten

> Welche Teile eines Firmware-Images einer einzelnen Platine gehören statt dem Modell, und an welcher Stelle des Images sie liegen.

Zwei Platinen desselben Modells, derselben Revision und mit derselben Firmware-Version enthalten keine identischen Images. Ein Teil des Images wird je Gerät geschrieben: im Werk, von der Firmware selbst im Betrieb und später durch Servicevorgänge. Diese Seite führt jene Teile auf und hält fest, welche davon die Werkzeuge auffinden können.

## Warum Images eines Modells sich unterscheiden

Dafür gibt es vier voneinander unabhängige Ursachen.

1. **Individuelle Programmierung bei der Fertigung.** Seriennummern, die Maschinen-UUID, MAC-Adressen und Inventarfelder werden in das Image geschrieben, nachdem die für das Modell gemeinsame Firmware programmiert wurde. Die Werte unterscheiden sich damit zwangsläufig, die Felder nicht.
2. **Konfiguration, die die Plattform im Betrieb schreibt.** Setup- und Zustandsvariablen des BIOS werden bei jeder Änderung in den [[term:vss|NVRAM]]-Speicher in der [[term:bios-region|BIOS-Region]] geschrieben, und die [[term:me|Management Engine]] schreibt fortlaufend in ihr Dateisystem [[term:mfs|MFS]]. Zwei Platinen, die eingeschaltet waren, unterscheiden sich hier auch dann, wenn absichtlich nichts geändert wurde. Siehe [[topic:flash-writes|Wer in den Flash schreibt]].
3. **Mehrere Ausführungen eines Modells.** Eine Platine wird häufig in mehreren Ausführungen unter einer einzigen Modellbezeichnung ausgeliefert. Version und Build der Firmware können sich zwischen ihnen unterscheiden und mit ihnen die werkseitigen Werte der Setup-Parameter.
4. **Spätere Eingriffe.** Ein Firmware-Update, eine Garantiereparatur oder eine frühere Reparatur hinterlassen ihre Spuren an denselben Stellen.

## Wo diese Daten liegen

- **[[term:gbe-region|GbE-Region]]** — die Konfiguration des integrierten Netzwerk-Controllers einschließlich der **MAC-Adresse**. Sie ist eine Zeile der obersten Ebene im Baum der [[topic:tool-uefi|UEFI-Struktur]]; Adresse und Länge stehen in der Detailliste.
- **[[term:me-region|ME-Region]]** — einzigartig ist an ihr in erster Linie nicht die Konfiguration, die in der Regel für die gesamte Plattform gilt. Eine Region im Zustand **Initialized** ist an einen einzelnen Chipsatz gebunden, da die Dateien ihres Dateisystems mit Schlüsseln geschützt sind, die aus dem Geheimnis dieses Bausteins abgeleitet werden. Den Zustand meldet der [[topic:tool-me|ME Analyzer]]; siehe [[topic:recipe-me-check|Den ME-Bericht lesen]].
- **NVRAM-Speicher ([[term:vss|VSS]])** — Setup- und Zustandsvariablen des BIOS. Ihnen entsprechen eigene Zeilen im Baum. Ihr Inhalt unterscheidet sich zwischen zwei Platinen: Die Firmware schreibt diese Variablen bei jeder Änderung einer Einstellung und im laufenden Betrieb.
- **Der Bereich [[term:dmi|DMI/SMBIOS]]** in der BIOS-Region — dazu der nächste Abschnitt.
- **Windows-Lizenzdaten des Herstellers** ([[term:slic|SLIC]] / MSDM) auf Maschinen des entsprechenden Zeitraums.

## Der DMI-Bereich

[[term:dmi|DMI]] ist der einzige Punkt dieser Aufzählung, dem kein Knoten im Baum entspricht: Er trägt keine Signatur, an der ein Parser ihn erkennen könnte, und wo er liegt, entscheidet der Hersteller. Geschrieben wird er im Werk, und Betriebssysteme wie Diagnosewerkzeuge lesen ihn, statt die Hardware zu befragen. Üblicherweise enthält er:

- **Seriennummern** — die der Maschine und die der Platine, und das sind zwei verschiedene Nummern.
- **MAC-Adressen** der integrierten kabelgebundenen und drahtlosen Adapter. Auf manchen Notebook-Modellen liegen sie hier und nicht in der [[term:gbe-region|GbE-Region]].
- **Die Maschinen-UUID.**
- **Inventarfelder** — Asset Tag, Herstellername, genaue Modellbezeichnung, BIOS-Version.
- **Den Windows-OEM-Schlüssel**, auf einem Teil der Notebooks im selben Herstellerblock; siehe [[term:slic|SLIC / MSDM]].

Da es keinen Knoten im Baum gibt, wird die Lage des Bereichs über die Suche nach einem unabhängig bekannten Wert bestimmt — einer Seriennummer vom Aufkleber, einer im Betriebssystem ausgelesenen MAC-Adresse ([[topic:search|Bytes und Text finden]]) — und mit einem [[topic:bookmarks|Lesezeichen]] markiert.

## Was das Programm dafür bereitstellt

- Die beiden Bereiche und der Vergleich zeigen alle Adressen, an denen zwei Images sich unterscheiden; so wird der tatsächliche Umfang der individuellen Daten für ein bestimmtes Modell ermittelt.
- Das UEFI-Werkzeug nennt Adresse und Länge der GbE-Region, der ME-Region und der NVRAM-Speicher.
- **Block ab hier auswählen, bei…** im Kontextmenü des Bereichs wählt einen solchen Bereich über seine Zahlengrenzen aus, und ⌘V überschreibt ihn, ohne nachfolgende Bytes zu verschieben.
- Lesezeichen gelten für beide Bereiche an derselben Adresse, sodass derselbe Adressbereich in beiden Images gefunden wird.

Das Programm bestimmt nicht, welche Werte für eine bestimmte Platine die richtigen sind, und liest nichts von der Platine selbst.

! In öffentlich verbreiteten Images wird der DMI-Bereich häufig überschrieben, damit die Daten des ursprünglichen Besitzers nicht mit der Datei weitergegeben werden. Ein solches Image enthält an diesen Stellen keine fremden Werte, sondern leere Felder.
