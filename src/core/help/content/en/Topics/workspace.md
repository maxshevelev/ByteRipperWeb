# The Workspace

> With the switch on, the page opens what was open when it was left.

@covers settings.general.restore-workspace
@covers workspace.restore-warning

The switch is **Reopen the workspace at launch** in [[topic:settings|Settings ▸ General]]. It is off after installation: on a repair bench each job is a different board, and dumps from an earlier job opening by themselves would be in the way.

## Which workspace a page is

A workspace belongs to a [[edition:browser tab||window]]. [[edition:Reloading the page brings back that tab's own workspace. A new tab takes up the workspace that was left most recently and that no open tab holds: a tab closed by mistake is opened again from a new one. A second tab opened while the first is still open starts empty.||Opening the program again brings back the workspace of the window that was closed last.]]

## What is restored

- File A and File B, the active pane, and the position of the divider between them.
- In each pane, the address at the top of the screen, the caret and the selection, the hex or text column, and insert mode.
- The [[topic:bookmarks|bookmarks]], which are kept with the workspace in any case.
- The [[topic:segments|segments]]: cuts, names, and the links of segments to the files they were joined from — a link whose file cannot be reached again comes back as a segment with no link.
- The [[topic:notes|**Annotations** panel]], raised when it was up, with the cards that were selected.
- The [[topic:minimap|minimap]], the Find bar with its pattern, and the tool panel with the node or row selected in it and the open branches of its tree.
- The [[topic:fragments|fragment panels]], with the panel that was in front. A part is not stored as bytes: it is extracted from its file again, so it shows what the file holds now and can still be written back into it.
- **Documents never saved** — New File, a join, a duplicate, including one that has been given a name — with their bytes, still unsaved, and parts with changes not yet put back into their file, with those changes. They are kept beside the workspace while the page is open, so that a crash of the tab does not lose them either, and leaving the page does not ask about them.
- **Unsaved changes to files**, which come back red as they were, still unsaved. Only the changed bytes are kept, not a copy of the file. The changes are laid over the file again only when it is the file they were made on (see below). Leaving the page asks only about a change made in the last moments, before the workspace could write it down.

## What is not restored

- **The undo history.** It belongs to the session in which the edits were made.
- The Back / Forward history and the results of Search All.
- Settings such as the font, the word size and the pane layout. They are stored separately and apply in any case.

## When the workspace is written

Continuously: every few seconds while the [[edition:page||program]] is in front, and when it is left. Switching the setting off deletes every stored workspace.

The workspace is stored [[edition:in this browser, on this machine||in this installation, on this machine]], and does not leave it.

## Reaching the files again

[[edition:A page cannot open a file by itself. In a Chromium browser — Chrome, Edge, Opera — the workspace keeps the browser's reference to each file, and the files open by themselves where the browser still allows it; where it asks first, the empty window shows **Reopen the workspace** with the files' names, and one click opens them all. Firefox and Safari keep no such reference: a file opened there does not come back, and the message after the restore names it.||Each file is opened again by its full path.]]

## Files that changed or are missing

Each file is compared with its size and modification date at the time the workspace was written.

- A file that is no longer there is not opened.
- A file that has changed is opened. If it became shorter, the caret and the screen move to its last address. Its unsaved changes, its segments, its parts and what the tool panel had chosen in it are not restored: they were made on other bytes and would point to wrong places.

When either happens, or a file could not be reached, one message after the restore lists the files concerned.
