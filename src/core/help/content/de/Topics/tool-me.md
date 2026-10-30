@source-sha 25ed05adbf474e85006509e6ba62110f41685d0878ee83fc932a66c423579437
# ME Analyzer

> Welche Intel-Management-Engine-Firmware das Image enthält und aus welchen Strukturen sie besteht.

**Werkzeuge ▸ ME Analyzer** analysiert die [[term:me-region|ME-Region]] der Datei im zugehörigen Bereich und meldet das Ergebnis auf drei Registerkarten.

## Übersicht

Ein Bericht darüber, was die Firmware ist: Familie und Version, die [[term:sku|SKU]], Freigabestand und Typ, die [[term:svn|Sicherheitsnummern]], ob es eine vollständige Firmware oder ein Update ist, sowie die Meldungen, die die Analyse ausgelöst hat. Die einzelnen Zeilen sind unter [[topic:recipe-me-check|Den ME-Bericht lesen]] erläutert.

Die Zeilenbezeichnungen stehen in jeder Sprache der Oberfläche auf Englisch: Es sind die Bezeichnungen des Projekts, auf dem die Analyse beruht. Siehe [[topic:provenance|Woher dieses Wissen stammt]].

Die Registerkarte erscheint, sobald die Region gelesen ist. Manche Werte hängen von Datenbanken des Projekts ab, auf dem die Analyse beruht; sie werden geladen, während der Bereich geöffnet ist. Solange sie nicht geladen und berücksichtigt sind, steht bei diesen Werten **Loading…**, und die Zeile am unteren Rand des Bereichs nennt, was gerade geladen wird. Das betrifft den **File System State** einer Firmware mit EFS-Volume sowie die Zeile **Module checks** am Ende der **Messages**; dieselbe Zeile enthält die Gruppe **Probleme** auf der Registerkarte **Vollständige Angaben**. Die Meldungen darüber sind endgültig. Lässt sich eine Datenbank nicht laden, bleiben die angezeigten Werte bestehen.

Die beiden Tasten in der Registerkartenzeile kopieren die Registerkarte als Text oder als Bild des Bereichs.

## Konfiguration

Die Einstellungen der Konfigurationsdateien, die das Image enthält, für CSME 11 bis 18 nach den Strukturbeschreibungen gelesen, mit denen das Intel Flash Image Tool arbeitet. Jede Datei bildet einen eigenen Block; seine Überschrift nennt den Namen der Datei im Flash Image Tool, ihren Ort und ihre Länge. Jede Einstellung ist eine Zeile mit ihrem Namen im Flash Image Tool und ihrem Wert. Ein Image kann eine Datei in zwei Exemplaren führen — dem beim Build geschriebenen (**FITC**) und dem im [[term:mfs|ME-Dateisystem]] (**MFS**); sind beide vorhanden, stehen die Werte nebeneinander, und ein Wert, der vom anderen Exemplar abweicht, ist fett gesetzt. **auto** kennzeichnet eine Einstellung, die das Werkzeug selbst ausfüllt. Hängt die Lage einer Einstellung vom Wert einer anderen ab, wird dieser Wert genannt, und als angenommen gekennzeichnet, wenn das Image ihn nicht enthält. Eine Einstellung, die das Werkzeug bei einem bestimmten Wert einer anderen außer Kraft setzt, erscheint grau, und dieser Wert wird genannt.

Die Taste **?** neben einer Einstellung zeigt, was das Flash Image Tool zu ihr sagt. Gehört die Generation nicht zu diesem Bereich oder enthält das Image keine der Dateien, meldet die Registerkarte, dass keine Konfiguration gelesen wurde.

## Vollständige Angaben

Die decodierten Strukturen als Baum, in dem jeder Zeile tatsächliche Bytes der Region entsprechen: die [[term:fpt|Partitionstabelle]], die [[term:cpd|Code-Partitionen]] und ihre Module, die [[term:manifest|Manifeste]], das [[term:mfs|Dateisystem]] und seine Konfiguration, die [[term:oem-config|OEM-Konfiguration]] und die [[term:utok|Unlock-Token]].

Die Auswahl einer Zeile scrollt den Dump zu diesen Bytes und umrandet sie. Eine Datei des [[term:mfs|MFS]]- oder [[term:efs|EFS]]-Volumes liegt nicht an einem Stück: Ihre Zeile umrandet jeden Chunk der Datei, wo immer das Volume ihn abgelegt hat, und der Dump springt zu dem Chunk, mit dem die Datei beginnt (siehe [[term:zone|Zone]]). Eine Datei ohne Daten erscheint grau, wie eine leere Partition. Ein Doppelklick auf eine Zeile öffnet ihre Bytes in einem [[topic:fragments|Fragmentbereich]]; eine Datei des Volumes öffnet sich als ihr aus den Chunks zusammengesetzter Inhalt, mit dem Abzeichen **Zusammengesetzt**, und wird beim Zurückschreiben an dieselben Stellen gelegt. Die Detailliste unter dem Baum enthält die Felder des Headers dieser Zeile so, wie sie in der Datei stehen.

## Was das Werkzeug meldet

- **Ob das Image ME-Firmware enthält und in welcher Version.** Eine Region, die aus `FF` besteht, enthält keine. Die Version gibt die Plattformgeneration an, für die die Firmware gebaut wurde.
- **Ob die Region vollständig ist.** Der Baum führt die Partitionen auf, die die Tabelle [[term:fpt|$FPT]] deklariert. Eine Partition, deren Bytes fehlen, oder eine, deren deklarierte Länge nicht zur Region passt, wird eigens ausgewiesen.
- **Ob die Region eine Konfiguration trägt und welcher Art.** Platinenspezifische Einstellungen liegen in der [[term:mfs|MFS]]-Konfiguration und in der [[term:oem-config|OEM-Konfiguration]]; die Zeile **File System State** nennt, in welchem der drei Zustände sich das Dateisystem befindet.

! Die ME-Region prüft die Engine vor ihrem Start. Eine an Ort und Stelle geänderte Region nimmt sie nicht an, und kein Editor erzeugt eine Manifest-Signatur, die die Engine annimmt. Was die Zustände der Region bedeuten und was aus dem Übertragen einer Region zwischen Platinen folgt, steht unter [[topic:recipe-me-check|Den ME-Bericht lesen]].

## Die Begriffe des Werkzeugs

Zu jeder Abkürzung in diesem Bereich gibt es einen Glossareintrag: Zeile auswählen und das **?** neben der Detailliste drücken, um den Eintrag zu genau dieser Zeile zu öffnen; das ME-Glossar als Ganzes öffnen Sie aus dem Inhaltsverzeichnis der Hilfe.

Woher die Decodierung stammt und wie weit sie belastbar ist, steht unter [[topic:provenance|Woher dieses Wissen stammt]].
