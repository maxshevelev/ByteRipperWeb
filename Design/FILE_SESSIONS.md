# File sessions outside the windows

> The owner's decision of 2026-10-22: a file session — the file, the changes
> made to it, their undo history — is the model, and the model does not know
> where it is shown. A window shows a session; moving a pane to another window
> shows the same session there. Nothing is carried, rebuilt or forgotten on
> the way.

## Why

In the desktop shell every window is a page of its own (`DESKTOP_WINDOWS.md`,
"a window is a page"), and each page held its documents in its own memory. A
pane moving to another window was therefore the model taken apart in one page
and built again in the other, from a parcel the transfer code assembled piece
by piece: the record of the pane, the unsaved changes, later the history. The
parcel listed what a session is, so a piece left off the list was lost — the
undo history was, until `141a46f` added it to the list. The list is the
defect: a window must not need to know what a session consists of.

Upstream has one process, so its `PaneViewModel` moves between windows as an
object and the question never arises. The web edition gets the same property
by putting the sessions where every window of the app reaches the same object:
**a `SharedWorker`, the session host**.

## The boundary

| Lives in the host (the model) | Lives in the window (the view) |
|---|---|
| The file it was opened from: its handle, its path, its `File` | Which session a pane shows, and the pane's place in the window |
| The storage: the file's bytes and the overlay of changes (`EditOverlayStorage`, piece table) | The canvas, the glyph atlas, the chunk cache of bytes on screen |
| The undo history, its journal, its bounds | The scroll position, the row on top |
| The selection and the caret — the history restores them, so they are the document's, as upstream's `BinaryDocument.selection` is | The half-typed nibble, insert mode, the input region (`TypingController`) |
| The segments (cuts, names, links) and their own history | The minimap's picture, the find bar, the tool panel |
| The undo router's acts for the session — the order of edits and cuts | Menus, dialogs, the operation strip |
| Kept content: the base and log beside the workspace (`ContentKeeper`) | The workspace record of the window: which panes show which sessions |
| The session's id, for the agent and for every window | |

A window holds a `SessionView`: a mirror of the session's state that the host
keeps current (size, dirty, can undo / redo and their labels, selection,
content generation, segments), so the ~150 places that read those synchronously
today read the mirror, and every change goes to the host as a request. The
host applies requests one at a time per session, in the order they arrive, and
answers each with the new state — so a window that sent an edit sees its effect
before it sends the next.

## The host

- **One `SharedWorker`** per origin and profile, and one for both editions: in
  the shell every window of the app connects to it, in the browser every tab
  and window of the origin does. It lives while any of them is connected.
- **One workspace, every window seeing every session.** A browser tab is a
  window of the app as a shell window is: the host's sessions are the same
  sessions whichever tab or window shows them, and a file is open once in the
  app — the host's rule, replacing the main process's registry (D4) and giving
  the browser the same rule. A session no window shows any more is closed,
  after the question about its unsaved changes, as a closed pane's is today.
  This ends CLAUDE.md's "one workspace per browser tab": a pane can move
  between two tabs as it moves between two shell windows.
- **Byte reads** answer with chunks; the view keeps its own chunk cache keyed
  by the session's content generation, and a change event names the stretch it
  invalidates, as `DocumentContentChange` does today.
- **Workers** — diff, search, minimap, firmware — are handed what they are
  handed now, a `Blob` of the content, which the host makes from the session.
  Nothing in them changes.
- **The journal** stays in OPFS, in the files and format it has. Chromium gives
  a `SharedWorker` neither a nested `Worker` nor a sync access handle (S0), so
  the journal worker is **lent**: a window creates it and hands its port to
  the host, the host uses one at a time, and when the lending window goes the
  host borrows another from a window still connected. The sync handles are
  released with the lender and reopen in the new one with the file intact.
  Writes the lender has not answered are written again — the rule
  `UndoJournal` already keeps, a run answered from memory until its write
  lands. The lender holds a Web Lock, so the host learns it is gone without
  waiting for a request to go unanswered. Safari gives the `SharedWorker` sync
  handles itself, so there the host keeps the journal and borrows nothing.
