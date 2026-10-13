# Annotations

> Short notes on places in a file — made by the person at the bench or by a connected agent — drawn over the bytes and listed in a panel of their own.

@covers window.notes
@covers menu.offset.note
@covers window.notes.edit
@covers panel.uefi.annotate-node

An annotation is a title and a note about a place in a file: what the bytes are, or what was found there. It is drawn over the bytes whenever its file is on screen — in a pane, or in a part that keeps the file's addresses — as a dashed outline with a light wash; when the pointer rests on the bytes, the title and the note are shown. Annotations made by hand are drawn in green, those made by an agent ([[topic:agent|Working with an Agent]]) in violet.

An annotation belongs to the file, not to the window. It is kept when the file closes and drawn again when the file is opened. An annotation on a document that was never saved goes with that document. All annotations are kept until they are removed or the program quits.

## Making an annotation

Select the bytes, right-click inside the selection and choose **Add Annotation…**. Enter a title — a few words saying what the bytes are — and, if needed, a note under it, then click **Add**. In a fragment panel the annotation goes to the file the part came out of: at the same bytes where the part keeps the file's addresses, otherwise in the part's own bytes, where it is shown when that part is opened again.

A node of **UEFI Structure** is annotated the same way: right-click its row and choose **Add Annotation…**; the title starts as the node's name. The annotation is about the node, not only about its bytes: a node inside a compressed section, or an entry of a Lenovo LENV block stored encoded, is kept in the bytes it decompresses or decodes to, and its card shows the codecs as badges. In a fragment panel's tree, a node inside a compressed section of the part has no place in the file to keep it: annotate it from the tree of the file the part came out of.

## The Annotations panel

While there is at least one annotation, the dock along the bottom of the window has an **Annotations** pill ([[topic:fragments|Fragment Panels]]). A click on the pill raises the panel over the dump; a second click, the ⌄ in its header, **Esc** or pulling the header down folds it back into the pill. The panel has no ✕: it goes by itself when the last annotation is removed.

When an agent annotates a place while the panel is folded — or while the panel is just appearing with its first annotation — the pill shows a round badge in violet, the colour of the agent's annotations, with the number of annotations not yet looked at. The badge goes when the panel is raised; an annotation made while the panel is up is counted as seen.

The panel shows every annotation, in every file, open or not, as cards in as many columns as the window is wide. A card is drawn as the annotation is over the dump, in the colour of whoever made it; an agent's card has the agent's plug icon before its title, and a card made by hand a pencil. A click on the pencil opens the title and the note for editing; **Save** keeps the change, and the place stays as it was. A card holds:

- the title, with a ✕ on the card's corner;
- the file, after a dot: filled while the file is open, hollow while it is not;
- the node of **UEFI Structure** the place lies in, after its parent, as the Contents search results name it — a link that shows the place. A place in decompressed or decoded bytes has badges with the codecs the bytes came through — `LZMA`, `XOR C0` — before it, as the header of a fragment panel shows them. In a file with no firmware tree the addresses are shown instead;
- the whole note;
- the annotations it is about — a pointer and its target, a checksum and what it covers — each a link to its card. Over the dump they are listed after the note, under **Related Annotations:**.

A click selects a card, with **⌘** or **⇧** more than one, and the arrow keys move between them. A double-click on a card, or **Return**, brings its file forward — or, for a file the agent read by path, opens it in a free pane — and selects the place, as a step of the navigation history ([[topic:navigation|Moving Around]]). A panel standing over the dump is folded. In a firmware image **UEFI Structure** opens beside the dump at the node the place is in, as a click on a Contents search result does. A place in decompressed or decoded bytes opens in a fragment panel of those bytes, with the place selected and **UEFI Structure** in that panel open to the node that holds it. When both panes already hold a file, the program asks which of them is to be replaced and names the file each one holds. Before the replacement it warns, as closing does, about fragment panels opened out of that file, which would lose their way back, and about unsaved edits. If the file has been moved or deleted since, the program says so; if the file is in place but cannot be opened, the program states the reason.

The ✕ on a card removes that annotation; **Delete** removes the selected cards. Relations to a removed annotation go with it.
