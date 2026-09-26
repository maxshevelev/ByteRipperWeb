@source-sha 0e5854de202df3ba8a8a38b77c212d530cb1aa33172b932320fef94c79cc0768
# Wer in den Flash schreibt

> Nur der Chipsatz hat Leitungen zum Chip. Alles auf der Platine, das den Flash lesen oder schreiben will, geht durch ihn, und wer was darf, steht im Descriptor.

Firmware kommt bauartbedingt auf einem Weg in den Chip: über den Chipsatz. Der einzige SPI-Controller der Platine sitzt im [[term:pch|Chipsatz]], also kommen die Firmware auf der CPU, ein Flash-Werkzeug, die [[term:me|Management Engine]] und der Netzwerk-Controller nur über ihn an den Chip — und er prüft ihre Rechte am Descriptor, bevor er gehorcht.

Ein [[term:programmer|Programmer]] gehört nicht zu dieser Bauweise. Er spricht die Beinchen des Chips direkt an, und es ist niemand da, den er fragen könnte: keine Rechte, keine Prüfungen. Das ist kein zweiter regulärer Weg, sondern ein Schritt außerhalb dessen, wie die Plattform gebaut ist — so kommt ein Dump von einer toten Platine, und so gehen Bytes wieder hinein, wenn der Chipsatz sie nicht mehr schreibt.

! Keine Prüfung beim Schreiben heißt nicht, dass es gar keine gibt. Die Rechte zäunen genau das ein, was die Plattform beim Start prüft. Ein Programmer nimmt den Zaun weg, nicht die Prüfung: eine Änderung in einem geschützten Bereich wird ohne ein Wort der Klage geschrieben und wird zu einer Platine, die nicht mehr startet. Bevor Sie eine Region ändern, finden Sie heraus, wer sie prüft — die Abschnitte unten sagen es.

## Die Platine schreibt ständig in ihren eigenen Flash

Und nicht nur, wenn jemand die Firmware aktualisiert:

- Sie ändern eine Einstellung im Setup und drücken F10, und die Firmware schreibt den [[term:vss|NVRAM]]-Speicher zurück in die [[term:bios-region|BIOS-Region]].
- Die Management Engine schreibt ihre eigene [[term:mfs|MFS]]: Konfiguration, Zähler, Zustand.
- Ein Update-Werkzeug des Herstellers oder Intels FPT (Flash Programming Tool) schreibt aus dem laufenden System eine ganze Region neu.

Ein heute gelesener Chip und die Datei, die gestern hineingeschrieben wurde, stimmen deshalb nicht überein, auch wenn niemand die Platine absichtlich angefasst hat: NVRAM und MFS haben sich von selbst bewegt. Das ist das Erste, was zu vermuten ist, wenn ein Vergleich Unterschiede zeigt, für die es keine Erklärung gibt.

## Was der Descriptor entscheidet

Der [[term:flash-descriptor|Descriptor]] nennt vier [[term:flash-master|Master]] — BIOS, ME, GbE und EC — und gibt jedem eine Lese- und eine Schreibmaske über die [[term:region|Regionen]]. Ein Flash-Werkzeug, das auf der CPU läuft, *ist* der BIOS-Master. Wo der Descriptor diesem Master kein Schreibrecht auf eine Region gibt, weist der Chipsatz den Schreibvorgang ab, und Wiederholen ändert daran nichts.

