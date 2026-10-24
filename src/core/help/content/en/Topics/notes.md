# Annotations

> Short notes on places in a file — made by the user or by a connected agent — drawn over the bytes and listed in a panel of their own.

@covers window.notes
@covers menu.offset.note
@covers window.notes.edit
@covers menu.offset.open-note
@covers panel.uefi.annotate-node
@covers toolbar.notes
@covers menu.window.notes

An annotation is a title and a note about a place in a file: what the bytes are, or what was found there. It is drawn over the bytes whenever its file is on screen — in a pane, or in a part that keeps the file's addresses — as a dashed outline with a light wash; when the pointer reaches the outline, the title and the note are shown at once — on the outline only, so they never cover the bytes inside it. Right-clicking a byte that lies in annotations offers **Open Annotation “…”** for each of them, the innermost first: the **Annotations** [[edition:panel comes up||window comes forward]] with that card selected, and **[[key:back]]** returns to the dump. Annotations made by hand are drawn in green, those made by an agent ([[topic:agent|Working with an Agent]]) in violet.

An annotation belongs to the file, not to the window. It is kept when the file closes and drawn again in the hex dump when the file is opened. An annotation on a document that was never saved goes with that document. Every other annotation is kept until it is removed, [[edition:in this browser, and comes back the next time the page is opened — a file is recognised again by its name, size and date, so one saved under a new date is another file||on this computer, and comes back at the next launch]].[[edition:|| Annotations can be a convenient alternative to **File ▸ Open Recent**: they show the places of interest in the files, not only the files.]]

## Making an annotation

Select the bytes, right-click inside the selection and choose **Add Annotation…**. Enter a title — a few words saying what the bytes are — and, if needed, a note under it, then click **Add**. The **Annotations** [[edition:panel then comes up||window then comes forward]] to show the new card; this is a step of the navigation history, and **[[key:back]]** returns to the bytes the annotation was made on. In a fragment panel the annotation goes to the file the part came out of: at the same bytes where the part keeps the file's addresses, otherwise in the part's own bytes, where it is shown when that part is opened again.

A node of **UEFI Structure** is annotated the same way: right-click its row and choose **Add Annotation…**; the title starts as the node's name. The annotation is about the node, not only about its bytes: a node inside a compressed section, or an entry of a Lenovo LENV block stored encoded, is kept in the bytes it decompresses or decodes to, and its card shows the codecs as badges.

## The Annotations panel

[[edition:While there is at least one annotation, the dock along the bottom of the window has an **Annotations** pill ([[topic:fragments|Fragment Panels]]). A click on the pill raises the panel over the dump; a second click, the ⌄ in its header, **Esc** or pulling the header down folds it back into the pill. The panel has no ✕: it goes by itself when the last annotation is removed.||**Window ▸ Annotations** and the **Annotations** button of the toolbar, after **Segments**, open the **Annotations** window, or bring it forward when it is already open. There is one such window for the whole application, whichever window it is opened from; it may stand empty, and it is closed like any other window.]]

When an agent annotates a place while the [[edition:panel is folded — or while the panel is just appearing with its first annotation — the pill shows||**Annotations** window is not in front, the **Annotations** button of every window shows]] a round badge in violet, the colour of the agent's annotations, with the number of annotations not yet looked at. The badge goes when the [[edition:panel is raised; an annotation made while the panel is up||window comes to the front; an annotation made while it is in front]] is counted as seen.

The panel shows every annotation, in every file, open or not, as cards in as many columns as the window is wide. A card is drawn as the annotation is over the dump, in the colour of whoever made it; an agent's card has the agent's plug icon before its title, and a card made by hand a pencil. A click on the pencil opens the title and the note for editing; **Save** keeps the change, and the place stays as it was. A card holds:

- the title, with a ✕ on the card's corner;
- the file, after a dot: filled while the file is open, hollow while it is not;
- the node of **UEFI Structure** the place lies in, after its parent, as the Contents search results name it — a link that shows the place. A place in decompressed or decoded bytes has badges with the codecs the bytes came through — `LZMA`, `XOR C0` — before it, as the header of a fragment panel shows them. In a file with no firmware tree the addresses are shown instead;
- the whole note;
- the annotations it is about — a pointer and its target, a checksum and what it covers — each a link to its card. Over the dump they are listed after the note, under **Related Annotations:**.

The newest card comes first and wears a **New** tag on its top edge — a card made while the panel is up at once, one made while it is folded when the panel is next raised. The tags go when the panel is folded.

A card can be dragged to another place with the mouse, and stays where it is put.

A click selects a card. **Shift**-click selects the cards from the one last clicked to the one clicked, in the cards' order; **Ctrl**- or **⌘**-click adds a card to the selection or takes it out; **[[key:selectAll]]** selects every card; the arrow keys move the selection. A click with Shift, Ctrl or ⌘ held only selects: on a link, the pencil or the ✕ it does nothing else. A double-click on a card, or **Return**, brings its file forward — or, for a file no pane holds, opens it again in a free pane [[edition:through the reference the browser gave when the file was opened since the page was last loaded; after a reload a file has to be opened again by hand||by its full path, as **File ▸ Open Recent** does]] — and selects the place, as a step of the navigation history ([[topic:navigation|Moving Around]]): **[[key:back]]** returns to the **Annotations** panel. A panel standing over the dump is folded. In a firmware image **UEFI Structure** opens beside the dump at the node the place is in, as a click on a Contents search result does. A place in decompressed or decoded bytes opens in a fragment panel of those bytes, with the place selected and **UEFI Structure** in that panel open to the node that holds it. When both panes already hold a file, the file opens [[edition:in a new browser tab||in a new window]], and the place is selected there; neither pane is closed for it. [[edition:A browser lets a page open a tab only in answer to a click: if access to the file has to be requested first and the answer takes long, no tab is opened and the program says so; a second double-click opens it. ||]] If the file has been moved or deleted since, the program says so; if the file is in place but cannot be opened, the program states the reason.

The ✕ on a card removes that annotation; **Delete** removes the selected cards. The cards after a removed one move up to close the gap. Relations to a removed annotation go with it. **[[key:undo]]** puts the cards last removed back where they stood, with their relations, and **[[key:redo]]** removes them again; this lasts [[edition:while the page is open, not past a reload||while ByteRipper runs, not past a restart]].
