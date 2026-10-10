# Bookmarks

> Marked addresses to return to quickly: shown on the row and shared by both panes.

@covers menu.edit.bookmark-toggle
@covers menu.edit.bookmark-edit

**[[key:bookmark]]** sets a bookmark on the row the caret is on, or removes the one that is there. The Bookmarks menu names which of the two it will do: **Bookmarks ▸ Add Bookmark** on a row without a bookmark, **Bookmarks ▸ Delete Bookmark** on a row that has one. The address of a bookmarked row is drawn on a purple arrow, and the row is marked in the same colour in the margin of the [[topic:minimap|minimap]]. Bookmarks are also listed on the empty screen, so a workspace with nothing open still names what was being looked at.

A right-click on a row offers the same for that row, with its address in the item: *Add Bookmark at…*, or *Delete Bookmark at…* and *Edit Bookmark…* where the row already has one.

- **[[key:editBookmark]]** gives the bookmark a name, or edits the name it has. A bookmark with no name displays its address.
- **[[key:goTo]]** opens Go To, and the lower half of that form is the bookmark list: Tab moves the keyboard into it, Return jumps to the selected bookmark.

## What a bookmark is

A bookmark marks a **row**, not a byte: the address is rounded down to a multiple of 16, a row being the unit on which the mark is visible.

A bookmark is an **absolute address**, and it belongs to the workspace rather than to a file. In a comparison both panes display the same bookmark at the same height, so that `0x1FE000` refers to the same place in both dumps.

Because the address is absolute, inserting or deleting bytes moves the content but not the bookmark. Unlike a bookmark, a [[topic:segments|segment]] cut is a mark that travels with the bytes when data in the file shifts.

Bookmarks last as long as the workspace, not as long as the file: closing a file and reopening it retains them.

They also outlive the page: the bookmarks are kept in this browser, so a reload that loses the open dumps does not lose where you were looking. They are kept **per browser and per machine**, like the rest of the settings, and clearing this site's data clears them ([[topic:settings|Settings]]).

The addresses to bookmark are reported by the tool panels: selecting a node in a panel gives its address in the detail list ([[topic:tools-overview|The Tool Panels]]).
