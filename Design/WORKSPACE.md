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
| fragment panels | decoded again from their parents | W5 |
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

## Projects

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
