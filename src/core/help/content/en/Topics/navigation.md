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

**About the keys below.** ⌘ is the Command key on a Mac and the Control key on Windows and Linux; ⌥ is Option, or Alt. The app takes these keys before the browser does, so ⌘F is this app's search and not the browser's find bar.

## Between differences

- **⌥⌘→** — next difference, **⌥⌘←** — previous difference.
- **⇧⌥⌘→ / ⇧⌥⌘←** — next / previous *matching* block: the start of the next stretch over which the two files agree. This is the complementary movement for an image in which most addresses differ.

For the purpose of this movement a difference is a whole run of differing bytes rather than each byte in it: a differing block of 4 KB is one stop, not four thousand.

## To an address

**⌘L** opens Go To. Type an address and press Return:

- `0x1FE00` — hex, with the `0x` prefix (already in the field).
- `130560` — decimal, without a prefix.

The field retains the last ten addresses entered: the arrow at its right edge, or ↓, drops them down, and picking one fills the field — the jump is still a Return. Below it is the [[topic:bookmarks|bookmark list]]: Tab moves the keyboard there, and Return jumps to the selected bookmark.

In comparison mode the jump moves **both** panes, which are locked to the same address.

## Selecting a block

**Select Block from Here at…**, in the pane's right-click menu, selects a range by number rather than by dragging: start and end, or start and length. The item names the address under the pointer, and the dialog opens with it as the start. Both fields accept hex with the `0x` prefix and plain decimal. The command is for selecting by hand, where the start, the end or the length of a range is known or has been worked out.

! **End** is the address of the last byte of the selection, not of the first byte after it. A start of `0x1000` with an end of `0x1FFF` therefore selects exactly `0x1000` bytes.

## Following the other pane

The two panes are locked together in scroll position, caret and selection. **View ▸ Swap Panes** exchanges the files between the panes.

## Making everything bigger

There is no zoom of the app's own: **the browser's page zoom is the zoom** (⌘+ and ⌘−, ⌘0 to come back). The dump's own typeface and size are a setting instead — see [[topic:settings|Settings]].

See also: [[topic:minimap|The Minimap]], for moving by pointing rather than by address.
