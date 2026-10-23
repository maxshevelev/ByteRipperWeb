# Workspace — the session the page brings back

> **Desktop shell only (2026-10-21).** The owner withdrew the workspace, projects and Open Recent
> from the browser edition: a browser reopens a kept file only as far as it allows at the time,
> which is not a feature to rely on. All of it below runs in the desktop shell (`inDesktopShell`),
> where the same handles are read without a question — the shell grants its page every permission
> — and a file's path is there where a handle is not. In a browser the page starts empty on every
> load and deletes what an earlier build kept.

The web edition of upstream's `Design/WORKSPACE_PLAN.md` (G29). Upstream keeps
the windows of an app and restores them at its launch; a web page has a tab,
and "launch" has to be said in a tab's words. What follows is what the owner
decided (2026-10-20) and what it comes to in code.

> **Several windows in the shell (2026-10-22).** The shell is one process with
> several windows, and its workspace is every window (`Design/DESKTOP_WINDOWS.md`,
> D2): each window is a workspace id as a tab is here, recording its own tab as
> below, and the main process keeps the windows front to back with their ids and
> frames in `userData/Workspace/Windows.json`, opening them all again at launch.
> What follows about a tab is what each window does; "a fresh tab takes up the
> workspace left most recently" holds only for the one window a launch opens
> when the structure names none.

## What "launch" is

- **A reload restores the tab's own workspace.** The tab's identity is the
  `sessionStorage` key the bookmarks already keep (`byteripper.workspace`), so
  a reload, a crash of the tab and a restored tab all find it.
- **A fresh tab takes up the workspace most recently left that no open tab
  holds.** Every tab holds a Web Lock named after its workspace while it is
  open; a new tab — no identity in `sessionStorage` — asks which are held and
  adopts the newest one that is not, by writing that id as its own. Its
  bookmarks then come with it, being kept under the same id.
- With **Settings ▸ General ▸ Reopen the workspace at launch** off, nothing is
  recorded and nothing is adopted: a reload is an empty window as before. The
  switch is off after installation, as upstream's is.

## What a workspace is here

Upstream's model (`Packages/Workspace`), one tab instead of windows of tabs:

| | kept | how it comes back |
|---|---|---|
| File A / File B | name, size, date; the handle (Chromium) or the path (the shell) | the handle's `getFile`, the shell's `readFileByPath` |
| active pane | per tab | `setActivePane` |
| caret, selection, input region, insert mode | per pane | `setSelection`, the typing controller |
| scroll | the first byte on screen | `scrollLink.scrollToOffset` once laid out |
| bookmarks | already kept per workspace id | — |
| segments, minimap, find bar | per pane / surface | W3 |
| untitled documents, unsaved changes | bytes in IndexedDB | W4 |
| fragment panels, and a part let go on a pane | decoded again from their parents — a parent in another window of the shell is named `<workspace>#<pane>` and that window decodes the part once it is back (G112) | W5 |
| tool panel, the Annotations panel | the parked state, the chosen cards | W6 |

Not kept, as upstream: undo history, search results, Back/Forward, app-wide
settings.

## Reaching the files again

A page cannot open a file by itself:

- **Chromium** keeps the `FileSystemFileHandle` a pane opened, in the
  workspace's record. After a reload its permission is often "prompt": asking
  needs a click. When every handle is already granted the files open
  silently, as upstream's; otherwise the empty window offers **Reopen the
  workspace** and the click asks for them. Declined, the workspace stays as it
  was, to be reopened later.
- **The desktop shell** reads the file by its path, as upstream does.
- **Firefox and Safari** give no handle: a file opened there does not come
  back, and the warning names it. What has no file — an untitled document —
  does (W4).

## When it is written

As upstream: continuously — a snapshot every 2 s while the page is visible,
on `visibilitychange` to hidden and on `pagehide`, written only when the
encoded value differs from the last one written. The record keeps `leftAt`,
the time the tab was last seen, which is what "most recently left" sorts by.
Records not seen for 30 days go, as the bookmarks' do.

## Restoring

Before the first render (`main.tsx`), the identity is settled. Once the shell
is up, the workspace is restored: files opened silently where they can be,
positions applied after layout, and one warning at the end listing files
that are gone or changed (`RestoreIssue`). A file that changed since keeps
its position only — upstream's `PaneRestore`.

## Versions

Upstream's promise (`a14d2377`, `9bfc827c`): a project and the session are the
person's work — the session is work not yet saved under a name — so a build
opens what the builds before it wrote. Here it starts at the first version a
release writes: a window's workspace from version 2
(`OLDEST_READABLE`, `src/core/workspace/workspaceMigration.ts`), and the shell's
`Project.json` around the windows from version 2 (`OLDEST_PROJECT`,
`desktop/projects.cjs`). Nothing earlier was released; it is refused.

