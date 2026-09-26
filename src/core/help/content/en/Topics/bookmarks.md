# Bookmarks

> Addresses worth coming back to, marked on the row and shared by both panes.

@covers menu.edit.bookmark-toggle
@covers menu.edit.bookmark-edit

**⌘D** marks (or unmarks) the row the caret is on. The row's offset column turns into a coloured arrow with the address written on it, and the row is marked in the [[topic:minimap|minimap]]'s margin. They are also listed on the empty screen, so a workspace with nothing open still says what you had been looking at.

- **⇧⌘D** gives the mark a name, or edits the name it has. A mark with no name shows its address.
- **⌘L** opens Go To, and the lower half of that form is the bookmark list: Tab moves the keyboard into it, Return jumps to the selected mark.

## What a bookmark is

A bookmark marks a **row**, not a byte: the address is rounded down to a multiple of 16, because a row is where the mark can actually be seen.

A bookmark is an **absolute address**, and it belongs to the workspace rather than to a file. In a comparison both panes show the same mark at the same height — which is the point of it: mark `0x1FE000` and you are looking at the same place in both dumps.

Because the address is absolute, inserting or deleting bytes moves the content but not the mark. If you need a mark that travels with the bytes, that is a [[topic:segments|segment]] cut, not a bookmark.

Bookmarks live as long as the workspace, not as long as the file. Closing a file and reopening it keeps the marks — the same investigation continued.

They also outlive the page: the marks are kept in this browser, so a reload that loses the open dumps does not lose where you were looking. They are kept **per browser and per machine**, like the rest of the settings, and clearing this site's data clears them ([[topic:settings|Settings]]).

## On the bench

Mark the starts of the regions you care about before you begin — descriptor, ME, BIOS, NVRAM, the block you are about to patch — and the whole job becomes ⌘L and a Return instead of typing addresses. A tool panel will tell you those addresses: select a node and read its offset.
