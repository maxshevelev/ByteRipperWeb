@source-sha 21b78197e571367b9759ddf36bbbc217037f9d58eec375b1cdc50e2436595f32
# Woher dieses Wissen stammt

> Worauf die Werkzeuge sich stützen, wenn sie Strukturen decodieren, für die keine Spezifikation veröffentlicht ist.

Die Werkzeuge benennen Strukturen, für die **kein Hersteller eine Spezifikation veröffentlicht hat**: Die Partitionstabelle der Intel ME, ihre Manifeste, ihr Dateisystem und ihre Unlock-Token gehören alle dazu. Was die Werkzeuge wissen, ist das Ergebnis von Reverse Engineering, und das Handbuch sagt es, statt es unausgesprochen zu lassen.

## Worauf die Decodierung beruht

- **Unabhängige Reverse-Engineering-Projekte.** Die ME-Decodierung folgt ME Analyzer, die UEFI-Decodierung UEFITool. Beides sind langjährige Projekte der Gemeinschaft, die von vielen gelesen und korrigiert werden.
- **Intels eigene Werkzeuge und deren Vokabular.** Intels Flash Image Tool *schreibt* diese Strukturen, und seine Konfigurationsdateien benennen die Einstellungen und die Pfade. Wo ein Feld „OEM configurable“ heißt, ist das Intels Formulierung. Die Byte-Aufteilung dahinter ist nirgends veröffentlicht.
- **Intels Übersichtsdokumente** — das öffentliche CSME-Sicherheits-White-Paper, die Unterlagen zur Debug-Freischaltung — benennen die Bestandteile und die Begriffe (den Startablauf, Anti-Rollback, [[term:svn|SVN]] und [[term:vcn|VCN]]), ohne einen einzigen Offset zu nennen. Die einzige benachbarte Struktur mit echter Herstellerdokumentation ist der [[term:flash-descriptor|Flash Descriptor]], beschrieben in den Programming Guides zum Chipsatz.
- **Übereinstimmung unabhängiger Arbeiten.** Getrennte Untersuchungen des ME-Innenlebens beschreiben dieselben Volumes, Ketten und Integritätstabellen, zu denen auch diese Decodierung kommt — unabhängig voneinander erarbeitet. Die Übereinstimmung unabhängiger Arbeiten ist der stärkste äußere Beleg, den es hier gibt.
- **Beobachtungen aus der Reparaturpraxis, als solche gekennzeichnet.** Ein Teil dessen, was das Glossar festhält, ist keine Formatanalyse: wo ein Hersteller eine Seriennummer üblicherweise ablegt, womit die Firmware eines Embedded Controllers meist beginnt, welche NVRAM-Variable ein Passwort enthält. Das stammt aus Reparatur-Communitys — unter anderem aus dem Wiki [[web:https://github.com/ISpillMyDrink/UEFI-Repair-Guide/wiki|UEFI Repair Guide]] — und kein Datenblatt deckt es. Das Handbuch sagt es überall dort, wo es sich darauf stützt, und nennt die Quelle, damit eine Aussage, die in keinem Datenblatt nachzuschlagen ist, wenigstens bis zu demjenigen zurückverfolgt werden kann, der sie festgehalten hat.
- **Die Bytes selbst.** Aufgehende [[term:crc|CRC]]-Werte, Hashes und Nonces genau dort, wo das Flag einer Tabelle sie angibt, deklarierte Längen, die passen, Adressen, die auf die von ihnen benannten Strukturen treffen. Das prüft die *Deutung* ohne Spezifikation, und darauf kann ein Werkzeug sich aus eigenem Beleg berufen.

## Wie die Werkzeuge damit umgehen

- **Ein Feld, das niemand dokumentiert hat, behält seinen Rohwert** und wird als unbekannt oder reserviert bezeichnet. Es bekommt nie einen sicher klingenden Namen, der bloß eine Vermutung wäre.
- **Ein Name aus einem Katalog ist als solcher gekennzeichnet**, und ein Name wird nie mit einer Messung vermengt: Die Größe stammt aus dem Flash, der Name aus einer [[topic:databases|Datenbank]].
- **Eine Aussage reicht nur so weit wie das, worauf sie beruht.** „Diese Prüfsumme geht nicht auf“ ist eine Aussage über die Bytes. „Das ist Firmware-Version 11.8.50.3399“ ist eine Aussage über das Versionsfeld. „Das ist ein Lenovo-ThinkPad-Image“ ist keine Aussage, die ein Werkzeug trifft.

## Die Grenzen der Decodierung

Die Werkzeuge **finden und prüfen**: wo eine Region beginnt, ob eine Prüfsumme aufgeht, ob eine Adresse auf das zeigt, was sie deklariert. Diese Ergebnisse ruhen auf den Bytes der Datei.

Ob eine signierte und geprüfte Firmware von einer Plattform angenommen wird, stellen sie nicht fest. Eine korrekt decodierte Struktur kann dennoch eine sein, die die Plattform aus einem Grund ablehnt, der im Image überhaupt nicht abgebildet ist. Wo ein Werkzeug unsicher ist, meldet es die Unsicherheit, statt sie aufzulösen.
