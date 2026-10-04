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

- **The open button** on the empty screen, or **File ▸ Open…** [[edition:in the toolbar's menu||in the menu]]. The file replaces the **active** pane; it never adds a second pane by itself. Only with both panes empty do the first two files you pick fill them. Anything selected beyond that is not opened.
- **Drag and drop.** Drag a file onto the workspace and the drop bands show where it will land — into this pane, or beside it. Drop two files at once and the second opens in the other pane, if that pane is free.
- **File ▸ Compare with…** opens the file in the other pane: the free one, or otherwise the one that is not active. This is how a second file is added for comparison. It is available while a file is open.
- **File ▸ New File** makes an empty untitled file — somewhere to paste bytes into.

## How long the [[edition:tab||window]] keeps a file

Nothing is uploaded: a file you open is read inside [[edition:this browser tab||this window]], and its bytes stay on this machine. In return, [[edition:the tab holds a *reference* to the file, and the reference lives only while the page is open||the window holds a *reference* to the file, and the reference lives only while the window is open]]. Two things follow:

- **A reload forgets every file.** [[edition:Closing the tab, reloading it, or coming back tomorrow all start from the empty screen, and the dumps must be opened again.||Closing the window, reloading it, or coming back tomorrow all start from the empty screen; **File ▸ Open Recent** keeps the last ten files you opened, most recent first, and picking one from the list opens the file again.]]
- [[edition:**Permission is asked once per file, per page.** The browser asks to read a file once while the page is open and does not ask about it again until the page reloads. In a Chromium browser, saving back to a file may ask a second time — that is the browser's own prompt, not the app's.||**Permission is asked once per file.** The window asks to read a file once, and a file that **File ▸ Open Recent** reopens is read with the grant it was given, asking again only where that grant is no longer kept.]]

[[edition:! Keep your dumps in a folder you can find again. A web page is never told where a file is, so the app cannot reopen one of yesterday's.||! The list keeps ten files, most recent first: a dump is in it while it is one of the last ten opened and its file has not been moved or deleted.]]

## One job per [[edition:browser tab||window]]

There are no tabs inside the app[[edition: and no second window||]]: **one workspace is one [[edition:browser tab||window]]**. That is how several boards are kept apart on one screen — [[edition:open the app in another tab and it has its own pair of panes, its own bookmarks and its own undo: BIOS dumps compared in one tab, EC dumps in the next.||open the application a second time and it has its own pair of panes, its own bookmarks and its own undo: BIOS dumps compared in one window, EC dumps in the other.]]

Each pane header names its file and whether it has unsaved changes; the status line below it gives the size. The ✕ in the header closes that pane and leaves the other one open.

## If the file is already open

Nothing is refused here — a tab cannot tell whether a file is open elsewhere:

- **In the other pane** — allowed, and useful: the two panes are two documents over one file, so you can edit one of them and watch the comparison against the other. Your own edits show in red anyway; and when two copies side by side are what you want, **File ▸ Duplicate** makes one in the other pane.
- **In another browser tab** — that tab is a workspace of its own and this one cannot see it. The file simply opens here as well, and the two know nothing about each other; whichever saves last is what the file holds.
- **In this very pane** — it re-reads the file, which is how a dump is picked up again after a programmer has rewritten it.

! Replacing the file in a pane that holds unsaved edits asks for confirmation, whether the file arrives by a drop or through **Open…**. A discarded pane cannot be restored.

See also: [[topic:saving|Saving]], [[topic:join-duplicate|Joining and Duplicating]], [[topic:large-files|Large Dumps]].
