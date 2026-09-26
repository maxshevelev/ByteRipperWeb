@source-sha 3bf6345b1b6fd8f3a90e2c4a1d92da54b47e5c7cd713814f3e3034c143a90a65
# Woher dieses Wissen stammt

> Einmal zu lesen, bevor Sie einem Panel eine Platine anvertrauen.

Die Firmware-Panels benennen Strukturen, für die **kein Hersteller je eine Spezifikation veröffentlicht hat**. Weder die Partitionstabelle der Intel ME noch ihre Manifeste, ihr Dateisystem oder ihre Unlock-Token. Was die Panels wissen, ist Reverse Engineering, und das offen zu sagen gehört zum Werkzeug.

## Worauf die Zerlegung beruht

- **Unabhängige Reverse-Engineering-Projekte.** Die ME-Zerlegung folgt ME Analyzer, die UEFI-Zerlegung UEFITool. Beides sind lange laufende Gemeinschaftsprojekte, die viele gelesen und korrigiert haben.
- **Intels eigene Werkzeuge und deren Vokabular.** Intels Flash Image Tool *schreibt* diese Strukturen, und seine Konfigurationsdateien benennen die Einstellungen und die Pfade. Wo ein Feld „OEM configurable“ heißt, ist das Intels Wendung. Die Byte-Aufteilung dahinter ist nirgends veröffentlicht.
- **Intels Übersichtsdokumente** — das öffentliche CSME-Sicherheits-White-Paper, die Unterlagen zum Debug-Unlock — benennen die Bestandteile und die Begriffe (Startablauf, Anti-Rollback, [[term:svn|SVN]] und [[term:vcn|VCN]]), ohne einen einzigen Offset zu nennen. Die einzige benachbarte Struktur mit echter Hersteller-Dokumentation ist der [[term:flash-descriptor|Flash Descriptor]], beschrieben in den Chipsatz-Programming-Guides.
- **Übereinstimmung unabhängiger Arbeiten.** Eigenständige Forschung zu ME-Interna beschreibt dieselben Volumes, Ketten und Integritätstabellen, zu denen diese Zerlegung kommt — unabhängig davon erarbeitet. Übereinstimmung unabhängiger Arbeiten ist der stärkste äußere Beleg, den es hier gibt.
- **Werkstattwissen, und es ist als solches gekennzeichnet.** Ein Teil dessen, was das Glossar sagt, ist gar keine Formatanalyse: wo ein Hersteller eine Seriennummer zu verstecken pflegt, womit die Firmware eines Embedded Controllers meist beginnt, welche NVRAM-Variable ein Passwort enthält. Das stammt aus Reparatur-Communitys — unter anderem aus dem Wiki *UEFI Repair Guide* — und kein Datenblatt deckt es. Die Hilfe sagt das überall dort, wo sie es benutzt: Das sind Anzeichen, die man gegen einen bekannt guten Dump prüft, und für sich genommen keine Diagnose.
- **Die Bytes selbst.** Aufgehende [[term:crc|CRCs]], Hashes und Nonces genau dort, wo das Flag einer Tabelle sie ansagt, deklarierte Längen, die passen, Offsets, die auf die versprochenen Strukturen treffen. Das ist eine Prüfung der *Deutung* ohne Spezifikation — und das ist, worauf sich ein Panel ehrlich berufen kann.

## Wie die Panels sich deshalb verhalten

- **Ein undokumentiertes Feld behält seinen rohen Wert** und heißt unbekannt oder reserviert. Es bekommt nie einen sicher klingenden Namen, der nur geraten wäre.
- **Ein Name aus einem Katalog ist als solcher gekennzeichnet**, und ein Name wird nie mit einer Messung vermischt: die Größe kommt aus dem Flash, der Name aus einer [[topic:databases|Datenbank]].
- **Ein Urteil ist ein Urteil.** „Diese Prüfsumme geht nicht auf“ ist eine Tatsache über die Bytes. „Das ist Firmware-Version 11.8.50.3399“ ist eine Tatsache über das Versionsfeld. „Das ist ein Lenovo-ThinkPad-Image“ wird Ihnen das Panel nicht sagen.

## Was das für Sie heißt

Benutzen Sie die Panels zum **Finden und zum Prüfen**: wo eine Region beginnt, ob eine Prüfsumme aufgeht, ob eine Adresse auf das zeigt, was sie behauptet. Dieser Teil ruht auf den Bytes.

Seien Sie vorsichtig, wenn Sie daraus **Schlüsse** über Firmware ziehen, die signiert und geprüft wird. Eine Struktur, die dieses Werkzeug korrekt liest, kann trotzdem eine sein, die die Plattform aus einem Grund ablehnt, der im Image nicht zu sehen ist. Wenn ein Panel unsicher ist, sagt es das — glauben Sie ihm.
