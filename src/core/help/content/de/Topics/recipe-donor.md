@source-sha 8cea7c0af68823bcaf98208751f7461bb2665138a07e2580b4de817fea0fffa1
# Einen Dump mit einem Spender reparieren

> Die übliche Arbeit: eine Platine, die nicht startet, ein beschädigter Dump und ein gutes Image von woanders.

Das Ziel ist fast nie, das Spender-Image komplett zu schreiben. Es ist, herauszufinden, **was kaputt ist**, und nur das hinüberzuholen.

1. **Lesen Sie den Chip des Patienten** und sichern Sie den Dump unberührt. Lesen Sie zweimal und vergleichen Sie die beiden Dumps miteinander — unterscheiden sie sich, ist das Lesen unzuverlässig (schlechter Kontakt, schwache Versorgung, eine noch teilweise versorgte Platine), und alles danach bedeutet nichts.
2. **Öffnen Sie Patient und Spender** nebeneinander ([[topic:first-comparison|Vergleich]]).
3. **Prüfen Sie die Größen** in den Statuszeilen. Verschiedene Größen heißen verschiedene Chips oder ein falsches Lesen — klären Sie das zuerst.
4. **Schalten Sie die [[topic:tool-uefi|UEFI-Struktur]]** für den Patienten ein. Der Baum sagt Ihnen, zu welcher Region jede Adresse gehört.
5. **Sehen Sie sich die Gestalt des Schadens** in der Übersicht der [[topic:minimap|Minimap]] an: unterscheidet sich ein Block oder unterscheidet sich das Image überall? Ein Block heißt meist eine beschädigte Region; überall heißt meist eine andere Firmware-Version, und das ist eine andere Arbeit.
6. **Bestimmen Sie die beschädigte Region.** Eine Region, die sich als lauter `FF` liest, wurde gelöscht. Eine Region voller Rauschen — oder eine, deren Strukturen das Panel nicht zerlegen kann — ist beschädigt. Die Übersichtszeile und der Baum sagen, welche.
7. **Holen Sie diese Region hinüber, nicht die ganze Datei.** Wählen Sie den Byte-Bereich der Region im Spender aus (die Offsets stehen in der Detailansicht des Panels; **Bearbeiten ▸ Block auswählen…** nimmt sie als Zahlen), kopieren Sie, wählen Sie dann denselben Bereich im Patienten und setzen Sie ein — mit schlichtem ⌘V, das **überschreibt** und nichts verschiebt.
8. **Holen Sie die eigenen Daten der Platine zurück.** Eine Spender-Region trägt die Identität des Spenders — siehe [[topic:recipe-board-data|Platinenspezifische Daten bewahren]]. Das ist der Schritt, den man vergisst, und der, der eine Platine ergibt, die startet, aber die falsche MAC-Adresse oder keine Seriennummer hat.
9. **Prüfen Sie vor dem Schreiben**: kein Rot mehr, die Dateigröße unverändert, die Prüfsummen stimmen, und ein letzter Vergleich mit dem ursprünglichen Dump zeigt nur Unterschiede, die Sie so wollten ([[topic:bench-safety|Regeln am Arbeitsplatz]]).

## Wenn doch das ganze Image ersetzt werden muss

Manchmal muss es: ein völlig zerstörter Flash oder eine Platine, deren Firmware-Version wechseln soll. Dann muss der Spender **dasselbe Modell und dieselbe Hardware-Revision** sein, und die platinenspezifischen Daten müssen in ihn verpflanzt werden, nicht umgekehrt.

! Prüfen Sie zuerst [[term:boot-guard|Boot Guard]]. Auf einer Platine mit gesetztem Boot Guard startet ein Image, das mit einem anderen Herstellerschlüssel signiert ist, nicht — was Sie sonst auch damit anstellen —, und die Zahl geschützter Bereiche im Panel ist Ihre Warnung.
