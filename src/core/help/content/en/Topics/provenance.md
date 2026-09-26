# Where This Knowledge Comes From

> Worth reading once, before you trust a panel with a board.

The firmware panels name structures that **no vendor has published a specification for**. Not the Intel ME's partition table, not its manifests, not its file system, not its unlock tokens. What the panels know is reverse engineering, and being straight about that is part of the tool.

## What the decode is based on

- **Independent reverse-engineering projects.** The ME decode follows ME Analyzer; the UEFI decode follows UEFITool. Both are long-running community projects read and corrected by many people.
- **Intel's own tools and their vocabulary.** Intel's Flash Image Tool *writes* these structures, and its configuration files name the settings and the paths. Where a field is called "OEM configurable", that phrase is Intel's. The byte layout behind it is not published anywhere.
- **Intel's high-level papers** — the public CSME security white paper, the debug-unlock collateral — name the components and the concepts (the boot flow, anti-rollback, [[term:svn|SVN]] and [[term:vcn|VCN]]) without giving a single offset. The one adjacent structure with real vendor documentation is the [[term:flash-descriptor|flash descriptor]], described in the chipset programming guides.
- **Cross-checks between independent efforts.** Separate research into ME internals describes the same volumes, chains and integrity tables that this decode produces, arrived at separately. Agreement between independent efforts is the strongest external evidence there is here.
- **Bench lore, marked as such.** Some of what the glossary says is not decode at all: where a vendor tends to hide a serial number, what an embedded controller's firmware usually starts with, which NVRAM variable holds a password. That comes from repair communities — the *UEFI Repair Guide* wiki among them — and no datasheet backs it. The help says so wherever it is used: those are signs to check against a known-good dump, never a diagnosis on their own.
- **The bytes themselves.** [[term:crc|CRCs]] that check out, hashes and nonces sitting exactly where a table's flag says they are, declared lengths that match, offsets that land on the structures they promise. That is verification of the *interpretation* without a specification — and it is what the panel can honestly claim.

## How the panels behave about it

- **A field nobody has documented keeps its raw value** and is labelled unknown or reserved. It is never given a confident-sounding name that would only be a guess.
- **A name from a catalogue is marked as such**, and a name is never mixed with a measurement: the size comes from the flash, the name comes from a [[topic:databases|database]].
- **A verdict is a verdict.** "This checksum does not match" is a fact about the bytes. "This is firmware version 11.8.50.3399" is a fact about the version field. "This is a Lenovo ThinkPad image" is not something the panel will tell you.

## What that means for you

Use the panels to **find things and to check things**: where a region begins, whether a checksum matches, whether an address points at what it claims. That is the part that rests on the bytes.

Be careful using them to **conclude things** about firmware that is signed and verified. A structure this tool reads correctly can still be one the platform refuses for a reason nothing in the image shows. When a panel is uncertain, it says so — believe it.
