@source-sha 14420ac0e093420693f46c433da8ec0e70c2d9fbc232fee5ca513397719274a4
# Platinenspezifische Daten bewahren

> Ein Spender-Image kann die Identität des Spenders tragen. Das sind die Bytes, die Ihre bleiben müssen.

Fast jeder Dump enthält ein wenig Daten, die **genau dieser Platine** gehören und keiner anderen. Schreiben Sie ein Spender-Image roh, verschieben Sie die Identität des Spenders auf Ihre Platine.

## Was üblicherweise platinenspezifisch ist

- **Die [[term:gbe-region|GbE-Region]]** — die Konfiguration des integrierten Netzwerk-Controllers und damit die **MAC-Adresse**. Zwei Platinen mit einer MAC-Adresse im selben Netz sind ein Fehler, der Tage später auffällt.
- **Maschinen-UUID und Seriennummern**, die der Hersteller in einem [[term:dmi|DMI/SMBIOS]]-Bereich innerhalb der BIOS-Region hält. Über leere Felder stolpern Garantieabfrage, OEM-Aktivierung und Verwaltungswerkzeuge.
- **Die Konfiguration der [[term:me-region|ME-Region]]** — siehe [[topic:recipe-me-check|Eine ME-Region prüfen]]. In der ME liegen platinenspezifische Einstellungen, und auf vielen Plattformen auch die Werte, die der Hersteller im Werk provisioniert hat.
- **NVRAM / [[term:vss|VSS]]-Speicher** — gesicherte Setup-Variablen, Boot-Einträge, hinterlegte Secure-Boot-Schlüssel. Meist gefahrlos vom Spender zu übernehmen (die Firmware baut sich neu auf, was sie braucht), aber nicht immer: manche Hersteller legen dort Lizenz- oder Konfigurationsdaten ab.
- **OEM-Lizenzdaten von Windows** ([[term:slic|SLIC]] / MSDM) auf älteren Maschinen.

## Was im DMI-Bereich steht

[[term:dmi|DMI]] ist der einzige Punkt dieser Liste, auf den sich im Baum nicht klicken lässt — es lohnt sich also zu wissen, was darin steht. Der Hersteller schreibt ihn im Werk, und Betriebssystem wie Diagnosewerkzeuge lesen ihn, statt die Hardware abzufragen:

- **Seriennummern** — die der Maschine und die der Platine, und das sind zwei verschiedene.
- **MAC-Adressen** der eingebauten LAN- und WLAN-Adapter. Auf vielen Notebooks stehen sie hier und nicht in der [[term:gbe-region|GbE-Region]].
- **Die System-UUID.**
- **Inventarfelder** — Asset Tag, Hersteller, das genaue Modell, die BIOS-Version.
- **Der Windows-OEM-Schlüssel** liegt auf vielen Notebooks im selben Herstellerbereich — siehe [[term:slic|SLIC / MSDM]].

## Wie man es macht

1. Öffnen Sie das Spender-Image und Ihren eigenen ursprünglichen Dump nebeneinander.
2. Finden Sie jeden der obigen Bereiche im [[topic:tool-uefi|UEFI-Panel]] — GbE-Region und ME-Region sind Zeilen der obersten Ebene, ihre Offsets stehen in der Detailansicht.
3. [[topic:bookmarks|Setzen Sie ein Lesezeichen]] auf den Anfang jedes Bereichs. Beide Bereiche zeigen die Markierungen auf derselben Höhe — genau das braucht man hier.
4. Kopieren Sie jeden Bereich **aus Ihrem eigenen Dump** und setzen Sie ihn in das Spender-Image ein — schlichtes ⌘V überschreibt, es verschiebt sich also nichts.
5. Vergleichen Sie das Ergebnis ein letztes Mal mit Ihrem Dump und lesen Sie jeden verbliebenen Unterschied.

! Tun Sie das vor dem Schreiben, nicht danach. Sobald der Chip MAC und UUID des Spenders trägt, gibt es Ihre eigenen nur noch in der Datei, die Sie in Schritt 1 gesichert haben — deshalb lautet [[topic:bench-safety|die erste Regel]], dieses Lesen zu bewahren. Bei einigen Herstellern lassen sich die Felder mit einem Service-Werkzeug vom Aufkleber neu schreiben ([[term:dmi|DMI]]), aber darauf sollte man nicht im Voraus bauen.
