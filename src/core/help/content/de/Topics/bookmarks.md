@source-sha d5dd40f00b6c7613cf64af7e9ea0da9b6113df4bbf42ccb44f771cfb980078d1
# Lesezeichen

> Adressen, zu denen es sich zurückzukommen lohnt: auf der Zeile markiert und von beiden Bereichen geteilt.

**⌘D** markiert die Zeile, auf der die Einfügemarke steht (oder hebt die Markierung auf). Die Offset-Spalte dieser Zeile wird zu einem farbigen Pfeil mit der Adresse darauf, und die Zeile wird am Rand der [[topic:minimap|Minimap]] markiert. Sie stehen auch auf dem leeren Bildschirm, sodass ein Arbeitsbereich ohne offene Datei immer noch sagt, wo Sie zuletzt hingesehen haben.

- **⇧⌘D** gibt der Markierung einen Namen oder ändert den vorhandenen. Eine Markierung ohne Namen zeigt ihre Adresse.
- **⌘L** öffnet „Gehe zu“, und die untere Hälfte dieses Formulars ist die Lesezeichenliste: Tab bringt die Tastatur hinein, Return springt zum ausgewählten Lesezeichen.

## Was ein Lesezeichen markiert

Ein Lesezeichen markiert eine **Zeile**, kein Byte: die Adresse wird auf ein Vielfaches von 16 abgerundet, denn die Zeile ist der Ort, an dem die Markierung überhaupt zu sehen ist.

Ein Lesezeichen ist eine **absolute Adresse** und gehört zum Arbeitsbereich, nicht zu einer Datei. In einem Vergleich zeigen beide Bereiche dieselbe Markierung auf derselben Höhe — genau darum geht es: markieren Sie `0x1FE000`, und Sie sehen in beiden Dumps auf dieselbe Stelle.

Weil die Adresse absolut ist, verschiebt Einfügen oder Löschen von Bytes den Inhalt, aber nicht die Markierung. Brauchen Sie eine Markierung, die mit den Bytes wandert, ist das ein [[topic:segments|Segmentschnitt]], kein Lesezeichen.

Lesezeichen leben, solange der Arbeitsbereich lebt, nicht die Datei. Eine Datei zu schließen und wieder zu öffnen behält die Markierungen — und das ist der Fall, der zählt: dieselbe Untersuchung geht weiter.

Sie überleben auch die Seite selbst: die Marken liegen in diesem Browser, sodass ein Neuladen, das die offenen Dumps verliert, nicht verliert, wo Sie gerade hingesehen haben. Sie liegen **pro Browser und pro Rechner**, wie die übrigen Einstellungen, und das Löschen der Website-Daten löscht sie mit ([[topic:settings|Einstellungen]]).

## Am Arbeitsplatz

Markieren Sie vorab die Anfänge der Regionen, die Sie angehen — Descriptor, ME, BIOS, NVRAM, den Block, den Sie ändern wollen — und die ganze Arbeit wird zu ⌘L und Return statt zu getippten Adressen. Die Adressen nennt Ihnen ein Firmware-Panel: Knoten auswählen und Offset ablesen.
