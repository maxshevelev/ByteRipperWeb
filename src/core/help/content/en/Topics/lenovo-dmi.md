# Lenovo DMI

> The store in which Lenovo InsydeH2O firmware keeps a machine's identity — serial number, UUID, machine type and model, the Windows key — as the UEFI Structure tree reads it.

@covers panel.uefi.open-decoded-block

**Tools ▸ UEFI Structure** reads the identity store of a Lenovo InsydeH2O image as one row of its tree, **Lenovo DMI**, and decodes what it holds. **Show DMI Area** in the panel's title row goes to that row, however deep in the tree it lies ([[topic:tool-uefi|UEFI Structure]]).

A search of the dump for a serial number known from the sticker finds nothing on these machines: Lenovo does not keep the [[term:dmi|DMI]] fields in plain text but in a store of its own, with every byte XORed with a key. The tree shows that store in readable form.

## Where the store is

The store is three consecutive areas: the [[term:ldbg|LDBG]] change log, 8 KiB, followed by two [[term:lenv|LENV]] blocks of 4 KiB each. Its position in the image differs from one board to another, so the tree locates it by the `LDBG` signature, on a 4 KiB boundary, and accepts it only if at least one of the two blocks carries the `LENV` signature at the expected place. On the images examined, the Insyde [[term:flash-device-map|flash device map]] declares the same three areas as regions of type Unknown; the tree shows the store's row in their place. On an image without the map the row is read out of the padding it lies in.

If the image holds no store, the tree has no such row and the title row has no **Show DMI Area**. Either the image belongs to another platform, or the area has been cut out of it.

## What the tree shows

- **The store's row** sums the store up in its details: **Block in use** names the block the firmware reads and its generation, **Entries in use** lists what that block holds — the serial number, the UUID, the model and the Windows key first — and a click on an entry there opens its row. A **Problem** or a **Note** follows for an empty store, a checksum that does not match, an erased block or blocks that disagree.
- **Under it**, the change log and both blocks. A block's row gives its generation, and its **Subtype** says whether it is **In use**. A lock on the row says the block is stored encoded; an open lock, on the row of a block opened decoded, that its entries are in the clear there. An entry's row gives its value beside its name; a record of the log gives its date, its operation and the entry.
- **The details** of a block or an entry describe its fields; the `?` beside the name explains the term.

As everywhere in the tree, the row in focus is outlined in the dump, and the details' text can be selected and copied.

## Which block the firmware reads

The store is kept twice, in **LENV block 1** and **LENV block 2**, so that a write interrupted by a power loss leaves one intact copy. Each block header carries a **generation**: a counter that grows as the firmware rewrites the store. On every working dump examined the two generations differ by one — 127 and 126, say — and the block with the higher number holds the more recent state. That fits a firmware that writes each new copy over the older block and numbers it one higher; the code doing so has not been read here.

The block with the higher generation is the one the firmware reads; the tree marks it **In use**. This rule comes from the reverse-engineering of `LenovoVariableDxe` by LenovoDMIDecryptor, and the dumps examined agree with it: the entry that the last record of the change log removes is absent from the block with the higher generation and still present in the other. When both generations are equal, the tree takes block 1, as LenovoDMIDecryptor does.

A generation of **0** does not occur on a working board. It is what a block shows when its header has been cleared, as on a store that was wiped: the firmware does not read such a block. If both blocks show 0, there is no copy to read. A block whose every byte is `FF` has been erased and never written again; the tree calls it erased, and the firmware reads the other copy.

Whether the firmware passes over a block whose checksum does not match and reads the other one instead is not known; the details state this where it applies.

The two blocks may hold different values. This is normal after a write: the older copy keeps the previous values. A value to be carried to another dump is therefore taken from the block in use, and the details of every entry state under **Other copy** whether the other block holds the same value.

## Open Decoded Block

**Open Decoded Block**, on the context menu of a block's row or of any entry's row in it — and a double click on either row — opens the whole block as a [[topic:fragments|fragment panel]] with its entries decoded: the serial number and the machine type read as text in the hex view and can be edited there. The header stays as stored, so the key and the checksum are visible at their own addresses.

**Update in Parent** writes the block back encoded with the key in its header and with its checksum recomputed, as one undo step in the dump. The block keeps its length and its generation, and nothing is added to the change log. Only the block that was opened is written; to change both copies, open and update each. The fragment's header carries an **XOR** badge with the key, which says that its bytes are not the file's own.

