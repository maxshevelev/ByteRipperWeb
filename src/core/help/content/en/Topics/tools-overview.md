# The Tool Panels

> Panels that decode the open dump and report the structures it contains.

@covers menu.tools.none
@covers panel.help-button
@covers panel.node-term
@covers panel.row-marks-legend
@covers panel.detail-quick-look

The **Tools** menu turns on one panel at a time beside the dump. Each panel reads the file held by the pane it is bound to and presents its own view of it:

- **[[topic:tool-uefi|UEFI Structure]]** — the layout of a firmware image: the flash regions, the volumes, the files and sections inside them, the NVRAM stores.
- **[[topic:tool-me|ME Analyzer]]** — the Intel Management Engine firmware held in the image: its version, its partitions and its configuration.
- **[[topic:tool-fit|FIT Table]]** — the Firmware Interface Table, and whether its entries point at what they declare.

[[edition:A browser keeps **[[key:tool1]]**, **[[key:tool2]]** and **[[key:tool3]]** for its own tabs, so in a browser the panels turn on from the **Tools** menu in the order it lists them.||The panels have the keys **[[key:tool1]]**, **[[key:tool2]]** and **[[key:tool3]]** in the order the **Tools** menu lists them.]] The key of the panel already shown does nothing.

## What they have in common

- **A panel is bound to one pane.** In a comparison the panel's header names the file it is reading, and a menu there moves it to the other pane. Clicking into the other pane does *not* move it: a panel continues to read the file it was opened for.
- **Decoding runs in the background.** Parsing a 16 MB image does not block the workspace; a progress line reports it and it can be cancelled.
- **Selecting a node reveals its bytes.** Clicking a row scrolls the dump to the bytes that row stands for and outlines them as a **zone**, which is the link between a name in the panel and an address in the hex view.
- **Uncertainty is reported.** A field that has not been documented retains its raw value and is labelled unknown rather than being given a confident name. See [[topic:provenance|Where This Knowledge Comes From]].
- **Row markings** — the rails, badges and warning symbols on the rows — are explained by the **Legend** strip under each panel's table.
- **The details open in a large view.** **Space** on the selected row or in the details under the table, or the expand button in the top right corner of the details under the table, opens the same details in a large card on the right of the window, two thirds of its width, leaving the table in view on the left; while the card is open, the details under the table are folded away and the table takes the whole height of the panel. In the card the button becomes a close button; **Space**, **Esc** and a click outside the card close the large view as well; such a click still does what it was for, and a click on a link in the card closes it and follows the link. While it is open, the table has the focus, even when Space was pressed in the details, and the arrow keys move the selection in it, and the card shows the details of the row selected.

## Extracting a part

The context menu of a node opens it as a [[topic:fragments|fragment panel]]: the node's bytes as a document of their own, over the image they were taken from. This is how a single module, a region or a decompressed section is extracted, examined and written back.
