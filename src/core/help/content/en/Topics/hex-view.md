# Reading the Hex View

> Sixteen bytes to a row, the address on the left, the text on the right.

@covers menu.view.word-size
@covers settings.appearance
@covers settings.text-decoding

Each pane shows its file as a standard hex dump:

- **The offset column** on the left is the address of the first byte of the row, in hex and zero-based. On a dump read straight from a chip it is the position on that chip.
- **Sixteen byte values** per row, two uppercase hex digits each, in two groups of eight.
- **The decoded text** on the right. Bytes `0x20`–`0x7E` are shown as characters; everything else as a dot. Other encodings can be chosen in Settings.

## Things worth knowing

- **Everything is addressed from zero.** Offset `0x1000` is the 4097th byte of the file and, on a straight SPI read, the byte at address `0x1000` of the chip.
- **`0xFF` is the erased value.** Erased flash memory reads as `FF`; an area consisting of `FF` is an area that has not been written to. An area consisting of `00` has been written to with zeros, which is a different state.
- **Word size.** **View ▸ Word Size** groups the bytes in twos, fours or eights. Useful when reading a table of 32-bit values; it changes only how the bytes are spaced, never their order or their address.
- **Size.** The font, its size and the row height are in [[topic:settings|Settings ▸ Appearance]]. There is no zoom of the app's own: [[key:zoomIn]] and [[key:zoomOut]] are [[edition:the browser's page zoom||the window's page zoom]], which enlarges the whole workspace and is the right tool for a bench squinting at a laptop screen.

## The status bar

Under each pane: the caret's offset, the size of the selection if there is one, the file's size, and the piece of the file the caret is in if the pane has [[topic:segments|segments]]. A background job — a full comparison, a search, a firmware parse — reports here too, with a way to cancel it.

In a box at the right stands the typing mode: **OVR** for overwriting, **INS** for inserting. It is the one readout in the bar that a click acts on: clicking it flips the mode, and so does the **Insert** key ([[topic:editing|Editing Bytes]]).

See also: [[topic:colors|What the colours mean]], [[topic:navigation|Moving around]].