- **Earlier version** — read through the chain: the JSON is taken one version
  at a time (`MIGRATION_STEPS[n]` makes n + 1 out of n) up to
  `WORKSPACE_VERSION`. The steps work on the JSON, not on the types, which
  describe only the newest version. A window's workspace is migrated by the page
  that restores it; `Project.json`'s own envelope by the main process. The next
  snapshot writes the current version.
- **Newer version** — refused. A project is refused before any window is made,
  with a message saying so: the main process knows the workspace version a
  window is written in through a copy (`WORKSPACE_VERSION` in
  `projects.cjs`) that a test keeps level with the page's.
- **A newer session on an older build** — left untouched for the rest of the
  launch (`isSessionNewer`): neither restored, nor written over, nor deleted,
  the switch on or off — switching it off forgets every other workspace and
  keeps this one. The front window of the launch says so once, and until quit
  the session is kept no more than with the switch off: closing the last window
  quits, and quitting asks about unsaved work.

What may change without raising a version: an added optional field. What raises
it, with a step: a required field added, a field renamed, removed or given
another meaning, a case taken out of a union. Raising `WORKSPACE_VERSION` raises
the copy in `projects.cjs` with it.

`Kept/` follows the same promise without a version of its own: its log is
upstream's, record for record, with the kind and format in each record's tag
(`BRT1`, `BRS1`, `BRP1`, `BRB1`), so a record whose body changes gets a new tag
and the reader goes on reading the old one. A file's edits (`<id>.edits` in `Kept/`: a
JSON header of runs, then the added bytes) follow the JSON's rule for their
header.

Each readable version is kept as a fixture that is never rewritten:
`src/core/workspace/fixtures/v<N>/Workspace.json` (with `version<N>Sample()`),
and for `Kept/` upstream's own log of its version 4
(`src/core/edit/fixtures/v4/history.log`), which this build reads — and writes
the same transactions of, byte for byte.

## Projects

> **Superseded in the shell (2026-10-22, D3 of `Design/DESKTOP_WINDOWS.md`).** A project is
> the app's and holds every window; the main process keeps its folder and writes `Project.json`
> (version 2, every window) and the kept bytes by path (`desktop/projects.cjs`), picked through
> Electron's own panels; the recent projects are its list. What follows about directory handles,
> IndexedDB entries, Web Locks and a switch being a reload described the browser-era design and
> is kept for its history only.

`.brw` folders (W7), where a page can write a folder: a Chromium browser and
the desktop shell, both through `showDirectoryPicker`. Not offered in Firefox
and Safari, as save in place is not.

- **The folder** (`platform/files/projectFolder.ts`) holds `Project.json` —
  the `Workspace` value, indented — and, only while there are any,
  `Untitled/<id>.bin` and `Edits/<id>.bin` (a length-prefixed JSON header of
  runs, then the added bytes; upstream writes a binary plist).
  **Save as Project…** uses the folder picked when it is empty, named `.brw`
  or a project already (replaced); any other folder gets a `Project.brw`
  inside it. **Open Project…** takes a project folder, or a folder holding
  exactly one — a browser's Open… cannot pick a folder.
- **What a folder cannot hold** — its own handle and its files' handles — is
  kept in IndexedDB (`byteripper-projects`, `projectRecords.ts`), one entry
  per project, found again for a picked folder by `isSameEntry`. A file is
  reached by its handle and, in the shell, by its path; a project copied to
  another machine opens without the files a browser cannot name.
  `FileStamp.relativePath` is not written: neither side can say where the
  project folder is on disk.
- **Live.** While a project is open the recorder writes into it, whatever
  the switch says, with a keeper of its own; with the switch on, the tab's
  record also names the project (`WorkspaceRecord.project`), which is what a
  reload — and a fresh tab taking the record up — opens again.
- **A switch is a reload.** Opening another project, or Close Project,
  writes what is open, hands the next load the project's id in
  `sessionStorage` (empty for none), and reloads: nothing of the project
  left behind stays on the page. The session without a project is asked
  Save… / Don't Save / Cancel first, as upstream; Don't Save asks per
  document with unsaved changes, then the browser's own question is not
  asked again.
- **One tab per project**, by a Web Lock on its id: a second tab opening it
  is refused with **The project is open in another tab.**
- **File menu:** Open Project…, the recent projects as a group of rows under
  **Open Recent Project** with **Clear Menu**, Save as Project…, Close
  Project. The tab's title carries the project's name.
