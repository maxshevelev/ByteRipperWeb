# Moving Around

> Moving between differences, moving to an address, and selecting a range by number.

@covers menu.edit.select-block
@covers menu.edit.select-all
@covers menu.edit.go-to
@covers menu.view.next-difference
@covers menu.view.previous-difference
@covers menu.view.next-same
@covers menu.view.previous-same
@covers dialog.go-to
@covers menu.view.back
@covers menu.view.forward
@covers toolbar.history

**About the keys below.** [[edition:⌘ is the Command key on a Mac and the Control key on Windows and Linux; ⌥ is Option, or Alt. The app takes these keys before the browser does, so [[key:find]] is this app's search and not the browser's find bar.||A chord is written in the order the menu writes it: Ctrl first, then Alt, then Shift, then the key. A chord printed with the glyphs ⌘ and ⌥ is the macOS application's: ⌘ is its Command key, ⌥ its Option. The application takes these keys for itself, so [[key:find]] is its search and nothing else in the window answers to them.]]

## Between differences

- **[[key:nextDifference]]** — next difference, **[[key:previousDifference]]** — previous difference.
- **[[key:nextSameBlock]] / [[key:previousSameBlock]]** — next / previous *matching* block: the start of the next stretch over which the two files agree. This is the complementary movement for an image in which most addresses differ.

For the purpose of this movement a difference is a whole run of differing bytes rather than each byte in it: a differing block of 4 KB is one stop, not four thousand.

## To an address

**[[key:goTo]]** opens Go To. Type an address and press Return:

- `0x1FE00` — hex, with the `0x` prefix (already in the field).
- `130560` — decimal, without a prefix.

The field retains the last ten addresses entered: the arrow at its right edge, or ↓, drops them down, and picking one fills the field — the jump is still a Return. Below it is the [[topic:bookmarks|bookmark list]]: Tab moves the keyboard there, and Return jumps to the selected bookmark.

In comparison mode the jump moves **both** panes, which are locked to the same address.

## Back to where you were

Every jump records the place it leaves: Go To, a bookmark, the next or previous difference, a search result, a click on the minimap, a click on a row of a tool panel. **View ▸ Back** (**[[key:back]]**) returns there — the same selection, the same rows on screen, and the same row chosen in the tool panel with its zones — and **View ▸ Forward** (**[[key:forward]]**) goes the other way. The same two commands are the **‹ ›** buttons in the toolbar, to the right of the Tools menu.

Scrolling, Page Up/Down and Home/End are recorded once they take the caret off the screen: Back returns to the caret and the rows that were on screen with it. Scrolling on while the caret is off screen is the same step. Moving the caret with the arrow keys or the mouse is not a jump and is not recorded. Nor is moving through a tool panel's rows with the arrow keys: only a click on a row is. Back and Forward to a step made by a click in a tool panel's table give the keyboard to that table, so the arrow keys go on from the row they returned to.

The history belongs to the tab and holds the last fifty places. In comparison mode a place covers both panes. With the tool panel closed, Back and Forward return the dump alone; once the same tool is open again, its rows are chosen again as well. A place in a file that has since been closed, or replaced by another file, is skipped.

## Selecting a block

**Select Block from Here at…**, in the pane's right-click menu, selects a range by number rather than by dragging: start and end, or start and length. The item names the address under the pointer, and the dialog opens with it as the start. Both fields accept hex with the `0x` prefix and plain decimal. The command is for selecting by hand, where the start, the end or the length of a range is known or has been worked out.

! **End** is the address of the last byte of the selection, not of the first byte after it. A start of `0x1000` with an end of `0x1FFF` therefore selects exactly `0x1000` bytes.

## Following the other pane

The two panes are locked together in scroll position, caret and selection. **View ▸ Swap Panes** exchanges the files between the panes.

## Making everything bigger

There is no zoom of the app's own: **[[edition:the browser's page zoom is the zoom||the window's page zoom is the zoom]]** ([[key:zoomIn]] and [[key:zoomOut]], [[key:zoomReset]] to come back). The dump's own typeface and size are a setting instead — see [[topic:settings|Settings]].

See also: [[topic:minimap|The Minimap]], for moving by pointing rather than by address.
