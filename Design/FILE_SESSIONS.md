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
- **The shell** reaches the host through a `MessageChannelMain`: the main
  process hands a port to a window's preload, the page passes it on, and it
  outlives that window (S0). A worker has no preload, so the host asks the
  shell over that port, not through a window: files by path, hashing by path,
  the agent, and everything kept.
- **In the shell nothing is in OPFS.** The workspace's `Kept/` lies in the
  profile (`userData/Workspace/Kept/`) and is written by the code that writes a
  project's (`projects.cjs`): the workspace is a project in a folder of the
  app's own, and `KeptFolder` has one form in the shell. The undo journal is a
  file there too, appended by Node — a journal kept beside a workspace or a
  project is born where it is kept and never moves. `OpfsKeptFolder`,
  `OpfsJournalStore`, `journal.worker.ts` and the move of a journal into
  `Kept/` go (the owner's decision of 2026-10-22; no released version holds a
  `Kept/` in OPFS, so nothing is carried over).
- **In the browser the journal is the only thing on disk** — the browser keeps
  no workspace — and it is written by the host itself, as records each written
  once as a file of their own in OPFS (S0: 3–6 ms a record, no copy of what is
  already written). A `JournalStore` is only an append and a read, so nothing
  above it knows. No nested worker, no sync handle, no window lending one.
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
  below. One answer did change the plan: a `SharedWorker` in Chromium has no
  sync handle, so the shell keeps its journal and `Kept/` through Node and the
  browser writes its journal as one file per record.

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
- [x] **S1 — the protocol and the mirror** (core, pure): requests (read,
  overwrite, insert, delete, fill, replace, join, undo, redo, groups, series,
  selection, save checkpoint), answers carrying the state, change events, the
  `SessionView` mirror; tests against a host running in-process.
  Done as `src/core/session/` — `sessionProtocol.ts`, `sessionHost.ts`,
  `sessionView.ts`, over a line that clones and delays as a port does
  (`src/core/testing/sessionLines.ts`). What it settled:
  an operation crosses as the stretch it touched (`OperationSpan`), which is all
  a window does with one; grouping, series, `markSaved` are told, not awaited —
  the host keeps one window's order, and `settled()` waits for it; the
  selection is the one value a window holds ahead of the host, its own until
  the host has applied the request that set it (`acked`), so news of an older
  selection never takes a newer one back; every message about a session carries
  its state, and an event reaches the window that caused it before its answer.
  Left for S2: a port says nothing when its page goes, so a window will hold a
  Web Lock the host waits on, and hand its sessions back when it is released.
- [x] **S2 — the panes show sessions, the host still in the page.** A
  `SessionHost` runs in the window itself, over a `MessageChannel`, and every
  pane holds a `SessionView` where it held a `BinaryDocument`: opening a file
  opens a session, closing a pane closes it, and everything that edited or read
  a document goes through the view — `TypingController`, the edit commands,
  Fill, Delete Bytes, paste, the tools' writes, joins (requests); the renderer,
  saves, the workers, search, diff, minimap, firmware (`SessionStorage`, and a
  snapshot the host makes). The app behaves as before in one window, which is
  what proves the protocol on all of it before a second window depends on it.
  What still reaches into the host's document from the page — the keeper, the
  cut history, the undo router — does it through one named door,
  `hostDocument(id)`, which S3–S6 close. (S2–S4 of the first draft, folded:
  a pane cannot show a session it edits another way.)
  Done: `src/state/sessions/pageSessions.ts` holds the host and the window's
  client; `PaneState.document` is a `SessionView`; the typing controller and
  the segment replacer drive an `EditableDocument`, which both a document and a
  view are. What it settled:
  an edit's news carries the bytes it left, up to 256 KiB, and a window lays
  them over the chunks it has read and shifts the chunks after an insert or a
  delete (`SessionStorage.apply`), so a typed byte is painted from the news,
  not read again; everything the host says leaves in the order it happened,
  an edit's news before its answer even while its bytes are read from the
  journal; `endEditGroup`, `markSaved` and `clearKeepingDirty` settle once the
  host has applied them, for the callers that read their effect; a session no
  pane or part shows any more is ended. The door is two functions:
  `hostDocument(view)` to read the document (the keeper's checks, the
  minimap's edited ranges, the background documents' count) and
  `onHostDocument(view, work)` to work on it in its turn among the requests
  (a snapshot, a save's rebase, a revert, kept changes laid over, a history put
  back) — and a join from outside the sessions names its bytes by a number the
  page keeps. Measured in the page: a nibble typed is answered in 5.5 ms at the
  median, nearly all of it the page's own listeners, which ran inside the edit
  before; a round trip alone is under 0.1 ms. In the shell, an untitled
  document typed into, the process killed, came back with its bytes and undid
  its last byte.
