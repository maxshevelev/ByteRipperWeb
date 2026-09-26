# Joining and Duplicating

> The dumps of two chips into one image, and a before-copy to patch against.

@covers menu.file.insert-at-start
@covers menu.file.append
@covers menu.file.duplicate

## Join: the dumps of two SPI chips into one image

Plenty of boards split the BIOS across two SPI flash chips. Read both, then:

- **File ▸ Append File…** — the chosen file's bytes go after the pane's content.
- **File ▸ Insert File at Start…** — they go before it.

Now the whole BIOS is one image, and everything works on it normally: the comparison, the search, the [[topic:tool-uefi|UEFI panel]] that expects one contiguous image.

The seam is recorded as a [[topic:segments|segment]] cut, so **Save All as Separate Files…** gives you the two halves back at the same boundary, ready to flash to their own chips — into a folder you pick where the browser allows it, and as a ZIP where it does not.

Two things follow that are worth knowing:

- **The joined document has no file.** It is untitled, so ⌘S asks where to put it and cannot overwrite either half by accident ([[topic:saving|Saving]]).
- **The join is one undo step.** ⌘Z removes the added bytes *and* re-attaches the pane to the file it was opened from.

## Duplicate: a copy of the dump as it was

**File ▸ Duplicate** copies the pane's content into the free pane as a new unsaved document. Available in single-file mode, where there is a free pane to copy into.

This is the fastest way to patch with a safety net: duplicate, edit the copy, and watch the differences appear beside the original as you type. When you are done, save whichever side is right.
