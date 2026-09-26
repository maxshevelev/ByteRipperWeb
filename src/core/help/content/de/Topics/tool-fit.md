@source-sha 055622ba8b521d7a08481427fdccd8a267889e7d4155171dc50215d3da51eeaf
# FIT-Tabelle

> Die Firmware Interface Table: was die CPU laden soll, bevor sie BIOS-Code ausführt, und ob es noch da ist.

**Werkzeuge ▸ FIT-Tabelle** findet die [[term:fit|Firmware Interface Table]] im Image und führt ihre Einträge auf.

Die FIT sitzt nahe der oberen Flash-Grenze und wird über einen Zeiger an einer festen Adresse unterhalb von `4 GB` gefunden. Jeder Eintrag hat eine Adresse, eine Größe und einen Typ: ein [[term:microcode|Microcode-Update]], ein ACM, ein Boot-Guard-Manifest, einen TXT-Policy-Eintrag.

## Was das Panel tut

- **Führt die Einträge auf**, mit Typ, Adresse und Größe.
- **Geht jeder Adresse nach**, statt ihr zu glauben. Die Spalte „zeigt auf“ sagt, was an dieser Adresse tatsächlich liegt: ein Microcode-Update mit passendem Header, ein Manifest — oder gar nichts. Ein Eintrag, der in gelöschten Flash zeigt, ist das klassische Zeichen einer missglückten Änderung.
- **Prüft die Regeln der Tabelle selbst**: den Kopfeintrag, die Anzahl, die Prüfsumme, die Reihenfolge. Probleme werden aufgeführt, nicht vermutet.
- **Microcode-Einträge** werden aus einem Online-Katalog benannt: CPU-Signatur, Revision und Datum. Siehe [[topic:databases|Die Online-Kataloge]].

## Am Arbeitsplatz

Eine kaputte FIT zeigt sich als Platine, die überhaupt nicht startet: kein Bild und oft kein Ton. Die CPU bekommt nie ein gültiges Microcode-Update oder ACM. Ist eine Platine direkt nach einem Flash-Vorgang oder einer Handänderung gestorben, sieht man zuerst hier nach: ein Eintrag, der auf `FF FF FF FF` zeigt, sagt genau, was passiert ist.

Siehe auch: [[topic:recipe-microcode|Microcode am Arbeitsplatz]], [[term:top-swap|Top Swap]].
