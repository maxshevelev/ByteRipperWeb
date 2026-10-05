# Fragment Panels: A Part of a Dump

> Extracting one part of an image, working on it as a separate file, and writing it back.

@covers shell.fragments
@covers shell.fragment-dock
@covers pane.header.update-in-parent

A part of an image supplied by a [[topic:tools-overview|tool panel]] — a region, a volume, a module, the decompressed body of a section — opens as a **fragment panel**: a panel that rises from the bottom of the workspace, over the dump it was taken from.

The parent remains visible above it. Folded down, the fragment becomes a pill in the dock along the bottom edge of the workspace. One dock serves the workspace: it holds the parts extracted from both open images, and the help book, which uses the same dock.

Only one panel is up at a time. Raising another folds the one that was up, which is why opening the help puts a fragment away rather than covering it.

## What a fragment supports

- Reading and searching as an ordinary file, with its own addresses beginning at zero rather than at the address it occupies in the parent.
- Editing.
- **Update in Parent**, in the panel's own header menu, which writes the edited bytes back into the range they came from as a single undo step in the parent document. Fold the panel down and the change is there in the dump behind it. Once the fragment differs from what it was opened with, its header shows a **Modified** button, with a download-arrow icon, right after the parent's name, that does the same; a dialog then says what was written and that Undo in the parent takes it back.
- Saving as a file of its own, where the extracted part is what is required rather than an edited parent. What that means in this browser is in [[topic:saving|Saving]].

## The panel's own minimap and tool panel

A fragment panel is a reading surface in its own right rather than a second view of the parent's, and it carries the same two instruments the workspace carries:

- **Its own minimap.** **View ▸ Show Minimap** ([[key:minimap]]) and the button at the right end of the toolbar act on whichever panel is in front, so the column beside a fragment maps the fragment: its own bookmarks, its own segment strip, and the zones a tool published in it.
- **Its own tool panel.** The **Tools** menu and the toolbar's tool button act on the panel in front in the same way, and the tool that opens there reads the fragment's bytes. It is bound to that one fragment: where a tool in the workspace can be pointed at either of the open files, a tool in a panel has one and offers no switch.

## When putting it back is refused

Update in Parent verifies the following before writing, and states which condition it failed on:

- **The parent is closed**, or that pane now holds another file. The link is to the open document and not to a path on disk — a page is never told a path in the first place, so it cannot be recorded and found again.
- **The parent is read-only.**
- **The length changed.** A copied part is written back at exactly its own length; the bytes following it in the image are not the fragment's to move. An edit that changed the length is therefore refused.
- **The source changed** after the part was opened. This is a confirmation rather than a refusal: the program asks before overwriting.

## Decompressed parts

A compressed UEFI section can be opened *decompressed*. What is then displayed is not the bytes held in the file but what those bytes expand to. Once edited and written back it is compressed again and the image is laid out around the resulting size. The result is not byte-identical to the manufacturer's original even when nothing has been changed, a different compressor producing different output from the same input.
## A fragment as a UEFI subtree

A fragment opened from a node of the [[topic:tool-uefi|UEFI Structure]] tree holds that node's bytes, so opening UEFI Structure on the fragment parses them as an image of their own: what the panel's tree shows is the subtree under that node, at the panel's own addresses from zero.

Opening a compressed section decompressed is useful here. In the parent's pane a node inside a compressed section has no bytes of its own in the file, so the dump marks the whole compressed section. In a decompressed fragment every node has its own bytes: selecting a node marks exactly those bytes in the dump, and **Select Zone**, **Open Zone** and **Save Zone as…** work on them.

## Bookmarks across a parent and its fragments

[[topic:bookmarks|Bookmarks]] are one list per workspace, and the panes and every fragment panel share it. A panel counts from its own first byte while the list keeps the file's addresses, so one mark is one byte at two addresses: `0x1F400` in the dump is `0x400` in a part taken out at `0x1F000`. Marking a row in either place marks it in the other, and a part opened out of a part adds the two offsets up.

- A mark made in a panel appears on the parent's pane at once, at the address the file has it at, and a mark made in the dump appears in every panel whose part covers that row.
- A mark on the rows before the part's first byte is not in the part and is not drawn there. The list keeps it either way.
- In a panel a mark's tooltip adds the address it has in the file it belongs to — the address it will be found at outside the panel.

**A decompressed part has no bookmarks at all.** Its bytes are not the file's bytes, so no address in them is an address in the file, and a mark in one place would mean nothing in the other. The panel draws none and takes none, and **Go To** says why rather than showing an empty list. The same holds for anything opened out of a decompressed part.


See also: [[topic:saving|Saving]], [[topic:bench-safety|Constraints on Editing an Image]].
