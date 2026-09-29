@source-sha 089d79f699244b5c39b161173c7f7838e9dca3bb60855d2f2c26a11887e64a91
# Die Online-Kataloge

> Drei öffentliche Kataloge, die Kennungen aus einem Dump mit Namen versehen. Ohne Zugriff auf sie ist das Programm voll funktionsfähig, zeigt die zusätzlichen Angaben aber nicht an.

Ein Teil dessen, was die Werkzeugbereiche zeigen, steht gar nicht in der Datei — es ist ein Name, den die Gemeinschaft einer Kennung gegeben hat, die die Datei trägt. Dafür lädt ByteRipper über HTTPS von GitHub drei öffentliche Kataloge und behält jeden einen Tag:

- **UEFI-GUID-Namen** — aus dem UEFITool-Projekt. Sie sind es, die das [[topic:tool-uefi|UEFI-Werkzeug]] statt einer nackten [[term:guid|GUID]] „AmiBoardInfo“ oder „DxeCore“ anzeigen lassen.
- **CPU-Microcode** — aus der Sammlung CPUMicrocodes. Danach werden die Microcode-Updates benannt, die das [[topic:tool-fit|FIT-Werkzeug]] auflistet: nach CPU-Signatur, Revision und Datum. Aus ihr stammt auch die Liste, die **Microcode hinzufügen…** anbietet.
- **ME-Firmware-Datenbank** — aus dem Projekt ME Analyzer. Mit ihr kann das [[topic:tool-me|ME-Werkzeug]] angeben, welchem bekannten Firmware-Release ein Image entspricht.

## Was Tatsache ist und was ein Name

Die Werkzeuge halten die beiden Dinge auseinander:

- **Die Bytes gehören der Datei.** Eine Adresse, eine Größe, ein Versionsfeld, eine Prüfsumme werden alle aus dem Image selbst gelesen.
- **Der Name gehört dem Katalog.** Er ist eine Zuordnung der Gemeinschaft, er kann fehlen, und er kann falsch sein.

Eine Zeile „AmiBoardInfo · 0x7A0000 · 0x12C0“ heißt also: *die Datei hat an dieser Adresse tatsächlich ein Modul dieser Größe, und der Katalog sagt, dass diese GUID üblicherweise AmiBoardInfo heißt*.

## Wie alt die Kopie ist

Ein Katalog liegt im eigenen Cache des Browsers, sodass ein Arbeitsplatz ohne Netz die gestrigen Listen hat statt gar keine. Was vorliegt, wird mit dem Datum gezeigt, an dem es geholt wurde, denn gestrige Daten dürfen nie für heutige gehalten werden:

- Jünger als einen Tag, und es wird verwendet, ohne das Netz überhaupt zu fragen.
- Älter, und es wird **sofort** verwendet, während die Prüfung dahinter läuft — ein Arbeitsplatz wartet nicht auf einen Namen.
- Eine Prüfung, die nicht gelingt, behält das Vorliegende und sagt, wie alt es ist.

## Ohne Netz

Keine Funktion des Programms benötigt das Netz. Ohne Verbindung oder bei geblocktem Abruf zeigen die Werkzeuge Kennungen statt Namen und melden nichts weiter: keine Dialoge und keine wiederholten Versuche. Alles, was aus den Bytes gelesen wird, bleibt davon unberührt.

Die Abrufe gehen an feste Adressen dieser Kataloge, und eine Anfrage enthält nichts aus der geöffneten Datei: Die Seite lädt einen Katalog vollständig herunter und gleicht ihn erst auf dem Rechner mit dem Dump ab.

Daher werden weder die Bytes des Images noch die darin gefundenen Kennungen übertragen. Der Dump verlässt die Maschine nicht.

! Das Löschen der Website-Daten löscht die zwischengespeicherten Kataloge mit, samt Lesezeichen und Einstellungen. Der nächste Durchlauf lädt sie erneut, wo ein Netz da ist, und kommt ohne sie aus, wo keines da ist.

! Die Website-Daten zu löschen, löscht auch die zwischengespeicherten Kataloge — samt Ihren Lesezeichen und Einstellungen. Der nächste Durchlauf holt sie wieder, wenn ein Netz da ist, und kommt ohne sie aus, wenn nicht.
