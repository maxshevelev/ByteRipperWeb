@term me
@name Intel ME / CSME
@short A small processor inside the chipset, with its own firmware in its own region of the flash.

The Management Engine — on newer platforms the Converged Security and Management Engine — runs independently of the main CPU, starts before it, and handles power management, provisioning, firmware-based TPM and vendor management features.

Its firmware lives in the [[term:me-region|ME region]] of the same SPI chip as the BIOS, in a completely different format. Everything else in this glossary is a piece of that format.

! The engine verifies its own firmware before running it. Editing the region by hand produces a board that hangs or reboots on a timer, not a patched engine.

@see topic:tool-me
@see topic:recipe-me-check

@term fpt
@name Flash Partition Table (`$FPT`)
@short The table of contents of the ME region: what partitions it holds and where each one begins.

`$FPT` is the first structure the analysis looks for. Each row names a partition — by a four-character name like `FTPR`, `NFTP`, `MFS`, `UTOK` — and gives its offset, its size and some flags.

On a bench the `$FPT` answers "is this region complete?". If a partition the table declares is not actually there, or its size does not match, the region is truncated or damaged.

@see term:cpd
@see topic:recipe-me-check

@term cpd
@name Code Partition Directory (`$CPD`)
@short The directory at the start of a code partition: the list of modules in it.

Where [[term:fpt|$FPT]] lists the partitions of the region, a `$CPD` lists the **modules** inside one partition — the engine's own executables and their metadata.

The first module of a boot partition is its [[term:manifest|manifest]]. Module bodies are often [[term:huffman|Huffman]]- or LZMA-compressed.

@see term:fpt
@see term:manifest

@term manifest
@name Manifest (`$MN2` / `$MAN`)
@short The signed header of a partition: its version, its date, its security numbers and a cryptographic signature over its contents.

The manifest is where most of what the Summary tab shows comes from: the firmware version, the build date, the [[term:svn|SVN]], the [[term:vcn|VCN]], the RSA public key and the signature itself.

It is also what makes a partition impossible to edit usefully: the signature is over the partition's contents, and it cannot be recomputed without Intel's private key.

@see term:signature
@see term:svn

@term cse-extension
@name CSE extension (`CSE_Ext_xx`)
@short A block of extra information attached to a manifest, identified by a number.

After a manifest comes a chain of extension blocks, each with a tag: which modules the partition holds and their hashes, which SKU it is for, which chipset, which features are enabled.

Some tags are well understood and named; the rest are shown by their number with their raw contents, because giving an undocumented block a confident name would be a guess. See [[topic:provenance|Where this knowledge comes from]].

@term svn
@name SVN (Security Version Number)
@short A counter that only ever goes up, so that old firmware cannot be put back.

When Intel fixes a security problem, the fixed firmware carries a higher SVN. The platform records the highest SVN it has seen and refuses anything lower — that is anti-rollback.

On a bench this is why a downgrade can fail silently: the image is fine, and the platform rejects it anyway. **TCB SVN** is the same idea for the trusted computing base.

@see term:arb-svn
@see term:vcn

@term arb-svn
@name ARB SVN (Anti-Rollback SVN)
@short The anti-rollback counter, as the image declares it.

The value the firmware carries for the anti-rollback check described under [[term:svn|SVN]]. If you are moving firmware between boards, an ARB SVN lower than what the target board has already recorded is a firmware the board will not accept.

@see term:svn

@term vcn
@name VCN (Version Control Number)
@short A configuration-compatibility counter, separate from the version.

The VCN says whether the firmware's *configuration* format has changed. A firmware update with a different VCN cannot simply carry the old configuration over — the settings have to be re-created.

Practically: two images of the same version with different VCNs are not interchangeable in the way you would expect.

@see term:svn

@term mfs
@name MFS (ME File System)
@short The engine's own file system inside the region: its configuration and its state.

MFS is a paged area holding files — the engine's configuration, provisioned values, logs and state. ByteRipper walks the pages, reassembles the chunks and lists the files, naming the ones that are known.

This is the part of an ME region that is **board-specific**: two boards with the same firmware version have different MFS contents. A donor ME region brings the donor's.

@see term:efs
@see topic:recipe-board-data

@term efs
@name EFS (Extended File System)
@short The newer layout's equivalent of [[term:mfs|MFS]], as its own partition.

On CSME 15 and later the configuration moved into its own flash partitions — EFS, and `FITC` for the OEM-configurable part — rather than living inside a module body. Same role: the engine's files and settings.

@see term:mfs
@see term:fitc

@term fitc
@name FITC / OEM Configuration
@short The settings the board vendor chose, written by Intel's Flash Image Tool.

FIT (Flash Image Tool) is Intel's own utility for assembling a flash image; the vendor uses it to set the engine's options for a board. What it wrote is this partition, and the panel labels it "OEM Configuration".

The names of these settings — and phrases like "OEM configurable" and paths such as `/home/bup/si_features` — are Intel's own, from that tool's configuration files.

@see term:oem-config
@see topic:provenance

@term oem-config
@name OEM Configuration
@short The board vendor's engine settings, as records in the image.

