# What the Colours Mean

> Background says "different from the other file". Red text says "changed and not yet saved".

@covers settings.comparison

The two states are separate on purpose, and a byte can wear both at once.

## Difference — a background colour

In comparison mode, every byte that differs from the byte at the **same address** in the other file is given the difference background. Nothing else uses that background.

If one file is shorter, the bytes that only the longer file has are differences too, and the shorter file shows empty EOF cells in their place — a muted, distinct style, so a short read never looks like a file full of zeros.

## Unsaved change — red text

A byte you have edited but not yet saved is drawn in **red**. Save the file and the red goes away; the byte is now what the file holds.

This is the state to look at before handing a file to a programmer: red bytes are changes that exist only in ByteRipper.

## Both at once

A byte that is both different from the other file and edited by you shows **both**: the difference background, with red digits on it. That is the normal look of a patch in progress — you are editing the byte precisely because it differs.

## The other marks

- **Selection** is the standard highlight, and never hides the difference or the red.
- **Search matches** are filled in the platform's quiet "unfocused selection" grey; the match you are standing on is a raised yellow bubble. A match sitting on a difference reads as a difference — telling the two files apart wins.
- **A bookmarked row** turns its offset column into a coloured arrow with the address written on it. It marks the row, not the bytes, so it never disturbs the states above.
- **Zones** — the coloured outlines a [[topic:tools-overview|tool panel]] draws over the dump — mark a structure's byte range. A zone is an outline and a tint, not a background, so it can sit over differences without hiding them.

ByteRipper follows the system appearance, so all of this has a dark-mode form too. The palette is in [[topic:settings|Settings ▸ Appearance]].
