# The Minimap

> The shape of the whole dump in one column, and a way to move by pointing.

@covers menu.view.minimap
@covers menu.view.minimap-overview
@covers shell.minimap

**View ▸ Show Minimap** (⌘M), or the button at the right end of the toolbar, opens a narrow column beside the dump. In comparison mode it shows both files, split the way the panes are.

## Two modes

The switch in the minimap's header picks between them.

- **Overview** — the whole file compressed into the column. Each row stands for a slice of the dump, shaded by **how much of that slice is real content**: erased `FF` padding stays pale, code and data go dark. This is the view that shows a firmware image's layout at a glance — you can see where the descriptor ends, where the ME region sits, where a volume begins and where the free space after it starts.
- **Local** — a miniature hex dump around the caret, one map row per real dump row, coloured exactly the way the bytes are coloured in the pane.

A small file opens in Local, a big one in Overview. Overview is only offered while it actually compresses the file.

## What it marks

- **Differences**, in the difference colour — which is what makes it useful in a comparison: you can see at once whether two dumps differ in one block or all over.
- **Your unsaved edits**.
- **Search matches**, as strokes of ink, with the current one as a bright plate.
- **Bookmarked rows**, in the margin.
- **Zones** published by a [[topic:tools-overview|firmware panel]], so the image's regions are visible as bands.

Click anywhere in the map to jump there. Drag the viewport box to scroll.

## On the bench

Overview mode is the fastest way to answer "did the chip read properly?". A good SPI dump has structure: a dense descriptor at the top, a dark ME region, a patterned BIOS region, pale erased areas between them. A dump that is one uniform grey — or one uniform pale field — is usually a bad read, a shorted pin or the wrong chip selected.

See also: [[topic:colors|What the colours mean]].
