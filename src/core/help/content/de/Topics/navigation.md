@source-sha 6b2e17d3b9b69adc1b83b5c31b7acd3950344c0151faf5c5906911f15294025c
# Sich bewegen

> Zwischen Unterschieden springen, zu einer Adresse springen oder auf einem Byte stehen und ablesen, wo man ist.

**Zu den Tasten unten.** ⌘ ist die Command-Taste auf dem Mac und die Control-Taste unter Windows und Linux; ⌥ ist Option, also Alt. Das Programm nimmt diese Tasten vor dem Browser, sodass ⌘F die Suche dieses Programms ist und nicht die Suchleiste des Browsers.

## Zwischen Unterschieden

- **⌥⌘→** — nächster Unterschied, **⌥⌘←** — vorheriger.
- **⇧⌥⌘→ / ⇧⌥⌘←** — nächster / vorheriger **gleicher** Block: der Anfang der nächsten Strecke, auf der die Dateien übereinstimmen. Nützlich, wenn sich fast das ganze Image unterscheidet und man die Inseln sucht, die passen.

Ein „Unterschied“ ist beim Springen eine ganze Folge abweichender Bytes, nicht jedes einzelne: ein abweichender 4-KB-Block ist eine Station, nicht viertausend.

## Zu einer Adresse

**⌘L** öffnet „Gehe zu“. Geben Sie eine Adresse ein und drücken Sie Return:

- `0x1FE00` — hexadezimal, mit dem Präfix `0x` (es steht schon im Feld).
- `130560` — dezimal, ohne Präfix.

Das Feld behält die zuletzt eingegebenen zehn Adressen: der Pfeil am rechten Rand des Feldes, oder ↓, klappt die Liste auf, und eine Auswahl füllt das Feld — der Sprung bleibt ein Return. Darunter liegt die [[topic:bookmarks|Lesezeichenliste]]: Tab bringt die Tastatur dorthin, Return springt zum ausgewählten Lesezeichen.

Im Vergleichsmodus bewegt der Sprung **beide** Bereiche, die an dieselbe Adresse gebunden sind.

## Einen Block auswählen

**Block ab hier auswählen, bei…** im Kontextmenü des Bereichs wählt einen Bereich über Zahlen statt über die Maus: Anfang und Ende oder Anfang und Länge. Der Punkt nennt die Adresse unter dem Zeiger, und der Dialog öffnet sich mit ihr als Anfang. Beide Felder nehmen Hexadezimalwerte mit dem Präfix `0x` und schlichtes Dezimal entgegen. Der Befehl dient der Auswahl von Hand, wenn Anfang, Ende oder Länge eines Bereichs bekannt oder errechnet sind.

! **Ende** ist die Adresse des letzten Bytes der Auswahl und nicht die des ersten Bytes dahinter. Ein Anfang `0x1000` mit einem Ende `0x1FFF` wählt daher genau `0x1000` Bytes aus.

## Den anderen Bereich mitführen

Die beiden Bereiche sind in Scrollposition, Einfügemarke und Auswahl miteinander gekoppelt. **Darstellung ▸ Bereiche tauschen** tauscht die Dateien zwischen den Bereichen.

## Alles größer machen

Einen eigenen Zoom hat das Programm nicht: **der Seitenzoom des Browsers ist der Zoom** (⌘+ und ⌘−, ⌘0 zurück). Die Schrift des Dumps und ihre Größe sind stattdessen eine Einstellung — siehe [[topic:settings|Einstellungen]].

Siehe auch: [[topic:minimap|Die Minimap]] — Bewegung mit dem Zeiger statt über Adressen.