Board-specific by definition: this is where the vendor said what this particular board's engine should do. Copying it from a donor copies the donor's decisions.

@see term:fitc
@see topic:recipe-board-data

@term me-configuration
@name ME region configuration
@short The board-specific part of an ME region — everything in it that is not Intel's own code.

An ME region is mostly firmware Intel wrote, identical across every board of its generation. Mixed into it is a small amount that belongs to *this* board, written by the vendor with Intel's Flash Image Tool:

- **`fitc.cfg`** — the tool's own configuration module, inside the operational [[term:cpd|`$CPD`]].
- **`FITC`, `CDMD`, `MFSB` partitions** — configuration carried as partitions in their own right.
- **[[term:oem-config|OEM Configuration]] records** — the vendor's answers, kept in [[term:mfs|MFS]] or [[term:efs|EFS]].
- **[[term:utok|UTOK]] and OEM permission records**, where a board has them.

Some of it describes the *board*: how many SPI chips, which engine features are enabled, what the platform is allowed to do. Some of it describes the *machine*, written by the engine once it had run.

That split is the reason an ME region from a donor is not simply interchangeable. It carries the donor's answers to both kinds of question.

@see term:file-system-state
@see topic:recipe-board-data

@term file-system-state
@name File System State
@short How far the engine's own file system has been set up: Unconfigured, Configured or Initialized.

The [[term:mfs|MFS]] or [[term:efs|EFS]] volume is the engine's file system. What is inside it says how far this image has travelled from the stock firmware Intel ships, and the [[topic:tool-me|ME panel]] reports it as one row.

- **Unconfigured** — nothing in the volume says it has been set up at all. A clean image, as it comes from Intel.
- **Configured** — the vendor's settings are present: OEM Configuration or home-directory files in the volume, or a configuration partition in the image. The board maker has written its answers; the engine has not necessarily ever run.
- **Initialized** — the volume holds the low-level files the engine creates for itself. The file system has been initialised in place.

Why it matters before you write anything to a board: it tells you what kind of image you are holding. A stock Intel region is Unconfigured and carries no board settings whatsoever; a dump taken off a working machine is Initialized and carries that machine's. Putting one where the other belongs is how a board comes up without its settings — or with somebody else's.

! A clean region being Unconfigured is not a fault. That is how it is supposed to arrive; the vendor's tool and then the engine itself fill it in.

@see term:me-configuration
@see topic:recipe-me-check

@term hap
@name HAP bit
@short A [[term:soft-straps|soft-strap]] in the flash descriptor that makes the engine stop after its early boot.

Intel added it for a United States government programme, the High Assurance Platform, and it is what the ME-disabling tools set. On ME 11 and newer it is called HAP; the equivalent on older generations is known as AltMeDisable. Either way it lives in the descriptor's PCH strap section, not in the ME region.

The engine still starts and still verifies its own firmware. The bit only stops it going further.

ByteRipper does not decode it. Its position moves with the chipset generation and Intel does not document it, so the descriptor panel says how many strap words there are and leaves reading a particular bit to a tool built for that.

! Setting this bit is not a repair. A board whose ME region is actually damaged usually will not come up at all, and disabling the engine afterwards does not change that.

@see term:soft-straps
@see term:flash-descriptor

@term ptt
@name PTT
@short "Platform Trust Technology" — a TPM provided by the Management Engine, with no separate chip.

With PTT enabled the engine presents a TPM to the operating system. On most laptops that is where BitLocker's keys live, which is why work that resets the engine's state can leave a disk nobody can unlock.

PTT can also be permanently disabled in the chipset's [[term:otp|fuses]] at the factory.

! Before touching the ME region of a machine with an encrypted disk, ask about the recovery key first. Afterwards is too late.

@see term:me
@see topic:bench-safety

@term amt
@name AMT
@short "Active Management Technology" — remote administration served by the engine, independent of the operating system.

AMT is the feature the Management Engine was built around: an administrator can reach the machine over the network while it is switched off or its operating system is dead. It appears on business models, and the provisioning that goes with it is part of what the engine keeps in [[term:mfs|MFS]].

@see term:me
@see term:mfs

@term me-power-states
@name M0 / M3 / M-Off
@short The engine has power states of its own, which is why it can be running while the machine is "off".

- **M0** — the engine is running and the host is on.
- **M1** and **M3** — the engine is fully powered while the host is not. In M3 main memory is not available to it.
- **M-Off** — the engine is shut down; nothing is powered.

Which of these a given platform actually implements depends on its design. The practical point for a bench: a machine that is plugged in is not an inert machine.

@see term:me

@term mfs-backup
@name MFS backup (`MFSB`)
@short A spare copy of the file system, for recovering from a corrupted one.

An area opening with the `MFSB` signature instead of a page tag. Its presence is normal. If the *main* MFS area starts with that signature, the volume is in an unusual or damaged state.

@see term:mfs

@term integrity-table
@name Integrity table
@short Hashes and counters that let the engine detect a file that was changed behind its back.

