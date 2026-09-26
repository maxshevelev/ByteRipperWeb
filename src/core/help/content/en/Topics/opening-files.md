# Opening Files: A and B

> The workspace has two slots. One file is simply an editor; a second file adds the comparison. Editing works in both panes either way.

@covers shell.empty-state
@covers menu.file.new
@covers menu.file.open
@covers menu.file.compare-with
@covers menu.file.close
@covers shell.drop-zones

The workspace holds two file slots, **File A** and **File B**. Which slot a file lands in decides what happens:

- **One file open** — single-file mode. The workspace is a hex editor for that file, and all the editing, searching and firmware panels work normally.
- **Two files open** — comparison mode. The two dumps sit side by side (or one above the other, see **View ▸ Put the Panes Side by Side**) and every differing byte is painted.

File B is optional. Nothing needs a second file except the comparison itself.

## Ways to open a dump

- **The open button** on the empty screen, or **File ▸ Open…** in the toolbar's menu.
- **Drag and drop.** Drag a file onto the workspace and the drop bands show where it will land — into this pane, or beside it. Dropping two files at once fills both slots.
- **File ▸ Compare with…** opens a second dump into the empty slot, which is the comparison in one step.
- **File ▸ New** makes an empty untitled file — somewhere to paste bytes into.

## What the browser asks for, and asks for again

The app never uploads anything: a file you open is read inside this browser tab and the bytes stay on this machine.

What the browser gives in return is a *handle* to the file you picked, and that handle lives as long as the page does. So:

- **A reloaded page has no files.** Closing the tab, reloading it, or restoring it tomorrow all start from the empty screen, and the dumps have to be opened again.
- **Permission is asked once per file, per visit.** In a Chromium browser, writing back to a file you opened may ask for permission a second time — that is the browser's own question, not the app's.

! Keep your dumps in a folder you can find again. The app cannot reopen yesterday's file by itself, because a web page is never told where a file lives.

## One job per browser tab

There are no tabs inside the app and no second window: **one workspace is one browser tab**. That is how several boards are kept apart on one screen — open the app in another tab and it has its own pair of slots, its own bookmarks and its own undo.

## If the file is already open

Opening a file that is already in the other slot is allowed — comparing a file with itself is a legitimate thing to do while editing one copy of it. Opening it into the slot it is already in does nothing.

! Replacing a pane that has unsaved edits asks first. There is no undo for a discarded pane.

See also: [[topic:saving|Saving]], [[topic:join-duplicate|Joining and duplicating]], [[topic:large-files|Large dumps]].
