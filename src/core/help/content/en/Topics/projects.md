# Projects

> A project is a workspace kept in a folder of its own: everything open for one job, opened again as one thing and switched between.

@covers menu.file.open-project
@covers menu.file.save-as-project
@covers menu.file.open-recent-project
@covers menu.file.close-project

[[edition:**This page is about the Windows application.** A page in a browser cannot open a project's files again by itself, so the browser edition has no projects; nothing below exists there.||]]

A project holds what the [[topic:workspace|workspace]] holds — every window, and in each the files, where each pane was, the bookmarks, the segments, the fragment panels, the tool panels and the **Annotations** panel — every change not yet saved included: untitled documents, changes in parts not yet put back, and the changed bytes of files, which come back red as they were. Unlike the workspace, a project is kept whatever the setting **Reopen the workspace at launch** says.

## Making a project

**File ▸ Save as Project…** asks where to keep the project and under what name, and writes every open window into it. A new name becomes the project's folder. A folder chosen that exists is used as it is when it is empty, when its name ends in `.brw`, or when it already holds a project, which is then replaced. Any other folder — the folder of a job, with its dumps — receives a new folder `Project.brw` for the project. The project is then the open one, and from then on it is written continuously, every few seconds and on every switch: there is no separate command to save it. The name of the project follows the window's title.

Projects of this application and of ByteRipper for macOS are not compatible: neither application opens the other's. The macOS application keeps windows with tabs in a project; this one keeps windows without tabs. A project's folder is therefore named `.brw` here, not `.brp`.

The files themselves stay where they are; the project refers to them. It keeps the full path of each file, and the files are opened again by it.

## Opening and switching

- **File ▸ Open Project…** asks for the folder of a project — or for a folder holding exactly one project — and opens it.
- **File ▸ Open Recent Project** lists the projects opened lately; **Clear Menu** empties the list.
- Opening a project closes every open window and opens the project's windows in their places. The project being left is kept as it is, unsaved changes included, and nothing is asked.
- When no project is open and something is, opening a project first offers to save the current session as a project. **Don't Save** closes it, asking in each window about each document with unsaved changes.
- **File ▸ Close Project** leaves the project as it is and returns to one empty window.
- One project is open at a time, and it holds every window: **File ▸ New Window** adds a window to it, and closing a window while others stay open takes that window out of it.

With [[topic:workspace|Reopen the workspace at launch]] on, the project open when ByteRipper was closed is opened again at the next launch.

## What a project folder holds

A project folder holds `Project.json` — a few kilobytes describing what was open — and, only while there are any, the bytes nothing else on disk has: untitled documents in `Untitled`, and unsaved changes of files in `Edits`. A project without unsaved work stays small. To send a project by mail or message, compress its folder first.

## Files that changed or are missing

A file that cannot be found is not opened. A file that changed on disk while the project was closed opens without the project's unsaved changes to it, since those changes were made on other bytes. One message after opening lists both, as it does for the workspace.
