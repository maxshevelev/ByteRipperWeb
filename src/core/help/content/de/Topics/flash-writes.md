@source-sha da47a0704f6662db8ddf503b7783a83aedd104e39eae086454cb9985f2aa9483
# Wer in den Flash schreibt

> Nur der Chipsatz hat Leitungen zum Chip. Alles auf der Platine, das den Flash lesen oder schreiben will, geht durch ihn, und wer was darf, steht im Descriptor.

Firmware kommt bauartbedingt auf einem Weg in den Chip: über den Chipsatz. Der einzige SPI-Controller der Platine sitzt im [[term:pch|Chipsatz]], also kommen die Firmware auf der CPU, ein Flash-Werkzeug, die [[term:me|Management Engine]] und der Netzwerk-Controller nur über ihn an den Chip — und er prüft ihre Rechte am Descriptor, bevor er gehorcht.

Ein [[term:programmer|Programmiergerät]] spricht die Anschlüsse des Bausteins unmittelbar an und geht am Chipsatz vorbei. Die Rechte aus dem Descriptor greifen dabei nicht: Durchgesetzt werden sie vom Chipsatz, der in diesem Weg nicht vorkommt.

! Eine von Hand in einen geschützten Bereich des Images eingebrachte Änderung wird ohne Fehlermeldung geschrieben und beim Start der Platine zurückgewiesen. Welche Bereiche geschützt sind und wodurch, steht in den Abschnitten unten.

## Die Platine schreibt ständig in ihren eigenen Flash

Und nicht nur, wenn jemand die Firmware aktualisiert:

- Wird eine Einstellung im Setup geändert und mit F10 gesichert, schreibt die Firmware den [[term:vss|NVRAM]]-Speicher zurück in die [[term:bios-region|BIOS-Region]].
- Die Management Engine schreibt ihre eigene [[term:mfs|MFS]]: Konfiguration, Zähler, Zustand.
- Ein Update-Werkzeug des Herstellers oder Intels FPT (Flash Programming Tool) schreibt aus dem laufenden System eine ganze Region neu.

Ein heute gelesener Chip und die Datei, die gestern hineingeschrieben wurde, stimmen deshalb nicht überein, auch wenn niemand die Platine absichtlich angefasst hat: NVRAM und MFS haben sich von selbst bewegt. Das ist das Erste, was zu vermuten ist, wenn ein Vergleich Unterschiede zeigt, für die es keine Erklärung gibt.

## Was der Descriptor entscheidet

Der [[term:flash-descriptor|Descriptor]] nennt vier [[term:flash-master|Master]] — BIOS, ME, GbE und EC — und gibt jedem eine Lese- und eine Schreibmaske über die [[term:region|Regionen]]. Ein Flash-Werkzeug, das auf der CPU läuft, *ist* der BIOS-Master. Wo der Descriptor diesem Master kein Schreibrecht auf eine Region gibt, weist der Chipsatz den Schreibvorgang ab, und Wiederholen ändert daran nichts.

! Lesen ist genauso geregelt, und das trifft am härtesten. Eine Region, die der BIOS-Master nicht lesen darf, lässt sich aus dem laufenden System überhaupt nicht auslesen. Manche Programme verweigern das Lesen des ganzen Chips, andere füllen das Ungelesene mit `FF` und geben eine Warnung aus. `FF` in einem im System erstellten Dump kann also „durfte nicht gelesen werden“ heißen statt „gelöscht“ — und der Vergleich zeigt dann eine ganze Region als einen riesigen Unterschied, den es gar nicht gibt. Ein Dump vom Programmer hat solche Löcher nicht. So ist es bei flashrom dokumentiert: standardmäßig verweigert es das Lesen und füllt nur dann mit `FF`, wenn man ihm sagt, es solle die Fehler übergehen ([[web:https://flashrom.org/classic_cli_manpage.html|die Manualseite von flashrom]]).

## Schreiben heißt nicht Ausführen

Die Masken entscheiden nur eines: ob über den Chipsatz geschrieben werden darf. Ob das Geschriebene dann läuft, ist eine andere Frage, und sie wird beim Start beantwortet, von Prüfungen, die mit dem Descriptor nichts zu tun haben:

- **Der frühe Teil der BIOS-Region.** [[term:boot-guard|Boot Guard]] prüft den [[term:ibb|IBB]] — den SEC- und PEI-Code —, bevor der Prozessor ihn ausführt: Das [[term:acm|ACM]], gestartet vom Mikrocode des Prozessors, vergleicht die Hashes des Blocks mit denen in den Boot-Guard-Manifesten, und der Hash des Wurzelschlüssels liegt in den [[term:otp|Fuses]] des Chipsatzes. Ein geändertes Byte im IBB ändert den Hash, und der Block besteht die Prüfung nicht.
- **Der übrige Teil der BIOS-Region.** Was hinter dem IBB liegt, ist der [[term:ibb|OBB]], und ihn prüft die Firmware selbst, mit Code des Platinenherstellers. Ob ein bestimmter Hersteller das tut und wie gründlich, ist dessen Entscheidung — deshalb wird dieselbe Art von Änderung im einen Teil eines Images zurückgewiesen und geht im anderen durch.
- **Die ME-Region** prüft die Engine selbst, während sie hochkommt; siehe [[topic:recipe-me-check|Den ME-Bericht lesen]].

Eine Änderung in einem geschützten Bereich wird deshalb erfolgreich geschrieben und wirkt dennoch nicht: Schreiben und die Prüfung beim Start sind verschiedene Mechanismen, und die Erlaubnis für das eine sagt nichts über das andere.

Die Bereiche, die diese Prüfungen nicht abdecken — der NVRAM-Speicher, der [[term:dmi|DMI]]-Bereich, die [[term:ec|EC]]-Firmware und oft auch die DXE-Treiber —, wirken, sobald sie geschrieben sind.

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

Damit liest oder überschreibt eine Service-Prozedur eine gesperrte Region mit einem Werkzeug, ohne den Chip von der Platine zu nehmen. Ein öffentliches Datenblatt beschreibt das nicht: es steht in Intels Plattform-Leitfäden für Hersteller, und in der Reparaturpraxis ist es aus den Anleitungen der Community bekannt — am ausführlichsten in [[web:https://winraid.level1techs.com/t/guide-unlock-intel-flash-descriptor-read-write-access-permissions-for-spi-servicing/32449|der Win-RAID-Anleitung zum Entsperren des Descriptor-Zugriffs]], woher auch das oben Gesagte stammt. Siehe [[topic:provenance|Woher dieses Wissen stammt]].

Siehe auch: [[topic:bench-safety|Einschränkungen beim Bearbeiten eines Images]], [[term:flash-descriptor|Flash descriptor]].
