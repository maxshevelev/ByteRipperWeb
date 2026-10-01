# Opening Files: One Pane or Two

> The workspace holds two file panes. One file is simply an editor; a second file adds the comparison. Editing works in both panes either way.

@covers shell.empty-state
@covers menu.file.new
@covers menu.file.open
@covers menu.file.compare-with
@covers menu.file.close
@covers shell.drop-zones

The workspace holds two file panes. How many of them hold a file decides what the workspace is:

- **One file open** — single-file mode. The workspace is a hex editor for that file, and all the editing, searching and tool panels work normally.
- **Two files open** — comparison mode. The two dumps sit side by side (or one above the other, see **View ▸ Put the Panes Side by Side**) and every differing byte is painted.

The second pane is optional. Nothing needs a second file except the comparison itself.

## Ways to open a dump

- **The open button** on the empty screen, or **File ▸ Open…** in the toolbar's menu. With both panes empty the first two files you pick fill them; with one pane free the file goes there; with both full it replaces the **active** pane. Anything selected beyond that is not opened.
- **Drag and drop.** Drag a file onto the workspace and the drop bands show where it will land — into this pane, or beside it. Drop two files at once and the second opens in the other pane, if that pane is free.
- **File ▸ Compare with…** opens a second dump into the empty pane, which is the comparison in one step.
- **File ▸ New File** makes an empty untitled file — somewhere to paste bytes into.

## How long the tab keeps a file

Nothing is uploaded: a file you open is read inside this browser tab, and its bytes stay on this machine. In return, the tab holds a *reference* to the file, and the reference lives only while the page is open. Two things follow:

- **A reload forgets every file.** Closing the tab, reloading it, or coming back tomorrow all start from the empty screen, and the dumps must be opened again.
- **Permission is asked once per file, per page.** The browser asks to read a file once while the page is open and does not ask about it again until the page reloads. In a Chromium browser, saving back to a file may ask a second time — that is the browser's own prompt, not the app's.

! Keep your dumps in a folder you can find again. A web page is never told where a file is, so the app cannot reopen one of yesterday's.

## One job per browser tab

There are no tabs inside the app and no second window: **one workspace is one browser tab**. That is how several boards are kept apart on one screen — open the app in another tab and it has its own pair of panes, its own bookmarks and its own undo: BIOS dumps compared in one tab, EC dumps in the next.

Each pane header names its file and whether it has unsaved changes; the status line below it gives the size. The ✕ in the header closes that pane and leaves the other one open.

## If the file is already open

Nothing is refused here — a tab cannot tell whether a file is open elsewhere:

- **In the other pane** — allowed, and useful: the two panes are two documents over one file, so you can edit one of them and watch the comparison against the other. Your own edits show in red anyway; and when two copies side by side are what you want, **File ▸ Duplicate** makes one in the other pane.
- **In another browser tab** — that tab is a workspace of its own and this one cannot see it. The file simply opens here as well, and the two know nothing about each other; whichever saves last is what the file holds.
- **In this very pane** — it re-reads the file, which is how a dump is picked up again after a programmer has rewritten it.

! Replacing the file in a pane that holds unsaved edits asks for confirmation, whether the file arrives by a drop or through **Open…**. A discarded pane cannot be restored.

See also: [[topic:saving|Saving]], [[topic:join-duplicate|Joining and Duplicating]], [[topic:large-files|Large Dumps]].
