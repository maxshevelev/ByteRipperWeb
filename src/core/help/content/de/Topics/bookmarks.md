@source-sha 72ab58abbdfaa1c33a2bd94d77539e2bf6dd7f0031ff4d1364f7bd935b72ba75
# Lesezeichen

> Markierte Adressen, zu denen schnell zurückgekehrt werden kann: auf der Zeile angezeigt und beiden Bereichen gemeinsam.

**[[key:bookmark]]** setzt ein Lesezeichen auf der Zeile, auf der die Einfügemarke steht, oder entfernt ein vorhandenes. Die Adresse dieser Zeile wird dann auf einem violetten Pfeil dargestellt, und die Zeile wird in derselben Farbe am Rand der [[topic:minimap|Minimap]] markiert. Lesezeichen stehen auch auf dem leeren Bildschirm, sodass ein Arbeitsbereich ohne offene Datei weiterhin nennt, was zuletzt betrachtet wurde.

- **[[key:editBookmark]]** gibt dem Lesezeichen einen Namen oder ändert den vorhandenen. Ein Lesezeichen ohne Namen zeigt seine Adresse.
- **[[key:goTo]]** öffnet „Gehe zu“, und die untere Hälfte dieses Formulars ist die Lesezeichenliste: Tab bringt die Tastatur hinein, Return springt zum ausgewählten Lesezeichen.

## Was ein Lesezeichen markiert

Ein Lesezeichen markiert eine **Zeile**, kein Byte: Die Adresse wird auf ein Vielfaches von 16 abgerundet, da die Zeile die Einheit ist, auf der die Markierung sichtbar ist.

Ein Lesezeichen hält eine **absolute Adresse** und gehört zum Arbeitsbereich, nicht zu einer Datei. In einem Vergleich zeigen beide Bereiche dasselbe Lesezeichen auf derselben Höhe, sodass `0x1FE000` in beiden Dumps auf dieselbe Stelle verweist.

Weil die Adresse absolut ist, verschiebt das Einfügen oder Löschen von Bytes den Inhalt, nicht aber das Lesezeichen. Anders als ein Lesezeichen ist ein [[topic:segments|Segmentschnitt]] eine Markierung, die mit den Bytes wandert, wenn sich Daten in der Datei verschieben.

Lesezeichen bestehen, solange der Arbeitsbereich besteht, nicht die Datei: Eine Datei zu schließen und wieder zu öffnen behält sie.

Sie überleben auch die Seite selbst: die Lesezeichen liegen in diesem Browser, sodass ein Neuladen, das die offenen Dumps verliert, nicht verliert, wo Sie gesucht haben. Sie liegen **pro Browser und pro Rechner**, wie die übrigen Einstellungen, und das Löschen der Website-Daten löscht sie ([[topic:settings|Einstellungen]]).

Welche Adressen sich zu markieren lohnen, nennen die Werkzeuge: Wird ein Knoten ausgewählt, steht seine Adresse in der Detailliste ([[topic:tools-overview|Die Werkzeugbereiche]]).
