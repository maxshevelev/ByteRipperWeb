# Microcode and the FIT

> When a board stops posting entirely after a flash, this is where to look.

The CPU loads a [[term:microcode|microcode update]] before it executes any BIOS code, and it finds it through the [[term:fit|Firmware Interface Table]]. If that chain is broken the board is dead in the most literal way: no display, no beep, no post code past the earliest stages.

## Checking it

1. **Tools ▸ FIT Table.** If the panel finds no table at all in an image that should have one, that alone is the answer.
2. **Read the entries.** Each should have a plausible type, address and size.
3. **Read the "points at" column.** The panel follows every address and says what is really there. An entry that points at erased flash, or at something that is not a microcode update, is a broken entry.
4. **Read the problems the panel lists** — the table's own rules: the header entry, the count, the checksum, the ordering.

## Reading the microcode entries

Each microcode entry is named from the [[topic:databases|public catalogue]]: the CPU signature it is for, its revision and its date. That lets you check two things:

- **Is there a microcode for this CPU at all?** A board that gets a new CPU generation without a BIOS update is a board with no microcode for the chip in the socket.
- **Is the revision plausible?** A revision far older than the board's BIOS suggests an image from the wrong version — or a hand patch that replaced a newer update with an older one.

## Repairing

Take the region from a correct image for the same board and the same BIOS version, and put it back as bytes at the same addresses — overwrite, never insert. The addresses in a FIT are absolute: a microcode update moved by even one byte is a microcode update the CPU will not find.

See also: [[term:top-swap|Top Swap]], which is why some boards have two copies of the boot block and can survive a bad flash of one of them.
