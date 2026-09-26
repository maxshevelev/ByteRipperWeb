# Reading the Hex View

> Sixteen bytes to a row, the address on the left, the text on the right.

@covers menu.view.word-size
@covers menu.view.zoom
@covers settings.appearance
@covers settings.text-decoding

Each pane shows its file as a standard hex dump:

- **The offset column** on the left is the address of the first byte of the row, in hex and zero-based. This is the number that matters on a bench: it is the position on the chip.
- **Sixteen byte values** per row, two uppercase hex digits each, split into two groups of eight so the eye can count.
- **The decoded text** on the right. Bytes `0x20`–`0x7E` are shown as characters; everything else as a dot. Other encodings can be chosen in Settings.

## Things worth knowing

- **Everything is addressed from zero.** Offset `0x1000` is the 4097th byte of the file and, on a straight SPI read, the byte at address `0x1000` of the chip.
- **`0xFF` is empty.** Erased flash reads as `FF`. A screen full of `FF` is not corruption — it is a part of the chip nobody wrote to. A screen full of `00` usually is something: a zeroed region rather than an erased one.
- **Word size.** **View ▸ Word Size** groups the bytes in twos, fours or eights. Useful when reading a table of 32-bit values; it changes only how the bytes are spaced, never their order or their address.
- **Size.** The font, its size and the row height are in [[topic:settings|Settings ▸ Appearance]]. There is no zoom of the app's own: ⌘+ and ⌘− are the browser's page zoom, which enlarges the whole workspace and is the right tool for a bench squinting at a laptop screen.

## The status bar

Under each pane: the caret's offset, the size of the selection if there is one, the file's size, and the piece of the file the caret is in if the pane has [[topic:segments|segments]]. A background job — a full comparison, a search, a firmware parse — reports here too, with a way to cancel it.

See also: [[topic:colors|What the colours mean]], [[topic:navigation|Moving around]].
