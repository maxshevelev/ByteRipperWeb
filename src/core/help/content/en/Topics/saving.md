# Saving

> Red text means the change exists only here. Save, and it is in the file — or, in some browsers, in a copy the browser downloads.

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

## What is unsaved

Bytes you have changed are drawn in **red** until they are saved, and the pane header says the document is modified. That pair is the check to run before handing a file to a programmer: no red left, and the header clean.

## When the file changes underneath you

The app notices when the file it opened has been replaced — by your programmer software re-reading the chip into the same path, for instance. A browser cannot watch a file, so the discovery happens when the app next touches it: it says so then, rather than silently writing over the new contents.

## Documents with no file

Some documents are deliberately untitled and have nowhere to be written back to, so ⌘S asks where to put them:

- **File ▸ New**.
- The result of a [[topic:join-duplicate|join]]: joining two dumps makes a *new* image, and an accidental ⌘S must not write it over one of the halves.
- The result of **Duplicate**.
- A part opened out of an image.

! Keep the original dump. Save your patched version under a new name — `board_patched.bin` beside `board_original.bin`. A dump you overwrote is a chip you have to read again, and on a board with a dead power rail that may not be possible twice.
