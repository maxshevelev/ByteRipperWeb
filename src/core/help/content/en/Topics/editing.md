# Editing Bytes

> Type over what is there. Anything that changes the file's length asks first.

@covers menu.edit.undo
@covers menu.edit.redo
@covers menu.edit.copy
@covers menu.edit.paste
@covers menu.edit.paste-insert
@covers menu.edit.delete-bytes
@covers menu.edit.insert-mode
@covers menu.edit.fill
@covers settings.editing

Click into the hex column and type hex digits; click into the text column and type characters. Both edit the same bytes.

In hex, the first digit you type changes the high nibble and the second the low one, then the caret moves on. In the text column a printable character writes its byte; anything that is not ASCII is ignored.

## Overwrite is the default, and that is deliberate

Typing **overwrites**. Pasting (⌘V) overwrites. Nothing shifts, nothing moves, and every address in the file means what it meant before.

That is the right default for a dump. In a firmware image an address is a position on the chip: a table points at `0x800000`, a signature covers a fixed range, a region boundary is written in the descriptor. Insert one byte at the front and every one of those becomes wrong.

- **Delete and Backspace do not shorten the file.** They fill with `0x00` — Delete the byte at the caret, Backspace the one before it. A selection is filled with `0x00`.
- **Edit ▸ Fill Selection with…** fills the selection with a byte you choose. `FF` is the one you usually want on flash: it is what erased means.

## Operations that do change the length

These exist, and each one asks before it acts:

- **Edit ▸ Paste Insert…** — paste, shifting everything after it.
- **Edit ▸ Delete Bytes…** — a real deletion, shifting everything after it.
- **Insert mode** — a typing mode where keys insert and delete instead of overwriting. The **OVR** box at the right of the pane's status line turns it on and off, and so does the **Insert** key; upstream has a menu item for it and the web does not, the status line being where the mode is already shown. It asks once per file rather than per keystroke, says INS in the status line, and changes the shape of the caret.

The confirmations can be switched off in [[topic:settings|Settings ▸ Editing]] or with the "do not ask again" box on the dialog itself. They are on by default because these are exactly the edits that quietly ruin a structured dump.

! On an SPI dump destined for a programmer, the file's length must not change. The chip's capacity is fixed. If you are about to insert or delete bytes in a flash image, stop and use overwrite and fill instead — see [[topic:bench-safety|Bench rules]].

## Undo

Every edit is an undo step (⌘Z), including the big ones: a join, a fill, a write made by a [[topic:tools-overview|tool panel]], a part put back into its parent. Undo is per document — the dump in front is what ⌘Z takes back, so an edit made inside a [[topic:fragments|fragment panel]] is undone in the part and not in the image behind it.
