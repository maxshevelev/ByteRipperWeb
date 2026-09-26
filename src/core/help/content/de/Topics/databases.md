@source-sha f554a20792ad27732b0188dd3b1b190329c972030800a9cb66bbc31782d66f53
# Die Online-Kataloge

> Drei öffentliche Listen, die Zahlen im Dump in Namen verwandeln. Ohne sie läuft das Programm.

Ein Teil dessen, was die Firmware-Panels zeigen, steht gar nicht in der Datei — es ist ein Name, den die Gemeinschaft einer Kennung gegeben hat, die die Datei trägt. Dafür lädt ByteRipper über HTTPS von GitHub drei öffentliche Kataloge und behält jeden einen Tag:

- **UEFI-GUID-Namen** — aus dem UEFITool-Projekt. Sie machen aus einer nackten [[term:guid|GUID]] im [[topic:tool-uefi|UEFI-Panel]] ein „AmiBoardInfo“ oder „DxeCore“.
- **CPU-Microcode** — aus der Sammlung CPUMicrocodes. Damit werden die Microcode-Updates benannt, die das [[topic:tool-fit|FIT-Panel]] auflistet: welche CPU-Signatur, welche Revision, welches Datum.
- **ME-Firmware-Datenbank** — aus dem „ME Analyzer“-Projekt. Mit ihr kann das [[topic:tool-me|ME-Panel]] sagen, welchem bekannten Firmware-Release ein Image entspricht.

## Was Tatsache ist und was ein Name

Diese Unterscheidung zählt am Arbeitsplatz, und die Panels halten sie:

- **Die Bytes gehören der Datei.** Ein Offset, eine Größe, ein Versionsfeld, eine Prüfsumme — alles aus dem Image vor Ihnen gelesen.
- **Der Name gehört dem Katalog.** Er ist eine Zuordnung der Gemeinschaft, er kann fehlen, und er kann falsch sein.

Eine Zeile „AmiBoardInfo · 0x7A0000 · 0x12C0“ heißt also: *die Datei hat an dieser Adresse tatsächlich ein Modul dieser Größe, und der Katalog sagt, dass diese GUID üblicherweise AmiBoardInfo heißt*.

## Wie alt die Kopie ist

Ein Katalog liegt im eigenen Cache des Browsers, sodass ein Arbeitsplatz ohne Netz die gestrigen Listen hat statt gar keine. Was vorliegt, wird mit dem Datum gezeigt, an dem es geholt wurde, denn gestrige Daten dürfen nie für heutige gehalten werden:

- Jünger als einen Tag, und es wird verwendet, ohne das Netz überhaupt zu fragen.
- Älter, und es wird **sofort** verwendet, während die Prüfung dahinter läuft — ein Arbeitsplatz wartet nicht auf einen Namen.
- Eine Prüfung, die nicht gelingt, behält das Vorliegende und sagt, wie alt es ist.

## Ohne Netz

Das Programm braucht das Netz nirgends. Ohne Verbindung — oder wenn die Abfrage blockiert ist — zeigen die Panels Bezeichner statt Namen und sagen nichts weiter dazu: keine Dialoge, keine Wiederholungen im Weg. Alles, was aus den Bytes gelesen ist, bleibt davon unberührt.

Über Ihre Datei wird nie etwas irgendwohin gesendet. Es sind Lesezugriffe auf öffentliche Listen, die diese Seite von Ihrem Rechner aus macht; der Dump selbst verlässt ihn nie.

! Die Website-Daten zu löschen, löscht auch die zwischengespeicherten Kataloge — samt Ihren Lesezeichen und Einstellungen. Der nächste Durchlauf holt sie wieder, wenn ein Netz da ist, und kommt ohne sie aus, wenn nicht.
