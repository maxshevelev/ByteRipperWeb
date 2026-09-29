# What the Colours Mean

> An orange background says "different from the other file". Red text says "changed and not yet saved".

@covers settings.comparison

The two states are separate on purpose, and a byte can wear both at once.

## Difference — an orange background

In comparison mode, every byte that differs from the byte at the **same address** in the other file is painted **orange**: a translucent wash over the dump's own layers, which it therefore does not hide. Nothing else uses that background.

The dark appearance uses its darker variant, which is orange as well. The [[topic:minimap|minimap]] marks differences in the same colour.

If one file is shorter, the bytes that only the longer file has are differences too, and the shorter file shows empty EOF cells in their place — a muted, distinct style, so a short read never looks like a file full of zeros.

## Unsaved change — red text

A byte that has been edited but not yet saved is drawn in **red**. Once the file is saved the red is removed: the byte is then what the file holds.

Red bytes are changes that exist only inside ByteRipper and not in the file on disk.

## Both states at once

A byte that both differs from the other file and has been edited carries **both**: the orange background, with red digits over it. The two states are independent, and neither suppresses the other.

## The other marks

- **The selection** is the system's standard highlight, and never conceals the orange background or the red digits.
- **Search matches** are filled in the system's unfocused-selection grey; the current match is drawn as a raised yellow bubble. A match over a differing byte is displayed as a difference, the comparison taking precedence.
- **A bookmarked row** draws its address on a **purple** arrow, and the bookmark is marked in the minimap's margin in the same colour. It marks the row rather than the bytes, and does not affect the states above.
- **Zones**, with which a [[topic:tools-overview|tool]] marks a structure's byte range, are outlined in **blue** for the zone in focus and in **yellow** for the others. A zone is an outline and a tint, not a background, so it can sit over differences without hiding them.

ByteRipper follows the system appearance, so each of these colours has a dark form as well.
