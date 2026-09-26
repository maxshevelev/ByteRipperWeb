# The Firmware Panels

> Instruments that read the open dump and tell you what is in it.

@covers menu.tools.none
@covers panel.help-button
@covers panel.node-term
@covers panel.row-marks-legend

The **Tools** menu turns on one panel at a time, beside the dump. Each one reads the file the pane holds and shows its own view of it:

- **[[topic:tool-uefi|UEFI Structure]]** — the layout of a firmware image: the flash regions, the volumes, the files and sections inside them, the NVRAM stores.
- **[[topic:tool-me|ME Analyzer]]** — what the Intel Management Engine firmware in the image is: its version, its partitions, its configuration.
- **[[topic:tool-fit|FIT Table]]** — the Firmware Interface Table, and whether its entries still point at what they claim.
- **[[topic:tool-zones|Zone Sketch]]** — mark out areas of an unfamiliar image by hand.

## What they have in common

- **A panel is bound to one pane.** In a comparison, the panel's header names the file it is reading, and there is a dropdown there to move it to the other one. Clicking into the other pane does *not* move it — a tool goes on reading the file it was opened for.
- **They read in the background.** A parse of a 16 MB image never blocks the workspace — it is read in a worker of its own; a progress line reports it and it can be cancelled.
- **Selecting a node reveals its bytes.** Click a row and the dump scrolls to the bytes that row stands for and outlines them as a **zone**. That is the link between a name in the panel and an address in the hex view, and it is the reason the panels are worth having on a bench.
- **They tell you what they are unsure about.** A field nobody has documented keeps its raw value and is called unknown rather than being given a confident name. See [[topic:provenance|Where this knowledge comes from]].
- **Row markings** — the rails, badges and warning symbols on the rows — are explained by the **Legend** strip under each panel's table.

## Getting a piece out

Right-click a node and you can open it as a [[topic:fragments|fragment panel]] — the node's bytes as their own document, over the image they came from. That is how a single module, a region or a decompressed section gets extracted, examined and put back.
