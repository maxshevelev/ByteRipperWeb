# Editing Bytes

> Typing overwrites the existing bytes. Every operation that changes the length of the file asks for confirmation first.

@covers menu.edit.undo
@covers menu.edit.redo
@covers menu.edit.copy
@covers menu.edit.paste
@covers menu.edit.paste-insert
@covers menu.edit.delete-bytes
@covers menu.edit.insert-mode
@covers menu.edit.fill
@covers menu.edit.copy-to-other-pane
@covers settings.editing

Hex digits are typed into the hex column and characters into the text column. Both edit the same bytes.

In the hex column the first digit entered replaces the high nibble and the second the low nibble, after which the caret advances. In the text column a printable character writes its byte, and anything outside ASCII is ignored.

## Overwriting is the default

Typing **overwrites**, and pasting with [[key:paste]] overwrites. No byte is moved, and every address in the file continues to denote what it denoted before.

This follows from the structure of a firmware image, in which an address is a position on the chip: a table points at `0x800000`, a signature covers a fixed range, a region boundary is recorded in the descriptor. A single byte inserted at the front invalidates all of them.

- **Delete and Backspace do not shorten the file.** They fill with `0x00`: Delete the byte at the caret, Backspace the byte before it. A selection is filled with `0x00` throughout.
- **Edit ▸ Fill Selection with…** fills the selection with a chosen byte. In flash memory that byte is usually `FF`, which is the erased value.

## Copying into the other pane

**Edit ▸ Copy to Other Pane** writes the selection of the active pane into the other pane, over the same addresses. It is copy and paste in one step, without the clipboard and without selecting the range a second time. It requires two open files and a selection. The same command is in the right-click menu over a selection; there it copies from the pane that was clicked, whether or not that pane is active. It has no shortcut here: [[edition:the ⌥⌘C it has in the macOS application is kept by every browser on a Mac for its own developer tools||the macOS application has ⌥⌘C for it, and this one assigns it no key]].

The copy overwrites, like [[key:paste]], and is one undo step in the file it was written into. After it the range is selected in that file. The step is undone there: the pane is made active and [[key:undo]] is pressed.

The command refuses, and writes nothing, when the selection runs past the end of the other file. It does not lengthen the other file.

## Operations that do change the length

Three operations do change it, and each asks for confirmation before acting:

- **Edit ▸ Delete Bytes…** — a real deletion, shifting everything after it.
- **Insert mode** — a typing mode in which keys insert and delete rather than overwrite, and [[key:paste]] pastes into the file rather than over it. The **OVR** / **INS** readout at the right of the pane's status line turns it on and off, and so does the **Insert** key; upstream has a menu item for it and the web does not, the status line being where the mode is already shown ([[topic:hex-view|Reading the Hex View]]). It asks once per file rather than per keystroke, reports itself in the status bar, and changes the shape of the caret.

The confirmations can be switched off in [[topic:settings|Settings ▸ Editing]], or with the "do not ask again" box in the dialog itself. They are enabled by default because these operations change every address after the point at which they act.

! The length of an SPI dump must not change, the capacity of the chip being fixed. See [[topic:bench-safety|Constraints on Editing an Image]].

## Undo

Every edit is one undo step ([[key:undo]]), including the large ones: a join, a fill, a write made by a [[topic:tools-overview|tool panel]], a fragment written back into its parent. Undo is held per document — the dump in front is what [[key:undo]] takes back, so an edit made inside a [[topic:fragments|fragment panel]] is undone in the fragment and not in the image behind it.
