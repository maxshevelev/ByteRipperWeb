# Saving

> Red marks a byte that differs from the file on disk. Saving writes those bytes to the file — or, in some browsers, to a copy the browser downloads.

@covers menu.file.save
@covers menu.file.save-as
@covers menu.file.revert
@covers menu.file.update-in-parent
@covers platform.save-capability

**What the button says is what will happen.** Where the app can write back into the file you opened it says **Save**; where it cannot it says **Download**, and the empty screen says which this browser does before you have opened anything at all.

- **Save** (⌘S) writes the pane's document back to the file it came from. Chromium-based browsers can do this.
- **Download** (⌘S) hands the edited dump to the browser's downloads instead. Firefox and Safari have no way to write into a file a page opened, so this is what saving means there — the file you opened is untouched, and the edited copy lands wherever your downloads go.
- **Save As… / Download As…** writes it somewhere new. After a Save As the pane follows the new file; after a Download As it does not, a download being a copy the page never sees again.
- **File ▸ Revert to Saved** throws your edits away and re-reads the file. For a pane whose bytes came from somewhere else — a part, a join — it is **Revert to Original** instead.
- **Update in Parent** is the third destination: for a [[topic:fragments|fragment panel]], it writes the part back into the image it came out of instead of to a file.

! A file dropped onto the window, or opened in a browser without the File System Access API, will be **downloaded** even where the app could otherwise save in place — there is no handle to write through. Open it through **File ▸ Open…** if you want Save rather than Download.

## If the file is not saved

Edited bytes are drawn in **red** until they are saved, and the pane header reports the document as modified. Both indications are cleared by saving.

## When the file changes underneath you

A browser cannot watch a file, so the app does not notice when the one it has open is changed on disk — by your programmer software re-reading the chip into the same path, for instance. The pane keeps the bytes it read at open time and does not pick up new content on its own. The only check is the save, and it is narrow: a file that has grown shorter is refused, since the missing bytes would otherwise be written back as zeros, while a rewrite to the same size — what a re-read into the same path produces — is not noticed, and the save writes the old bytes over the new ones. If you have re-read the chip, re-open the file before saving, so the pane holds what is actually on disk.

## Documents with no file

Some documents have neither a name nor a path by design, and ⌘S therefore asks where to write them:

- **File ▸ New File**.
- The result of a [[topic:join-duplicate|join]]: joining two dumps produces a *new* image, which ⌘S must not write over either half.
- The result of **Duplicate**.
- A part extracted from an image.

! **Save As…** writes the edited image to a new file and leaves the file it was read from unchanged. The original dump is not recoverable from the program once it has been overwritten.
