@source-sha 04e4fb075407a53044708787d11071467fefbba8eff3215b4c9afa80eaf0b1b5
# ME Analyzer

> Welche Intel-Management-Engine-Firmware das Image enthält und aus welchen Strukturen sie besteht.

**Werkzeuge ▸ ME Analyzer** analysiert die [[term:me-region|ME-Region]] der Datei im zugehörigen Bereich und meldet das Ergebnis auf zwei Registerkarten.

## Übersicht

Ein Bericht darüber, was die Firmware ist: Familie und Version, die [[term:sku|SKU]], Freigabestand und Typ, die [[term:svn|Sicherheitsnummern]], ob es eine vollständige Firmware oder ein Update ist, sowie die Meldungen, die die Analyse ausgelöst hat. Die einzelnen Zeilen sind unter [[topic:recipe-me-check|Den ME-Bericht lesen]] erläutert.

Die Zeilenbezeichnungen stehen in jeder Sprache der Oberfläche auf Englisch: Es sind die Bezeichnungen des Projekts, auf dem die Analyse beruht. Siehe [[topic:provenance|Woher dieses Wissen stammt]].

Die beiden Tasten in der Registerkartenzeile kopieren die Registerkarte als Text oder als Bild des Bereichs.

## Vollständige Angaben

Die decodierten Strukturen als Baum, in dem jeder Zeile tatsächliche Bytes der Region entsprechen: die [[term:fpt|Partitionstabelle]], die [[term:cpd|Code-Partitionen]] und ihre Module, die [[term:manifest|Manifeste]], das [[term:mfs|Dateisystem]] und seine Konfiguration, die [[term:oem-config|OEM-Konfiguration]] und die [[term:utok|Unlock-Token]].

Die Auswahl einer Zeile scrollt den Dump zu diesen Bytes und umrandet sie. Die Detailliste unter dem Baum enthält die Felder des Headers dieser Zeile so, wie sie in der Datei stehen.

## Was das Werkzeug meldet

- **Ob das Image ME-Firmware enthält und in welcher Version.** Eine Region, die aus `FF` besteht, enthält keine. Die Version benennt die Plattformgeneration, für die die Firmware gebaut wurde.
- **Ob die Region vollständig ist.** Der Baum führt die Partitionen auf, die die Tabelle [[term:fpt|$FPT]] deklariert. Eine Partition, deren Bytes fehlen, oder eine, deren deklarierte Länge nicht zur Region passt, wird eigens ausgewiesen.
- **Ob die Region eine Konfiguration trägt und welcher Art.** Platinenspezifische Einstellungen liegen in der [[term:mfs|MFS]]-Konfiguration und in der [[term:oem-config|OEM-Konfiguration]]; die Zeile **File System State** nennt, in welchem der drei Zustände sich das Dateisystem befindet.

! Die ME-Region prüft die Engine vor ihrem Start. Eine an Ort und Stelle geänderte Region nimmt sie nicht an, und kein Editor erzeugt eine Manifest-Signatur, die die Engine annimmt. Was die Zustände der Region bedeuten und was aus dem Übertragen einer Region zwischen Platinen folgt, steht unter [[topic:recipe-me-check|Den ME-Bericht lesen]].

## Die Begriffe des Werkzeugs

Zu jeder Abkürzung in diesem Bereich gibt es einen Glossareintrag: Zeile auswählen und das **?** neben der Detailliste drücken, um den Eintrag zu genau dieser Zeile zu öffnen; das ME-Glossar als Ganzes öffnen Sie aus dem Inhaltsverzeichnis der Hilfe.

Woher die Decodierung stammt und wie weit sie belastbar ist, steht unter [[topic:provenance|Woher dieses Wissen stammt]].
