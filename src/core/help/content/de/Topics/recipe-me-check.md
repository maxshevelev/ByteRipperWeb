@source-sha 881c8a0d7f21ce87dd14bb56a1b9d9cd23a18ddbea6fff040ca4681599fcf1e7
# Eine ME-Region prüfen

> Ist die Engine-Firmware da, ist sie vollständig, und gehört sie zu dieser Platine?

Öffnen Sie den Dump, schalten Sie **Werkzeuge ▸ ME Analyzer** ein und lesen Sie den Tab „Übersicht“.

## Was die Antworten bedeuten

- **„Nichts in dieser Datei liest sich als Intel-ME-Firmware.“** Entweder hat der Dump keine ME-Region (eine AMD-Platine, eine ältere Plattform, ein EC-Dump) oder die Region wurde gelöscht. Sehen Sie im [[topic:tool-uefi|UEFI-Panel]] nach: gibt es im Descriptor eine ME-Region und ist sie voller `FF`, wurde sie gelöscht oder „gereinigt“.
- **Eine Version und eine SKU.** Die Region ist da und ihre Header lassen sich zerlegen. Vergleichen Sie die Version mit dem, was die Platine haben sollte — eine Version aus einer anderen Plattform-Generation ist ein Spender-Image von der falschen Maschine.
- **Meldungen in der Übersicht.** Die Analyse zeigt, was sie sammeln konnte. Sie sind die Kurzfassung der „Vollständigen Angaben" und wiederholen den gewohnten Ausgabestil des Skripts MEA.py aus dem Projekt ME Analyzer. Um diese Information zu behalten oder mit Kollegen zu teilen, können Sie die „Übersicht" als Text oder ein Bildschirmfoto in die Zwischenablage kopieren — mit den zwei Knöpfen in der Tab-Leiste.

## Was in den vollständigen Angaben zu prüfen ist

- Die [[term:fpt|$FPT]] führt die Partitionen auf, die die Region deklariert. Sind die Bytes einer Partition nicht wirklich da, oder passt ihre Größe nicht zur Tabelle, ist die Region abgeschnitten — womöglich das Ergebnis eines schlechten Dumps oder eines halb geschriebenen Flash.
- Die [[term:cpd|Code-Partitionen]] und ihre Module sollten vorhanden und in sich stimmig groß sein.
- Eine gelöschte Sektion oder eine mit Größe null wird grau gezeichnet: sie ist ein Platz in der Aufteilung, nichts zum Lesen.

## Häufige Lagen am Arbeitsplatz

- **Eine „gereinigte“ ME** (die Region von einem Werkzeug wie me_cleaner auf ein startfähiges Minimum gekürzt) ist ein zulässiger Zustand, kein Schaden. Das Panel zeigt einen deutlich kleineren Satz Partitionen.
- **Eine ME in Wiederherstellung** zeigt sich auf der Platine als Maschine, die eine halbe Stunde läuft und neu startet. Tut eine Platine das, ist die ME-Region eine gute Stelle zum Nachsehen.
- **Provisionierte Werte** liegen in der Konfiguration der Region. Eine Spender-ME bringt die des Spenders mit.

! Die ME-Region von Hand zu ändern ist keine Reparatur. Ihre Integrität wird vor dem Ausführen geprüft, und eine geänderte Region wird abgewiesen statt ausgeführt. Die Reparatur besteht darin, eine passende Region als Ganzes hinüberzuholen — aus dem Update-Paket des Herstellers für genau dieses Modell oder aus einem bekannt guten Dump derselben Platine — und danach die platinenspezifischen Teile in Ruhe zu lassen ([[topic:recipe-board-data|Platinenspezifische Daten bewahren]]).

Die Wörter, die das Panel verwendet, erklärt das ME-Glossar; drücken Sie das **?** neben der Detailliste zu der Zeile, die Sie gerade ansehen.
