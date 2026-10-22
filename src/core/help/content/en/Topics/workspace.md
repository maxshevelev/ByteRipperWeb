# The Workspace

> With the switch on, ByteRipper opens at launch what was open when it was closed.

@covers settings.general.restore-workspace
@covers workspace.restore-warning

[[edition:**This page is about the Windows application.** A page in a browser cannot open a file again by itself, so the browser edition keeps no workspace: a reload starts from the empty window ([[topic:opening-files|Opening Files]]), and nothing below exists there.||]]

The switch is **Reopen the workspace at launch** in [[topic:settings|Settings ▸ General]]. It is off after installation: on a repair bench each job is a different board, and dumps from an earlier job opening by themselves would be in the way.

## Which workspace is reopened

The workspace is every window the program has open. Opening the program again brings back each window in its place and at its size, with the window that was in front in front again; what each window held comes back in it.

- **Quitting** — **File ▸ Exit**, or closing the last window — keeps every window as it is. Each window writes its last state before the program exits, and only work the workspace could not keep is asked about.
- **Closing a window while others stay open** removes it from the workspace, together with what it held; it asks first about every unsaved change in it.

## What is restored

- File A and File B, the active pane, and the position of the divider between them.
- In each pane, the address at the top of the screen, the caret and the selection, the hex or text column, and insert mode.
- The [[topic:bookmarks|bookmarks]], which are kept with the workspace in any case.
- The [[topic:segments|segments]]: cuts, names, and the links of segments to the files they were joined from — a link whose file cannot be reached again comes back as a segment with no link.
- The [[topic:notes|**Annotations** panel]], raised when it was up, with the cards that were selected.
- The [[topic:minimap|minimap]], the Find bar with its pattern, and the tool panel with the node or row selected in it and the open branches of its tree.
- The [[topic:fragments|fragment panels]], with the panel that was in front. A part is not stored as bytes: it is extracted from its file again, so it shows what the file holds now and can still be written back into it.
- **Documents never saved** — New File, a join, a duplicate, including one that has been given a name — with their bytes, still unsaved, and parts with changes not yet put back into their file, with those changes. They are kept beside the workspace while the program runs, so that an abnormal termination does not lose them either, and quitting does not ask about them.
- **Unsaved changes to files on disk**, which come back red as they were, still unsaved. Only the changed bytes are kept beside the workspace, not a copy of the file; like documents never saved, they survive an abnormal termination, and quitting does not ask about them. The changes are laid over the file again only when it is the file they were made on (see below).

## What is not restored

- **The undo history.** It belongs to the session in which the edits were made.
- The Back / Forward history and the results of Search All.
- Settings such as the font, the word size and the pane layout. They are stored separately and apply in any case.

## When the workspace is written

Continuously: every few seconds while the program is in front, when it is left, and once more by each window as the program quits. Switching the setting off deletes every stored workspace.

The workspace is stored in this installation, on this machine, and does not leave it.

## Reaching the files again

Each file is opened again by its full path.

## Files that changed or are missing

Each file is compared with its size and modification date at the time the workspace was written.

- A file that is no longer there is not opened.
- A file that has changed is opened. If it became shorter, the caret and the screen move to its last address. Its unsaved changes, its segments, its parts and what the tool panel had chosen in it are not restored: they were made on other bytes and would point to wrong places.

When either happens, or a file could not be reached, one message after the restore lists the files concerned.
