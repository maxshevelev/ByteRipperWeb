# Desktop shell — several windows, one workspace

> **The owner's decision (2026-10-22).** The desktop shell runs as **one
> process with several windows**, and those windows are **one workspace**, as
> upstream's are: recorded together, restored together, held by one project.
> The shell gets File ▸ New Window and upstream's ways of carrying a pane or a
> fragment panel from one window into another or into a new window. **Tabs are
> not part of this work** — they come after it, built on `WebContentsView`
> ([maxshevelev/ByteRipperWeb#1](https://github.com/maxshevelev/ByteRipperWeb/issues/1)).
> The browser edition is unchanged: one workspace per browser tab, D11.

## Why one process

Today every launch of the shell is a process of its own on one profile. Two
processes fight over the profile's locked databases (IndexedDB, OPFS), Web
Locks do not reach from one to the other — so two of them can take up the same
workspace or the same project — and with persistent undo two of them would
append to the same journal. `app.requestSingleInstanceLock()` settles it: a
second launch hands itself to the first and quits.

## The model: a window is a page, the main process holds them together

Each window is a `BrowserWindow` holding today's page: its own renderer, its
own `sessionStorage`, its own workers. **What a browser tab is now, a window is
in the shell** — upstream's `TabState`, one per window until tabs come. The
page's code keeps its module-level stores; nothing in it learns that another
window exists except through the main process.

Rendering every window from one page (child windows driven through portals)
was considered and rejected: ~190 uses of the global `window` and `document`
across 34 files, and the canvas renderers' device-pixel ratio, would all have
to learn which window they draw in.

The main process (`desktop/windows.cjs`) is what upstream's `AppDelegate` is
for its windows:

- the list of windows, front to back, and each one's frame;
- making a window (`makeWindow`), cascaded off the one in front;
- the app-wide registry of open files (upstream's `OpenDocumentRegistry`,
  rule 6: a file is open once in the app);
- the workspace's structure, and the project the app has open;
- quitting: every window asked, the last snapshot written, then the exit.

## Upstream's window features, and what the shell takes

From upstream's `TABS_PLAN.md`, `PANE_DRAG_PLAN.md`, `WORKSPACE_PLAN.md` and
`FRAGMENT_PANELS_PLAN.md`, with tabs left out:

| upstream | here | phase |
|---|---|---|
| File ▸ New Window (⇧⌘N), cascaded, a usable size | Same; Ctrl+Shift+N on Windows | D1 |
| Launching again with the app open | The window in front comes forward (a second launch never makes a process) | D1 |
| The window's title (`Empty`, the file, `A ↔ B`, `— project`) | Already the page's `document.title`; the shell's window follows it | D1 |
| One menu bar, routed to the key window | A menu per window (Windows/Linux `setMenu`), the focused window's as the app's (macOS) | D1 |
| Close Window (⇧⌘W), ⌘W stepping pane → window | ⌘W/Ctrl+W as upstream; Close Window closes the window | D1 |
| Quit with several windows: each asked about unsaved work in turn, then the last snapshot | File ▸ Exit closes every window, each asking; the app quits after the last | D1 (asking), D2 (snapshot) |
| The workspace: `windows[]` front to back, each with its frame and its tab | Same, version up; each window records its own `TabState`, the main process the structure | D2 |
| Restore at launch: every window, the front one last and key, frames | Same: the main process opens one window per recorded window, hands each its id | D2 |
| Closing the last window quits, keeping it in the workspace | Same | D2 |
| Closing a window that is not the last removes it from the workspace | Same | D2 |
| A project is every window; opening one replaces them all | Same; Save as Project… writes all windows | D3 |
| A file already open elsewhere: Show in Its Window / Move to This Window / Cancel | Same, through the main registry | D4 |
| Dragging a pane onto another window's pane: move, swap, join, duplicate (Option) | Same | D5 |
| A pane into a new window: the pane header's Open in New Tab, the New Tab strip | **Open in New Window**, the **New Window strip** while a pane is dragged | D5 |
| A fragment panel into a new window: the pill's Open in New Tab, the strip | **Open in New Window** on the pill, the strip | D6 |
| A panel let go on another window's free half becomes that pane (`7a11bed`) | Same | D6 |
| Bookmarks: copied with a torn-off pane, a moved pane adopting the receiving window's | Same | D5 |
| The agent sees every window's documents (`AgentDesk`, front to back), brings a window forward | Same, the main process routing a call to the window that holds the document | D7 |
| App-wide: the annotations, the find string, the settings | Kept in step across windows (`BroadcastChannel`, `storage` events) | D7 |
| The Annotations, Agent, Settings and Help windows (singletons) | **Stay panels of each window's dock** (CLAUDE.md): each window may raise its own | — |
| Tabs: New Tab, the tab bar, Merge All Windows, Move Tab to New Window | Not here — issue #1 | — |

## How a pane crosses from one window to another

Upstream moves the `PaneViewModel` object itself, so the edits, the undo
history, the segments and the file watcher go with it. Two renderers share no
objects, so here a pane is **carried as what the workspace already knows how to
write and read back**: its `PaneState` (caret, selection, segments, tool
state), its file's handle and path, its unsaved bytes (the W4 kept edits, or an
untitled document's bytes) and its bookmarks. The source writes that parcel,
the target restores it with the W2–W6 restorer, and only once the target
says it has it does the source let the pane go — a failure on the way leaves
the pane where it was.

A `FileSystemFileHandle`, a `File` and a `Blob` cross between same-origin
windows over `BroadcastChannel` without a copy through the main process; the
main process only says which window is the target.

**The undo history** does not cross until persistent undo is in (P3–P6 of
`PORT_WINDOW_07A3928_21A2889.md`): the journal then lives in OPFS, which every
window of the app reads, and the history's skeleton travels in the parcel.
Until then a moved pane arrives without its history, and the help says so —
a `later` gap, not a decision.

**Parts linked across windows.** Upstream's links from a part to its parent
reach across windows (Update in Parent, Show Parent). Here a link holds within
the window; a pane that has parts open over it is moved with them or not at
all (D5 asks), and the cross-window link is a `later` gap.

## Where the workspace is written

The owner's split (2026-10-22): **the session's workspace in the browser's own
storage, a project in its folder through IPC.**

- **A window's tab** — panes, carets, segments, tool panels — stays its page's
  record in IndexedDB under the window's workspace id, as a browser tab's is.
  Two windows have two ids, so their records and their kept bytes never meet.
- **The session's kept content** — an untitled document's bytes, a file's
  unsaved changes, and with persistent undo the journals — moves to **OPFS**
  (P3–P6 of `PORT_WINDOW_07A3928_21A2889.md`): a file there is appended in place
  from a worker, and every window of the app reads it, which is also what lets
  a pane carried into another window take its history along. Today it is whole
  values in IndexedDB.
- **The structure** — the windows front to back, each one's id and frame — is
  the main process's own, `userData/Workspace/Windows.json`, written by Node
  when it changes (D2). Nothing of the page's crosses to be written there.
- **A project** (`.brw`) is a folder holding everything — `Project.json` with
  every window, `Kept/`, the journals — and is written **by the main process,
  by path, over IPC** (D3): one `Project.json` names every window, which no one
  page can write, and appending a journal through a directory handle would copy
  the whole file each time. The folder is picked through Electron's dialog,
  which gives a path; the shell's projects no longer go through
  `showDirectoryPicker`. That bridge is the page's only way to write to the
  disk by path, so it is fenced: inside the open project's folder and nowhere
  else, every path normalised, `..` and links out refused.

## Phases

Each phase ends with the checks green (`npm run check`, `desktop` tests, the
anchor check, the help checks) and its share of `GAPS.md`, `ANALYSIS.md` and
the module map moved.

- [x] **D1 — one process, several windows.** `requestSingleInstanceLock`,
  `second-instance` bringing the front window forward, `desktop/windows.cjs`
  (the list, `makeWindow`, cascade), File ▸ New Window in the shell's menu,
  a menu per window, Exit closing every window with each one's question,
  the agent endpoint served by one window and handed on when it closes,
  the zoom kept app-wide. Help: `opening-files.md` (`menu.file.new-window`)
  with an edition phrase, in en/ru/de.
- [x] **D2 — one workspace.** The structure in the main process
  (`Windows.json`), each window's tab its page's record as now, restore of
  every window with its frame and the front one last, the last window closing
  keeping it, a window closed for good forgotten, and a quit that asks every
  window before any goes and has each write its last snapshot. The browser keeps
  its IndexedDB record of one tab — it has no workspace at all since
  `04d9d31`, so nothing there changes.
- [x] **D3 — projects of every window.** Open / Save as / Close Project at
  the app's level, a project replacing every window, the folder chosen by
  path.
- [x] **D4 — a file open once in the app.** The registry in the main process,
  Show in Its Window / Move to This Window.
- [ ] **D5 — a pane carried between windows.** The parcel; pane drop on
  another window (move, swap, join, duplicate); Open in New Window from the
  pane header in a comparison; the New Window strip while dragging; bookmarks.
- [ ] **D6 — a fragment panel carried.** Open in New Window on the pill, the
  strip, a panel let go on another window's free half.
- [ ] **D7 — app-wide state.** The agent's desk over every window (the main
  process routing), the annotations, the find string and the settings kept in
  step.

Then persistent undo (P3–P8 of the port window) lands on top of D2's writer,
and a moved pane carries its history.

## Docs this changes

- `IMPLEMENTATION_PLAN.md` D11 and `ANALYSIS.md` § Tabs, windows, panes: the
  shell's exception — several windows, one workspace — the browser unchanged.
- `GAPS.md`: the "several windows" row out of Dropped for the shell; new
  `later` rows for the history and the parts across windows until they cross.
- `WORKSPACE.md`: the shell's workspace written by the main process.
- The module map: `AppDelegate.newWindow`, `makeWindow`,
  `MainViewController.closeWindow`, `askAboutFileOpenElsewhere`,
  `OpenDocumentRegistry`, `PaneDrop`, `tearOffFragment` and their tests from
  `n/a` to ported (shell) or `later`.
