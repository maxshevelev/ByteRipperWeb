# Zone Sketch

> Mark out the areas of an unfamiliar image by hand.

@covers panel.zones

**Tools ▸ Zone Sketch** is a notepad for byte ranges. Select some bytes in the dump, give the range a name and a colour, and it is drawn as a zone over the hex view and in the [[topic:minimap|minimap]].

It parses nothing and knows nothing about any format. That is what makes it useful for the images the other panels cannot read: an EC firmware, a battery controller dump, an unfamiliar SPI chip off a board nobody has documented.

A bench does this with a pencil and a printout. This is the same, kept with the file and clickable: click a zone's row and the dump scrolls to it.

You can also open a zone as a [[topic:fragments|fragment panel]] — the marked bytes as their own file — which is the quick way to extract a block you have identified by eye.
