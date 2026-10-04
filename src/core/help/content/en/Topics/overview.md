# What ByteRipper Is For

> A hex editor for firmware images, built around the comparison of two dumps at equal addresses.

@covers shell.empty-state
@covers menu.help.book
@covers toolbar.help

ByteRipper opens one or two binary files, displays every byte of them and allows every byte to be edited. When two files are open it compares them **byte by byte at the same address** and marks every address at which they disagree.

The files it is designed for are firmware dumps: the contents of a BIOS chip, an embedded controller or an ME region, read from a board with a programmer or obtained as a file.

## What the program does

- Compares two images and reports every address at which they differ.
- Reports the proportion of an image that differs, and moves between the differing areas.
- Edits individual bytes and writes the result back to a file.
- Decodes the structure of a firmware image — its regions, its volumes, its Intel ME partitions — and reports what it contains and whether the structures are internally consistent.
- Extracts a part of an image — a region, a module, a decompressed section — as a separate document, and writes it back.

## What the program does not do

ByteRipper compares by absolute address only. It does not search for the same block of bytes at a different address, and it does not shift one file against the other to reduce the number of differences reported.

This is a deliberate property. A flash dump has a fixed layout in which an address is a position on the chip: a byte that has moved is at the wrong address, and the presence of an identical byte nearby does not alter that. A comparison that aligned two dumps against each other would conceal exactly the discrepancies the comparison is performed to find.

! ByteRipper does not communicate with a programmer and does not write to hardware. It edits files. Reading a chip and writing it back are performed by the programmer.

## Reaching this book

The **?** in the toolbar opens the same short list as the **Help** block of the toolbar's menu: this page, the first comparison, the editing constraints and the glossaries. **F1** and **[[key:help]]** open the book from anywhere in the application, with no file open and whatever has the keyboard.

## Where to go next

- [[topic:first-comparison|Your First Comparison]] — the comparison of two files, step by step.
- [[topic:hex-view|Reading the Hex View]] and [[topic:colors|What the Colours Mean]].
- [[topic:tools-overview|The Tool Panels]] — decoding the structure of an image rather than only its differences.
- [[topic:bench-safety|Constraints on Editing an Image]] — the properties of a firmware image that limit what may be changed in it.
