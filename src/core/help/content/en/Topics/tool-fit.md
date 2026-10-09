# FIT Table

> The Firmware Interface Table: what the processor is directed to load before it executes firmware code, and whether those components are present.

@covers panel.fit

**Tools ▸ FIT Table** locates the [[term:fit|Firmware Interface Table]] in the image and lists its entries.

## How the tool finds the table

The flash memory is mapped to the end of the 32-bit address space, and at the fixed address `0xFFFFFFC0` lies a pointer to the table. The tool reads it, turns the address into a position in the file, and checks that the signature `_FIT_   ` is actually there. Only that pointer determines where the table is: within the image it may lie anywhere.

Where the pointer leads outside the image, or there is no signature at the address it names, the tool reports it in the problem list rather than presenting a decode arrived at by guesswork. Where the image does not state the offset at which it is mapped into the address space, the tool takes its last byte to fall at `0xFFFFFFFF` and marks the addresses as assumed.

## What the entries carry

Every entry carries an address, a size and a type: a [[term:microcode|microcode update]], an ACM, a Boot Guard manifest, a TXT policy record. The exception is a policy entry of version 0: its first eight bytes are a descriptor of Index/IO registers rather than an address, and the tool presents it as such rather than as a pointer.

## What the tool reports

- **The entries**, with their type, address and size, in the table's own order.
- **What each address actually holds.** The **Points at** column is not read from the entry: the tool follows the address and reports what is at it — a microcode update with a valid header, a manifest, an erased area, or nothing recognisable.
- **Every processor a microcode serves.** An update for several processors lists the others in an extended signature table behind its data, and a processor of such a set may have no update of its own: it is served by an update whose header names another processor. The **Points at** column names them all — the processor in the header first, then, after a `+`, those the table adds: `CPUID B06A2 + B06A3, B06A8`. The comparison with the catalogue and **Only CPUIDs in this image** take every one of them into account. A table that does not fit the update, or whose checksum does not match, is shown in the detail list and is not taken into account.
- **The rules of the table**: the header entry, the entry count, the checksum, the ordering of entries by type, the alignment of addresses, the reserved byte, two microcode entries serving the same processor on the same platforms, and the agreement between the table and its [[term:top-swap|Top Swap]] backup where the image keeps one. The problems found are listed under the table, and double-clicking one moves the dump to the bytes it concerns.
- **The identity of each microcode**, taken from an online catalogue by processor signature, revision and date. See [[topic:databases|The Online Catalogues]]; without network access the identifiers are reported and the names are omitted.

## What the tool changes

The tool writes to the image as well as reading it. Each operation is one undo step and none of them changes the length of the file.

- **Add Microcode…** in the panel's header places a microcode component in the image and enters it in the table. The list it offers is fetched from an online catalogue, and **Choose File…** takes a microcode from a local file instead.
- **Replace Microcode** exchanges the component a row names for another.
- **Remove Microcode** takes an entry out of the table and moves the components behind it up.
- **Fix Checksum**, on the header row, writes the checksum the table should carry.
- **Copy CPUID** and **Go to Offset** are on the context menu of a row.

The conditions under which these are refused, and what each of them writes, are set out in [[topic:recipe-microcode|Microcode and the FIT]].

While a change is being worked out, a window with its progress and a **Cancel** stands over the application and holds the file still; cancelling drops the plan and writes nothing. When the change ends, a second window says how: what was done, with a green check, or why it was not, with a red octagon. The panel's own status line says nothing of it.

! Where an image keeps a Top Swap backup of the block the table is in, a change is made in both copies, and the tool refuses the change where the two copies are not identical. A change that would write inside a [[term:boot-guard|Boot Guard]] protected range is refused outright.

See also: [[topic:recipe-microcode|Microcode and the FIT]], [[term:top-swap|Top Swap]].