- [x] **S3 — the undo router's acts in the session, and its cuts with them.**
  The order of edits and cuts is the session's, so Cmd/Ctrl+Z in any window
  takes back the last act whichever window did it. Done with S4's cuts, which
  the acts cannot be moved without — an act remembers the partition it left:
  `src/core/session/sessionCuts.ts` (`CutHistory`, the partition and its own
  history, moved by the session with every edit) and `sessionActs.ts`
  (`SessionActs`, the order across the two, groups, the snapshot rules). A
  session's `undo` and `redo` are the acts'; its `canUndo` and labels are
  theirs. The page's `segmentsStore` mirrors the partition of the session each
  pane shows, a window's own cut standing until the host has applied it, as a
  selection does; `undoRouter` keeps only the window's side of a press. A
  segment swap computes its partition from the one before the swap, since the
  session has already moved the cuts by the ordinary insert rule.
- [x] **S4 — the rest of a session's make-up.** The segment sources (which file
  a piece's link names) are keyed by the session, not the pane, and go with it
  (`segmentSources.ts`, `onSessionClosed`): a swap of the panes moves nothing.
  They stay in the page until S7 moves them into the host with the files they
  hold. Bookmarks stay the workspace's (a place the person chose, not part of
  the file's make-up). What is still the pane's and is the session's — its
  file, name, saved copy, whether it can be written, and the join marks that
  give a file back on Undo — goes into the session in S8, where a pane becomes
  a view of one.
- [x] **S5 — saving and reverting** through the host, the download path
  handed back to a page. A save is two halves (`fileSink.ts`): `saveTarget`,
  the page's — the picker, the permission — and `writeTo`, which needs no page
  and runs in the session's turn with the rebase and the checkpoint, so no edit
  lands between the bytes going out and the state that says they are saved. A
  download is a blob the host makes (`contentBlob`) and the page downloads. A
  revert runs in the session's turn since S2.
- [x] **S6 — no door left: everything the page did to a document is a request
  or an operation of the host.** `SessionHost` learns named operations — per
  session, in its turn (`defineSessionOperation`), and host-wide
  (`defineHostOperation`) — and the platform teaches them:
  `platform/sessions/sessionOperations.ts` (snapshot, save, revert, kept
  changes laid over, a carried history put back, the undo state written down
  and put back, the cuts restored) and `state/sessions/keeperOperations.ts`
  (the keepers, one per kept folder, in the host). A window's
  `KeptContentClient` names the folder and the sessions: a snapshot asks the
  host to keep each pane's session, the host writes the kept files and hands
  back the workspace with their hashes, the window writes its record, and only
  then does the host remove what no record names; it also answers which
  sessions it holds as they are, which is what leaving asks about. The page
  has no `hostDocument` any more; the one thing left is a join from outside
  the sessions naming its bytes by a number the page keeps, which S7 replaces
  with the `File`. (Found on the way: since S2 a file's kept changes were not
  laid back over it at restore — the restore asked the view for an overlay it
  does not have. Now the host lays them; checked in the shell: a file typed
  into, the process killed, came back with its bytes and undid them.)
  The kept folders stay where they were — the workspace's in OPFS per window,
  a project's through the shell — until S7, where one host keeps one workspace
  and the folder moves into the profile through the main process.
- [x] **S7 — the host in a `SharedWorker`.** `src/workers/sessionHost.worker.ts`
  is the host every window of the app connects to; the page runs it itself
  only where there is no such worker (the single-file build, a test), by the
  same `makeSessionHost` (`state/sessions/hostSetup.ts`). A window opens a
  session by naming its source (`DocumentSource`: a file's `Blob`, or
  nothing) under an id it chose, and the host makes the storage; a join from a
  file names the `Blob`. The host's undo journals are a write per file in OPFS
  (`OpfsRecordJournalStore`); in the shell its kept content — the
  workspace's, now under the profile (`Workspace/Windows/kept-<id>/Kept/`), and
  the open project's — is written by the main process through a port a window
  hands over (`desktop/hostDisk.cjs`, `platform/sessions/shellDisk.ts`). A
  window holds a Web Lock while it lives; the host waits on it and, when it is
  let go, ends the sessions only that window showed. Checked: two tabs of
  Chromium show one session, an edit in one is undone in the other; in the
  shell a file typed into, the process killed, came back and undid.
  Still one keeper folder per window, as before: one workspace across windows
  is S8's, with the panes.
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
- **The main process does the shell's disk work.** Writes are async and
  queued, as a project's are today; if it ever shows in the menus' response,
  the same handlers move to a `utilityProcess` behind the same port.
- **A browser workspace across tabs.** What a browser keeps is the origin's —
  the workspace restore stays the shell's (`04d9d31`), but the sessions open now
  are shared by every tab, so closing a tab closes only the sessions no other
  tab shows.