**Tools ▸ UEFI Structure** opened on that fragment shows the block as a row of its own, **LENV block**, with its entries under it, read the same way as in the dump. There is no change log and no second copy in a fragment, so the details do not say which copy the firmware reads. The checksum in the header is the one the block carries encoded, and the details report it valid as such. After an edit in the fragment it no longer matches and is shown in red with the value it should have; Update in Parent writes that value.

The command is offered for a block that holds entries and whose encoding was recognised; it is not offered for an empty block or for the change log.

## The entries

An entry is filed under a namespace and a type. For the SMBIOS namespace the following types are known: the Windows key, the OA3 key ID, the motherboard name, the machine type and model (MTM), the baseboard serial number, the system UUID, the baseboard platform ID and the OS preload suffix. The tree names these and shows their values as text, the UUID in the byte order SMBIOS uses.

Real images carry further types whose meaning has not been documented. The tree calls them unknown, gives their type number and shows the value as text where every byte is printable and as hex otherwise. The flags of an entry, and two fields of every entry that are zero on all images examined, are shown as they are.

**Read by the firmware**, in the details of an entry, names the drivers of this image that ask the firmware for that entry. The tree finds them by searching the code of every driver in the image for the entry's key, compressed sections included, after the store is shown; the line appears when that search is done, on the images examined within seconds. On those images, for example, `InstallMsdm` reads the Windows key and builds the ACPI MSDM table from it, and `L05SmbiosOverride` or `OemUpdateSMBios` reads the entries the SMBIOS tables are filled from — which says what an entry is for even where its meaning has not been documented. A driver that computes the key at run time rather than naming it by constant is not found, so **No driver in this image names it** means that no driver names it by constant. The line is not shown for a block opened on its own in a fragment, which has no firmware around it.

## The Windows key entry

The Windows key entry holds the product key behind a 20-byte header. The header is the licensing structure of the ACPI [[term:slic|MSDM]] table, as Microsoft's specification ([[web:https://learn.microsoft.com/en-us/previous-versions/windows/hardware/design/dn653305(v=vs.85)|Microsoft Software Licensing Tables (SLIC and MSDM)]]) defines it and the Firmware Test Suite checks it ([[web:https://lists.ubuntu.com/archives/fwts-devel/2015-July/006546.html|fwts MSDM test]]). All fields are 32-bit, little-endian:

- **Version** — 1 on every dump examined; the test suite does not check it.
- **Reserved** — zero.
- **Data type** — 1, a product key.
- **Data reserved** — zero.
- **Data length** — 29 (`1D000000`), the length of the key.
- **Data** — the key itself, `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`.

The first 16 bytes are therefore always `01000000 00000000 01000000 00000000`, and the details treat them as a signature. The value shown is the key alone; the header is described in the details under **Key header**. The key is separated from the header only when the signature is there and the length the header gives is the number of bytes that follow; otherwise the entry is shown as bytes and marked as a problem, and **Key header** says which of the two did not hold.

## The change log

The log records what the firmware wrote to the store and when: the date and time from the real-time clock, the operation, the entry and the number of bytes. It records writes, not values. A record written before the clock was set shows its bytes instead of a date. A **Set** of zero bytes is shown as **Remove**: on the images examined the entry is absent from the newer block afterwards.

## What is known and what is not

The format was reverse-engineered from `LenovoVariableDxe` by the [[web:https://github.com/Shmurkio/LenovoDMIDecryptor|LenovoDMIDecryptor]] project; the same author's [[web:https://github.com/Shmurkio/LenovoVar|LenovoVar]], which reads and writes the store through the firmware's own protocol, confirms the entry types and the byte order of the UUID. The reading has been checked against real dumps. Where its description and the dumps disagree, the reading follows the dumps: a log record is 32 bytes long, although the field offsets in that description add up to 24, and the year in a log record is a BCD century followed by a BCD year rather than 2000 plus a byte.

Not confirmed: what the write-protect bits of a block and of an entry cause the firmware to do, and what the unknown types and fields hold. The change log does not always share the blocks' key: on one dump examined the blocks are encoded with `A0` and the log with `88`. The log's free space is zeros encoded, so a run of one byte after its last record gives its key, and the tree takes the key from there.

! The tree itself changes nothing in the store: an edit is made in a fragment opened with Open Decoded Block and written back with Update in Parent, and whether the board then boots with the new values has not been confirmed. A store that is empty on both blocks has been wiped or was never written: the board's serial number and UUID are not in this image, and they have to be taken from an earlier dump of this board, if one was kept, or from the sticker.

See also: [[topic:recipe-board-data|Data Unique to a Board]], [[term:dmi|DMI]].
