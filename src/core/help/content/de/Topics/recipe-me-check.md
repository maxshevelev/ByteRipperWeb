@source-sha 0ec53d17473aa4c5c296c64f8c6864c2dfa38f8b66e5f79ef64ff441211c383f
# Den ME-Bericht lesen

> Was die beiden Registerkarten des ME Analyzer enthalten und wie die einzelnen Zeilen der Übersicht zu lesen sind.

**Werkzeuge ▸ ME Analyzer** analysiert die [[term:me-region|ME-Region]] des Images im zugehörigen Bereich und meldet das Ergebnis auf den beiden Registerkarten „Übersicht“ und „Vollständige Angaben“. Das Werkzeug selbst ist unter [[topic:tool-me|ME Analyzer]] beschrieben; diese Seite behandelt den Inhalt des Berichts.

Die Zeilenbezeichnungen der Übersicht stehen in jeder Sprache der Oberfläche auf Englisch. Es sind die Bezeichnungen der Ausgabe des Skripts `MEA.py` aus dem Projekt ME Analyzer, auf dem die Analyse beruht, und sie bleiben unverändert, damit ein Bericht mit der Ausgabe jenes Projekts verglichen werden kann. Siehe [[topic:provenance|Woher dieses Wissen stammt]].

## Wenn keine Firmware gemeldet wird

Die Meldung, dass nichts in der Datei sich als Intel-ME-Firmware lesen lässt, deckt drei verschiedene Fälle ab, die das Werkzeug nicht voneinander unterscheidet:

- das Image enthält keine ME-Region — eine AMD-Plattform, eine Plattform älter als die ME oder der Dump eines anderen Bausteins;
- der Descriptor deklariert eine ME-Region, deren Inhalt gelöscht ist. Die deklarierte Region zeigt das Werkzeug [[topic:tool-uefi|UEFI-Struktur]], und ob sie aus `FF` besteht, ist in der Hex-Ansicht zu sehen;
- die Region ist vorhanden, ihr Anfang aber so weit beschädigt, dass die Tabelle [[term:fpt|$FPT]] nicht gefunden wird.

## Die Zeilen der Übersicht

- **Family**, **Version**, **SKU**, **Release**, **Date** — aus dem Manifest und der Partitionstabelle gelesen. Die Version benennt die Plattformgeneration, für die die Firmware gebaut wurde.
- **Type** — ob es sich um eine vollständige Firmware, ein Update oder eine aus einem vollständigen Image entnommene Region handelt.
- **Chipset**, **Chipset Stepping**, **NVM Compatibility** — die Plattform, deren Unterstützung die Firmware deklariert.
- **TCB Security Version Number**, **ARB Security Version Number**, **Version Control Number** — die Zähler, über die die Plattform Firmware zurückweist, die älter ist als die bereits angenommene. Siehe [[term:svn|SVN]] und [[term:vcn|VCN]].
- **Production Ready** — ob es ein Serien- oder ein Vorserienstand ist.
- **OEM Configuration** — ob das Image einen Signaturschlüssel des Herstellers oder eine Unlock-Partition enthält.
- **FWUpdate Support** — ob Intels eigenes Update-Werkzeug dieses Image an Ort und Stelle neu schreiben kann.
- **Size** — wie weit die Firmware von ihrer `$FPT`-Tabelle aus reicht. Das ist eine Eigenschaft der Firmware, nicht die Länge der Region oder der Datei.
- **Flash Image Tool** — die Version von Intels Flash Image Tool, mit dem das Image gebaut wurde, soweit das Image sie festhält.
- **File System State** — siehe den nächsten Abschnitt.

Zeilen, die für die jeweilige Familie nicht beantwortet werden konnten, bleiben grau, statt mit einer Vermutung gefüllt zu werden.

## Die Zeile File System State

Die Zeile meldet den Zustand des Dateisystems [[term:mfs|MFS]] in der Region und erscheint nur bei den Familien, die ein solches besitzen. Es gibt drei Werte, und der Parser entscheidet nach den folgenden Merkmalen zwischen ihnen.

**Initialized.** Entweder enthält das Volume mindestens eine der Low-Level-Dateien mit den Indizes 0–5 oder 8, oder ein EFS-Volume darin enthält Dateiinhalte. Das ist der Zustand einer Region, in der die Engine gelaufen ist und eigene Dateien geschrieben hat.

**Configured.** Solche Dateien fehlen, es existiert aber eine Low-Level-Datei mit Index 7 oder 9 — OEM-Konfiguration und Home Directory — oder das Image enthält eine von Intels Flash Image Tool geschriebene Konfiguration: ein nicht leeres Modul `fitc.cfg` oder eine Partition `FITC`, `CDMD` oder `MFSB`. Das ist der Zustand einer Region, der eine Konfiguration gegeben wurde, in der die Engine aber noch nicht gelaufen ist.

**Unconfigured.** Keine der vorstehenden Bedingungen trifft zu. In diesem Zustand verlässt die Firmware den Plattformhersteller; in ihm befindet sich auch eine Region, deren Dateisystem entfernt wurde.

Ein Übergang verbindet die Zustände. Das erste Einschalten einer Platine mit einer sauberen Region im Zustand **Configured** und einem funktionsfähigen Chipsatz initialisiert sie: Die Engine legt die Dateien an und bindet die Region an diesen Chipsatz, überführt sie also in den Zustand **Initialized**.

Zu diesen Merkmalen gehören zwei Einschränkungen:

- Auf CSME 15 und 16 benennt das Volume seine Dateien über eigene Tabellen statt über den Index, weshalb der Parser dort aus den Dateiindizes nichts ableitet. Ein solches Volume wird allein über die beiden übrigen Regeln bestimmt.
- Im zugrunde liegenden Projekt gibt es einen vierten Wert, **Error**, für den Abbruch der Analyse. Die hier verwendeten Decoder setzen ihn nicht.

Unmittelbar unter dem Zustand — auf der Registerkarte **Übersicht** ebenso wie in der Zeile **Firmware** der Registerkarte **Vollständige Angaben** — steht die **Grundlage des Zustands**: welches der drei Kriterien den Zustand bestimmt hat und was die übrigen ergeben haben. Der Wert des Zustands ist der des zugrunde liegenden Projekts; die Grundlage fügt dieses Werkzeug hinzu. Sie wird als Warnung dargestellt, und der Zustand selbst erscheint dann nie grün, wenn ein Kriterium, das den Zustand hätte anheben können, nicht geprüft werden konnte — meist eine in der Partitionstabelle eingetragene EFS-Partition, deren Volume sich nicht lesen ließ, etwa weil ihre Systemseite gelöscht ist. **Configured** bedeutet dann nur, dass eine Konfiguration gefunden wurde. Ob das EFS von der Engine geschriebene Dateien enthält — dann wäre der Zustand **Initialized** —, ist unbekannt, und die EFS-Partition ist zu prüfen, bevor man sich auf den Zustand verlässt.

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