Each protected file in the [[term:mfs|file system]] has an entry recording what it should hash to, with a nonce and an [[term:anti-replay|anti-replay]] counter. The engine checks it before trusting the file.

On the bench: this is why you cannot edit a value in the ME file system and expect it to be used. The edit is detected.

@see term:anti-replay

@term anti-replay
@name Anti-replay
@short Protection against putting an old, valid copy of data back.

A signature or hash proves bytes were not modified — but an *old* set of bytes is also unmodified. Anti-replay adds a counter that the engine keeps track of, so a previous valid state cannot be restored.

This is why saving an ME region and restoring it later does not always work the way you would expect.

@see term:integrity-table
@see term:svn

@term huffman
@name Huffman module
@short A module compressed with Intel's own Huffman scheme, needing a dictionary to unpack.

The engine's code modules are compressed; some with LZMA, some with a Huffman scheme whose dictionaries are not published. ByteRipper fetches the community dictionaries with the [[topic:databases|ME database]] and can unpack the common versions.

A module the panel shows as Huffman but cannot expand is a module whose dictionary version is not available — not damage.

@term iup
@name IUP (Independently Updated Partition)
@short A partition with its own version and its own update cycle: PMC, PCHC, PHY and friends.

Parts of the platform firmware are shipped and updated separately from the engine itself — the Power Management Controller, the chipset configuration, the USB Type-C physical layer. Each has its own manifest, version and chipset target.

On a bench: an IUP from a different chipset stepping is a real incompatibility, even when the engine version matches. The panel names the chipset and stepping each IUP is built for.

@see term:cpd

@term rbe-pm
@name RBE / BUP / `pm`
@short The engine's earliest boot modules, and the metadata tables inside them.

`RBE` and `BUP` (bring-up) are the first code the engine runs; `pm` is the power-management module. Their bodies carry metadata tables that name hardware by vendor and device ID, which is what lets the panel say which silicon a firmware is for.

Deep internals. Useful to read, not useful to edit.

@term utok
@name UTOK / STKN — unlock token
@short A signed token that unlocks debug features on a specific part.

A debug unlock token, if present, is its own partition (`UTOK` or `STKN`), ending with a flags structure (`UTFL`). It is signed and bound to a particular part, so it cannot be moved between boards.

Its presence in a production dump is unusual and worth noticing.

@term pch-init
@name Chipset Initialization Table
@short Per-chipset initialisation data the engine applies early in the boot.

A table of records, each naming a chipset and the steppings it applies to. This is one of the places where an image is tied to specific silicon: an image whose initialisation table does not cover the chipset in front of you is an image for a different board generation.

@term sku
@name SKU
@short Which variant of the firmware this is: Consumer, Corporate, Slim, and the chipset letter with it.

Intel builds several variants of each engine firmware. "Consumer H", "Corporate LP" and so on combine the feature set with the chipset the firmware targets.

A mismatch between the SKU in the image and the board is a common reason a donor ME region does not work: the version matches, the variant does not.

@see term:iup

@term gsc
@name GSC
@short Graphics System Controller firmware — the same container format, for a graphics device.

Some images are not chipset engine firmware at all but firmware for a graphics device, using the same `$FPT`-and-manifests layout. The panel recognises them and reads the "INFO" partition that describes the image and the partitions in it.

@term orom
@name Option ROM (OROM)
@short Firmware for a device, executed by the platform during boot.

An option ROM is a small piece of code a device carries so the platform can use it before an operating system loads — a RAID controller, a network boot ROM, a graphics BIOS. They appear inside firmware images as their own images with their own headers.

@term mme
@name `$MME` directory
@short The module directory of older, pre-CSE ME firmware.

The layout before `$CPD`: older generations of ME firmware list their modules in a `$MME` directory instead. If you see this, the image is from an older platform generation, which also means the rest of the layout differs from what the newer entries here describe.

@see term:cpd

@term cse-layout-table
@name CSE Layout Table
@short The map of a whole-flash IFWI image: where the boot, data and temporary areas are.

On newer platforms the flash holds an IFWI image whose parts are described by a layout table rather than by a single `$FPT`. The panel reads it to find where the partition table itself lives.

@see term:fpt
@see term:bpdt

@term bpdt
@name BPDT — boot partition descriptor table
@short The table describing the boot partitions of an IFWI image.

`BPDT` and its second level list the sub-partitions of the boot area: their names, offsets and sizes. It is the IFWI layout's equivalent of a partition table for the boot path.

@see term:cse-layout-table

@term fwupdate
@name FWUpdate support
@short Whether this image can be updated by Intel's own firmware update tool.

A property of the image, reported in the Summary. An image without it must be written with a programmer rather than updated in place.

@term production-ready
@name Production / pre-production
@short Whether the firmware is a released build or an engineering one.

A pre-production image in a customer's machine is unusual and worth noting: it may be signed with a different key, and it may behave differently from the released firmware of the same version.

@term redundant-copy
@name Redundant copy
@short The image carries two copies of a partition, so a failed update can fall back.

Normal on platforms that support in-field updates. Seeing it explains why a comparison of two dumps shows two nearly identical large blocks.
