# What ByteRipper Is For

> A hex editor built around one question a repair bench asks all day: how is this chip's contents different from the one that works?

@covers shell.empty-state
@covers menu.help.book
@covers toolbar.help

ByteRipper opens one or two binary files and shows every byte of them. When two files are open it compares them **byte by byte at the same address**, and paints every place they disagree.

That is the whole idea. On a repair bench the file is usually a **dump** — the contents of a BIOS chip, an EC chip or an ME region, read off the board with a programmer. The question is almost never "what does this file mean" but "what is wrong with this one compared to one that boots".

## What it is good at

- Comparing a dead board's dump against a working board's dump, or against a donor file from the internet.
- Finding the handful of bytes that actually differ between two firmware versions.
- Patching a few bytes by hand and writing the file back out for the programmer.
- Taking a firmware image apart — its regions, its volumes, its Intel ME partitions — to see what is in it and whether it is intact.
- Cutting a piece out of a dump (one region, one module) and saving it as its own file.

## What it deliberately does not do

ByteRipper compares by address only. It never tries to find the same block of bytes at a different address, and never shifts one file against the other to make the differences look smaller.

That is on purpose. A flash dump has a fixed layout: an address is a position on the chip, and a byte that moved is a byte in the wrong place, not a byte that matched. A tool that "aligned" two dumps would hide exactly the faults worth finding.

! ByteRipper never talks to a programmer and never writes to hardware. It edits files. Reading the chip and writing it back is your programmer's job.

## Reaching this book

The **?** in the toolbar opens the same short list the **Help** block of the toolbar's menu holds: this page, the first comparison, the bench rules and the glossaries. **F1** and **⌘/** open the book from anywhere in the app, with no file open and whatever has the keyboard.

## Where to go next

- [[topic:first-comparison|Your first comparison]] — the five minutes that show what the app is.
- [[topic:hex-view|Reading the hex view]] and [[topic:colors|What the colours mean]].
- [[topic:tools-overview|The tool panels]], once you want to know what is inside the image rather than only what changed.
- [[topic:bench-safety|Bench rules]] — ways to ruin a dump, and how to avoid them.