! Lesen ist genauso geregelt, und das trifft am härtesten. Eine Region, die der BIOS-Master nicht lesen darf, lässt sich aus dem laufenden System überhaupt nicht auslesen. Manche Programme verweigern das Lesen des ganzen Chips, andere füllen das Ungelesene mit `FF` und geben eine Warnung aus. `FF` in einem im System erstellten Dump kann also „durfte nicht gelesen werden“ heißen statt „gelöscht“ — und der Vergleich zeigt dann eine ganze Region als einen riesigen Unterschied, den es gar nicht gibt. Ein Dump vom Programmer hat solche Löcher nicht. So ist es bei flashrom dokumentiert: standardmäßig verweigert es das Lesen und füllt nur dann mit `FF`, wenn man ihm sagt, es solle die Fehler übergehen ([[web:https://flashrom.org/classic_cli_manpage.html|die Manualseite von flashrom]]).

## Schreiben heißt nicht Ausführen

Die Masken entscheiden nur eines: ob über den Chipsatz geschrieben werden darf. Ob das Geschriebene dann läuft, ist eine andere Frage, und sie wird beim Start beantwortet, von Prüfungen, die mit dem Descriptor nichts zu tun haben:

- [[term:boot-guard|Boot Guard]] prüft den Bootblock, bevor die CPU ihn ausführt. Die Signatur prüft nicht der Chipsatz: das tut das [[term:acm|ACM]], gestartet vom Mikrocode der CPU, und der Hash des Wurzelschlüssels liegt in den [[term:otp|Fuses]] des Chipsatzes.
- Die ME-Region prüft die Engine selbst, während sie hochkommt.

Daher die Trennung, an der eine Änderung scheitert, die sauber geschrieben wurde. Ein Programmer umgeht die Masken — er kann jedes Byte in jede Region schreiben. Gegen die Prüfungen beim Start richtet er nichts aus: eine Änderung innerhalb des [[term:ibb|IBB]] oder in der ME-Region wird geschrieben und danach abgewiesen.

Alles aber, was diese Prüfungen nicht abdecken — NVRAM, der [[term:dmi|DMI]]-Bereich, die [[term:ec|EC]]-Firmware und oft auch die DXE-Treiber ([[term:ibb|IBB / OBB]] sagt, wann) —, schreibt ein Programmer, und es läuft. Ein Teil der Arbeit an Dumps liegt dort: die platinenspezifischen Daten wiederherstellen, Einstellungen zurückholen, ein BIOS anpassen.

## Die Sperren, von denen der Descriptor nichts weiß

Der Descriptor ist nur eine von mehreren Schranken, und die übrigen liegen in Registern des Chipsatzes, nicht im Image:

- **BIOS Lock Enable** — der Versuch, das Schreiben in die BIOS-Region freizugeben, fällt in den System-Management-Modus, wo der Handler der Firmware selbst entscheidet.
- **SMM BIOS Write Protect** — die BIOS-Region ist nur beschreibbar, solange der Prozessor im System-Management-Modus ist.
- **Protected Range Registers** — bis zu fünf Adressbereiche, die die Firmware beim Start sperrt; sie halten sogar gegen den System-Management-Modus.
- **Flash Configuration Lockdown** — friert diese Bereiche bis zum nächsten Plattform-Reset ein.

Nichts davon steht im Dump, also kann kein Bereich es zeigen und keine Änderung es ändern. Es erklärt aber einen Schreibvorgang, der abgewiesen wird, obwohl der Descriptor ihn klar erlaubt. Die Register stehen in den Datenblättern der Chipsätze; eine kurze Darstellung, wie die vier zusammenspielen, gibt es [[web:https://eclypsium.com/blog/firmware-security-realizations-part-3-spi-write-protections/|bei Eclypsium]].

## Der Service-Übergang

Intels Chipsätze tragen einen **Flash Descriptor Security Override**: einen Servicemodus, der vollen Lese- und Schreibzugriff auf alle Regionen öffnet, bis zum nächsten Neustart. Eingeschaltet wird er nicht von einem Programm, sondern von einem Draht auf der Platine:

- Auf Chipsätzen der 6er-Serie und neuer wird der Pin `HDA_SDO` des Audio-Codecs über die steigende Flanke von `PWROK` auf seine 3,3-V-Versorgung gelegt — gehalten, während das System startet, und losgelassen, sobald die Firmware zu laden beginnt.
- Vor 2011 (5er-Serie und älter) wurde stattdessen im selben Moment `GPIO33` auf Masse gezogen.
- Manche Hersteller führen dasselbe als Jumper oder Schalter heraus.

Damit liest oder überschreibt eine Service-Prozedur eine gesperrte Region mit einem Werkzeug, ohne den Chip von der Platine zu nehmen. Ein öffentliches Datenblatt beschreibt das nicht: es steht in Intels Plattform-Leitfäden für Hersteller, und am Arbeitsplatz ist es aus den Anleitungen der Reparatur-Community bekannt — am ausführlichsten in [[web:https://winraid.level1techs.com/t/guide-unlock-intel-flash-descriptor-read-write-access-permissions-for-spi-servicing/32449|der Win-RAID-Anleitung zum Entsperren des Descriptor-Zugriffs]], woher auch das oben Gesagte stammt. Siehe [[topic:provenance|Woher dieses Wissen stammt]].

Siehe auch: [[topic:bench-safety|Regeln am Arbeitsplatz]], [[term:flash-descriptor|Flash descriptor]].
