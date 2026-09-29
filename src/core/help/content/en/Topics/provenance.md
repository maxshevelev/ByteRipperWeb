# Where This Knowledge Comes From

> The basis on which the tool panels decode structures for which no specification has been published.

The tools name structures for which **no manufacturer has published a specification**: the Intel ME's partition table, its manifests, its file system and its unlock tokens are all in that category. What the tools hold is the result of reverse engineering, and the book states this rather than leaving it to be assumed.

## What the decode is based on

- **Independent reverse-engineering projects.** The ME decode follows ME Analyzer; the UEFI decode follows UEFITool. Both are long-running community projects read and corrected by many people.
- **Intel's own tools and their vocabulary.** Intel's Flash Image Tool *writes* these structures, and its configuration files name the settings and the paths. Where a field is called "OEM configurable", that phrase is Intel's. The byte layout behind it is not published anywhere.
- **Intel's high-level papers** — the public CSME security white paper, the debug-unlock collateral — name the components and the concepts (the boot flow, anti-rollback, [[term:svn|SVN]] and [[term:vcn|VCN]]) without giving a single offset. The one adjacent structure with real vendor documentation is the [[term:flash-descriptor|flash descriptor]], described in the chipset programming guides.
- **Cross-checks between independent efforts.** Separate research into ME internals describes the same volumes, chains and integrity tables that this decode produces, arrived at separately. Agreement between independent efforts is the strongest external evidence there is here.
- **Observations from repair practice, identified as such.** Part of what the glossary records is not decoding at all: where a manufacturer tends to place a serial number, what an embedded controller's firmware usually begins with, which NVRAM variable holds a password. This comes from repair communities — the [[web:https://github.com/ISpillMyDrink/UEFI-Repair-Guide/wiki|UEFI Repair Guide]] wiki among them — and no datasheet supports it. The book says so wherever it relies on such an observation, and links to the source, so that a statement which cannot be looked up in a datasheet can at least be traced to whoever recorded it.
- **The bytes themselves.** [[term:crc|CRC]] values that agree, hashes and nonces located exactly where a table's flag states they are, declared lengths that match, addresses that land on the structures they name. This verifies the *interpretation* in the absence of a specification, and it is what a tool can claim on its own evidence.

## How the tools behave about it

- **A field nobody has documented keeps its raw value** and is labelled unknown or reserved. It is never given a confident-sounding name that would only be a guess.
- **A name from a catalogue is marked as such**, and a name is never mixed with a measurement: the size comes from the flash, the name comes from a [[topic:databases|database]].
- **A statement is limited to what it rests on.** "This checksum does not agree" is a statement about the bytes. "This is firmware version 11.8.50.3399" is a statement about the version field. "This is a Lenovo ThinkPad image" is not a statement a tool makes.

## The limits of the decoding

The tools **locate and verify**: where a region begins, whether a checksum agrees, whether an address points at what it declares. These results rest on the bytes of the file.

They do not establish whether a signed and verified firmware will be accepted by a platform. A structure decoded correctly may still be one the platform refuses for a reason that is not represented in the image at all. Where a panel is uncertain, it reports the uncertainty rather than resolving it.
