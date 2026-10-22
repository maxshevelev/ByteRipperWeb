# Projects

> A project is a workspace kept in a folder of its own: everything open for one job, opened again as one thing and switched between.

@covers menu.file.open-project
@covers menu.file.save-as-project
@covers menu.file.open-recent-project
@covers menu.file.close-project
@covers projects.open-elsewhere

[[edition:**This page is about the Windows application.** A page in a browser cannot open a project's files again by itself, so the browser edition has no projects; nothing below exists there.||]]

A project holds what the [[topic:workspace|workspace]] holds — the files, where each pane was, the bookmarks, the segments, the fragment panels, the tool panels and the **Annotations** panel — every change not yet saved included: untitled documents, changes in parts not yet put back, and the changed bytes of files, which come back red as they were. Unlike the workspace, a project is kept whatever the setting **Reopen the workspace at launch** says.

## Making a project

**File ▸ Save as Project…** asks for a folder and writes what is open now into it as a project. The folder chosen is used as it is when it is empty, when its name ends in `.brw`, or when it already holds a project, which is then replaced. Any other folder — the folder of a job, with its dumps — receives a new folder `Project.brw` for the project. The project is then the open one, and from then on it is written continuously, every few seconds and on every switch: there is no separate command to save it. The name of the project follows the window's title.

Projects of this application and of ByteRipper for macOS are not compatible: neither application opens the other's. The macOS application keeps several windows in a project; this one works with a single window. A project's folder is therefore named `.brw` here, not `.brp`.

The files themselves stay where they are; the project refers to them. It keeps the full path of each file, and the files are opened again by it.

## Opening and switching

- **File ▸ Open Project…** asks for the folder of a project — or for a folder holding exactly one project — and opens it.
- **File ▸ Open Recent Project** lists the projects opened lately; **Clear Menu** empties the list.
- Opening a project replaces everything open. The project being left is kept as it is, unsaved changes included, and nothing is asked.
- When no project is open and something is, opening a project first offers to save the current session as a project. **Don't Save** closes it, asking about each document with unsaved changes.
- **File ▸ Close Project** leaves the project as it is and returns to an empty window.
- A project is open in one window at a time. Opening one that another window has open is refused with the message **The project is open in another tab.**

With [[topic:workspace|Reopen the workspace at launch]] on, the project open when ByteRipper was closed is opened again at the next launch.

## What a project folder holds

A project folder holds `Project.json` — a few kilobytes describing what was open — and, only while there are any, the bytes nothing else on disk has: untitled documents in `Untitled`, and unsaved changes of files in `Edits`. A project without unsaved work stays small. To send a project by mail or message, compress its folder first.

## Files that changed or are missing

A file that cannot be found is not opened. A file that changed on disk while the project was closed opens without the project's unsaved changes to it, since those changes were made on other bytes. One message after opening lists both, as it does for the workspace.
