# Checksums

> Which structures of a firmware image carry a checksum, which of them the program verifies, and which of them it can write.

Many firmware structures carry a [[term:checksum|checksum]] over their header or over their body. When a byte inside such a structure is changed and the stored checksum is left as it was, the structure no longer agrees with its own checksum, and whatever reads it — the firmware, a programming utility, a parser — treats it as damaged.

## What the UEFI tool verifies

[[topic:tool-uefi|UEFI Structure]] verifies the headers it decodes as it reads them:

- A node whose checksum does not agree is marked in red on its row.
- The detail list reports the value stored in the structure and the value it should hold.
- **Fix Checksum** in the node's context menu writes the correct value. It is one write and one undo step, and the bytes are shown in red until the file is saved ([[topic:saving|Saving]]).

The command covers three kinds of node:

- **A firmware volume** — the checksum in its header.
- **An FFS file** — its header checksum, and its body checksum. Where the file's checksum attribute bit is not set, the stored body value is instead the fixed value belonging to the revision of the containing volume, and the command writes that.
- **A microcode component** — the checksum in its header.

It does not act on a node inside a compressed section: the file holds those bytes compressed, and the tool does not compress them again. The command reports this rather than writing anything.

## What the FIT tool verifies

[[topic:tool-fit|FIT Table]] verifies the checksum of the table itself and reports a mismatch in its problem list, giving the stored value and the correct one. **Fix Checksum** in the header row's context menu writes it. Where the image keeps an identical [[term:top-swap|Top Swap]] backup of the block, the value is written in both copies, and the tool says so.

A microcode file offered to **Add Microcode…** is verified before it is written: its checksum must agree. See [[topic:recipe-microcode|Microcode and the FIT]].

## What a mismatch indicates

A checksum that does not agree is a fact about the bytes. It admits more than one explanation, and the tool does not choose between them:

- the structure has been edited and the checksum has not been rewritten;
- the bytes of the structure differ from what was written, which in a dump read from a chip is a property of the read as much as of the chip;
- the structure is not what the parser took it for, in which case the mismatch is a statement about the interpretation rather than about the bytes. The tools report where they are uncertain; see [[topic:provenance|Where This Knowledge Comes From]].

## What Fix Checksum cannot do

The command writes **checksums** — arithmetic sums and [[term:crc|CRC]] values, which are computable from the bytes they cover by anyone who holds the bytes.

It does not write **signatures**. A cryptographic signature over an area cannot be recomputed without the manufacturer's private key. Where the area is covered by [[term:boot-guard|Boot Guard]] or by an ME manifest, no editor can produce a signature the platform will accept; this is a property of the platform. See [[topic:flash-writes|Who Writes to the Flash]] and [[topic:bench-safety|Constraints on Editing an Image]].
