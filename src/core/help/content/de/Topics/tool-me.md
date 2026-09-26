@source-sha f02524e8186844a2ea108dbf1c6da688f310858be6d32dd619e9297df59a4f20
# ME Analyzer

> Was für eine Intel-Management-Engine-Firmware im Image steckt und woraus sie besteht.

**Werkzeuge ▸ ME Analyzer** lässt eine Analyse der [[term:me-region|ME-Region]] laufen und zeigt das Ergebnis auf zwei Tabs.

## Übersicht

Der Bericht, den man am Arbeitsplatz zuerst liest: Firmware-Familie und -Version, die [[term:sku|SKU]], Release und Typ, die [[term:svn|Sicherheitsnummern]], ob es eine vollständige Produktionsfirmware oder ein Update ist, und alle Meldungen, die die Analyse für nennenswert hielt.

Kopieren lässt sie sich als Text (für eine Notiz oder einen Auftrag) oder als Bild — mit den beiden Tasten in der Tab-Zeile.

## Vollständige Angaben

Alles, was sich zerlegen ließ, als Baum der tatsächlichen Strukturen der Region, wobei jede Zeile für echte Bytes steht: die [[term:fpt|Partitionstabelle]], die [[term:cpd|Code-Partitionen]] und ihre Module, die [[term:manifest|Manifeste]], das [[term:mfs|Dateisystem]] und seine Konfiguration, die [[term:oem-config|OEM-Konfiguration]], die [[term:utok|Unlock-Token]].

Wählen Sie eine Zeile, springt der Dump zu diesen Bytes und umreißt sie. Die Detailliste unter dem Baum ist das, was im Header dieser Zeile tatsächlich steht.

## Wie man es am Arbeitsplatz liest

Drei Fragen, die das Panel schnell beantwortet:

- **Gibt es hier überhaupt ME-Firmware, und welche Version?** Eine Region voller `FF` ist eine gelöschte oder „gereinigte“ ME. Eine Version weit älter als die Platine ist ein Spenderdump von der falschen Maschine.
- **Ist sie vollständig?** Der Baum führt die Partitionen auf, die die [[term:fpt|$FPT]] deklariert. Eine Partition, deren Bytes nicht da sind, oder deren Größe nicht passt, ist eine abgeschnittene oder beschädigte Region.
- **Ist sie für diese Platine konfiguriert?** Die [[term:mfs|MFS]]-Konfiguration und die [[term:oem-config|OEM-Konfiguration]] sind der Ort platinenspezifischer Einstellungen. Ein Spender-Image bringt die des Spenders mit.

! Die ME-Region prüft die Engine selbst, bevor sie läuft. Sie von Hand zu ändern ist keine Reparatur — es ergibt eine Platine, die hängt, im Takt neu startet oder gar nicht erst aus dem Reset kommt. Stattdessen setzt man eine passende Region als Ganzes ein. Siehe [[topic:recipe-me-check|Eine ME-Region prüfen]].

## Was die Namen bedeuten

Zu jeder Abkürzung in diesem Panel gibt es einen Glossareintrag: wählen Sie eine Zeile und drücken Sie das **?** neben der Detailliste — es öffnet den Eintrag zu genau dieser Zeile. Das ME-Glossar als Ganzes öffnen Sie aus dem Inhaltsverzeichnis der Hilfe.

Woher die Zerlegung stammt und wie weit ihr zu trauen ist, steht auf einer [[topic:provenance|eigenen Seite]], die einmal zu lesen sich lohnt.
