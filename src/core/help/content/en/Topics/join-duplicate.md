# Joining and Duplicating

> Joining the dumps of two chips into one image, and duplicating an image to edit the copy.

@covers menu.file.insert-at-start
@covers menu.file.append
@covers menu.file.duplicate

## Join: the dumps of two SPI chips into one image

On boards whose firmware is held in two SPI flash chips, both chips are read and the first file is opened. Then:

- **File ▸ Append File…** — the chosen file's bytes go after the pane's content.
- **File ▸ Insert File at Start…** — they go before it.

The whole of the firmware is then one image, which the comparison, the search and the [[topic:tool-uefi|UEFI panel]] — which expects one contiguous image — all operate on normally.

The boundary is recorded as a [[topic:segments|segment]] cut, so **Save All as Separate Files…** returns the two halves at exactly that boundary — into a folder you pick where the browser allows it, and as a ZIP where it does not.

Two properties of the result follow from this:

- **The joined document has no file of its own.** It is untitled, so [[key:save]] asks where to write it and cannot overwrite either half ([[topic:saving|Saving]]).
- **The join is one undo step.** [[key:undo]] removes the added bytes *and* re-attaches the pane to the file it was opened from.

## Duplicate: a copy of the dump as it was

**File ▸ Duplicate** copies the content of the pane into the free pane as a new unsaved document. It is available in single-file mode, where there is a free pane to copy into.

The copy is then edited while the original stays open beside it, and the comparison reports each edit as a difference as it is made. Either document can be saved.
