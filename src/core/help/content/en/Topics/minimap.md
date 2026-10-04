# The Minimap

> The shape of the whole dump in one column, and a way to move by pointing.

@covers menu.view.minimap
@covers menu.view.minimap-overview
@covers shell.minimap

**View ▸ Show Minimap** ([[key:minimap]]), or the button at the right end of the toolbar, opens a narrow column beside the dump. In comparison mode it shows both files, split the way the panes are.

## Two modes

The switch in the minimap's header picks between them.

- **Overview** — the whole file compressed into the column. Each row stands for a slice of the dump, shaded by **how much of that slice holds content**: erased `FF` padding stays pale, code and data are drawn dark. The layout of a firmware image is legible in this view: the end of the descriptor, the extent of the ME region, the start of a volume and the free space following it.
- **Local** — a miniature hex dump around the caret, one map row per real dump row, coloured exactly the way the bytes are coloured in the pane.

A small file opens in Local, a big one in Overview. Overview is only offered while it actually compresses the file.

## What it marks

- **Differences**, in orange, which shows in one view whether two dumps differ in a single block or throughout.
- **Unsaved edits**.
- **Search matches**, as strokes, with the current one as a bright plate.
- **Bookmarked rows**, in purple, in the margin.
- **Zones** published by a [[topic:tools-overview|tool panel]], which renders the regions of an image as bands.

A click in the map moves to the position clicked. Dragging the viewport box scrolls the pane.

See also: [[topic:colors|What the Colours Mean]].