- **The shell** reaches the host through a `MessageChannelMain`: the main
  process hands a port to a window's preload, the page passes it on, and it
  outlives that window (S0). A worker has no preload, so the host asks the
  shell — a project's `Kept/`, hashing by path, the agent — over that port, not
  through a window.
- **Saving** goes through the host, which holds the file's handle: a
  `FileSystemFileHandle` writes from a worker. The download path of Firefox
  and Safari needs a page, so there the host hands the window a `Blob` to
  download, as `fileSink.ts` does now.
- **The keeper** runs in the host: kept content is a property of the session,
  written beside the workspace whatever window shows it. A window's record names
  sessions by id; the host writes their content.
- **The agent** asks the host for documents and runs tools against sessions,
  bringing forward the window that shows one (D7d's routing by window goes).

## Pane transfer, after

Moving a pane to another window: the source window stops showing session *S*,
the target window starts showing *S*, and the host is told which window shows
it. No parcel, no `paneParcel`, no `carriedHistory`, no `adoptMoved*`: the
session never left the host. Open in New Window, a drag to another window, a
file opened where it is already open, a fragment panel carried between windows
— all the same act.

## What a page keeps, and what goes

Goes from the page: `BinaryDocument` and its storage as objects, `undoHistory`,
the journal store provider, `segmentsStore`'s partitions, `undoRouter`'s acts,
the keeper and writer, `paneParcel` / `carriedHistory` / the D5 parcels'
edits, the main process's file registry (D4).

Stays: everything that draws or asks — `HexPane`, the renderers,
`TypingController` (driving a `SessionView` instead of a `BinaryDocument`),
the tools' panels, the stores of view state.

`src/core` does not change in kind: `BinaryDocument`, `UndoHistory`, the
storage and the history log are the same pure classes, now constructed in the
host. What is new in core is the protocol — requests, answers, change events —
and the mirror, both pure and unit-tested.

## Steps

Each step ends with `npm run check` green, the desktop tests green, and the
shell and a browser driven through what the step changed.

- [x] **S0 — the ground.** A `SharedWorker` reached by two `BrowserWindow`s of
  the shell (and two tabs of a browser), one object seen by both; nested
  dedicated worker with an OPFS sync access handle inside it; a
  `FileSystemFileHandle` writing from it; Firefox and Safari's `SharedWorker`.
  Measured, not assumed: a keystroke's round trip, a page of hex rows read
  through the host. A failing answer here changes the plan before code moves.
  The probe is `Design/probes/session-host/`; what it answered is "S0, measured"
  below. One answer did change the plan: the journal is lent, not nested.

## S0, measured

Electron 44.5 (Chromium 152) with two windows under the app's privileges and
sandbox; the Chromium of the desktop app's pane with two tabs; Safari 27.0.1
with two tabs. Firefox is not installed on the bench and was not run.

| | Electron | Chromium tabs | Safari tabs |
|---|---|---|---|
| One host, one object, for both windows / tabs | yes | yes | yes |
| Round trip of a request, median / p99 | ≤ 0.1 / 0.1 ms | 0.1 / 0.2 ms | < 1 / 1 ms ¹ |
| An edit request answered with the new state, p99 | 0.2 ms | — | 1 ms ¹ |
| 64 KiB of bytes read from the host, p99 | 0.2 ms | — | 1 ms ¹ |
| A nested `Worker` in the `SharedWorker` | **no** | **no** | **no** |
| An OPFS sync access handle in the `SharedWorker` | **no** | **no** | yes |
| Async OPFS writes in the `SharedWorker` | yes | yes | yes |
| — reopening a file to append 4 KiB, at 4 / 64 MiB | 11 / 95 ms ² | — | 10 / 41 ms ² |
| — a 4 KiB record written as a file of its own | 2.7 ms | — | 4–6 ms |
| A `FileSystemFileHandle` passed to the host writes | yes ³ | yes ³ | no ⁴ |
| A journal worker lent by a window, sync handle open | yes | — | — |
| — after the lending window closed: reopened by another | 3 ms, file intact | — | — |
| A port from the main process, after its window closed | yes | n/a | n/a |

¹ Safari's clock has a 1 ms grain. ² The writable is a copy of the whole file,
so an append costs the file's size: a journal cannot be appended this way.
³ An OPFS handle, permission `granted`; a handle from a picker is not checked
here and S6 checks it. ⁴ Not cloneable — Safari saves through a download
anyway, and a `File` is.

A keystroke's round trip is two orders below a frame; reads at this cost leave
the renderer's chunk cache as it is.
- [ ] **S1 — the protocol and the mirror** (core, pure): requests (read,
  overwrite, insert, delete, fill, replace, join, undo, redo, groups, series,
  selection, save checkpoint), answers carrying the state, change events, the
  `SessionView` mirror; tests against a host running in-process.
- [ ] **S2 — the host, sessions in it.** Open a file into a session (handle,
  `File`, path), close it, list a workspace's sessions; a window's panes show
  sessions by id. The documents leave the page; `workspaceStore` holds
  `SessionView`s.
- [ ] **S3 — editing through it.** `TypingController`, the edit commands, Fill,
  Delete Bytes, paste, the tools' writes, joins — each a request. Undo and redo
  are the session's; the undo router's acts move into the session with them.
- [ ] **S4 — reading through it.** The renderers' chunk cache over host reads;
  the workers handed host-made `Blob`s; search, diff, minimap, firmware as
  before.
- [ ] **S5 — segments and bookmarks of a session.** Cuts and their history in
  the session; bookmarks stay the workspace's (they are a place the person
  chose, not part of the file's make-up).
- [ ] **S6 — saving and reverting** through the host, the download path
  handed back to a page.
- [ ] **S7 — kept content in the host.** `ContentKeeper` and `KeptWriter` per
  session; the window records name sessions; restore opens sessions, then the
  windows that show them.
- [ ] **S8 — panes between windows are views.** D5, D6 and D4 on the host;
  `paneParcel`, `carriedHistory`, the parcels' edits and the main process's
  registry removed.
- [ ] **S9 — the agent on the host.** Documents by session id, tools run
  against sessions, the window showing one brought forward.
- [ ] **S10 — the browser edition** on the same host: tabs as windows of one
  workspace — a pane carried between tabs, a file open once across them — and
  the docs: `DESKTOP_WINDOWS.md`, `WORKSPACE.md`, `IMPLEMENTATION_PLAN.md`,
  `ANALYSIS.md`, CLAUDE.md (the one-workspace-per-tab rule).

## Risks

- **Latency.** Every edit is a message. A keystroke's round trip has to stay
  well under a frame; S0 measures it before anything depends on it.
- **The synchronous readers.** The mirror answers them, but anything that read
  a value right after an edit expecting it changed must await the edit's answer
  first; S3 finds those by the type checker (edits return promises already).
- **A host that dies.** A `SharedWorker` crash takes every session with it.
  The journal and the kept content are on disk, so the workspace restore brings
  them back as it does after a crash today; S7 makes that the recovery path.
- **Firefox and Safari.** S0 confirmed Safari; Firefox was not run (not on the
  bench) — the probe runs there unchanged, and S10 does not close without it.
  Their save is a download, which the host hands to the tab that asked.
- **The last window lending the journal.** While any window is connected one
  can lend; when none is, the host is gone too.
- **A browser workspace across tabs.** What a browser keeps is the origin's —
  the workspace restore stays the shell's (`04d9d31`), but the sessions open now
  are shared by every tab, so closing a tab closes only the sessions no other
  tab shows.
