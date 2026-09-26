@term flash-descriptor
@name Flash descriptor
@short The first `0x1000` bytes of an Intel flash image: the map of the chip.

The descriptor sits at the very start of the dump and says where every [[term:region|region]] begins and ends, which [[term:flash-master|masters]] may read or write each one, and how the chip's own straps are configured.

It is the one structure here with real vendor documentation — it is described in Intel's chipset programming guides — so what the panel says about it rests on more than reverse engineering.

On a bench it is the first thing to look at: if the descriptor is damaged, every offset that follows is unreliable, and the board usually will not start at all.

@see term:region
@see topic:tool-uefi

@term flash-master
@name Flash Master
@short A device on the board that can reach the flash chip: BIOS, ME, GbE or EC.

The [[term:flash-descriptor|descriptor]] does not grant access to programs. It grants it to *masters* — the four requesters the chipset tells apart on its own SPI bus:

- **BIOS** — the host, meaning whatever the CPU is running: the firmware itself, or a flashing utility under the operating system.
- **ME** — the [[term:me|Management Engine]], writing its own region.
- **GbE** — the wired network controller, for its own region.
- **EC** — the [[term:ec|embedded controller]], and only in descriptor version 2, from Skylake on.

Each master carries a read mask and a write mask, one bit per [[term:region|region]]. The masks govern writing through the chipset and nothing else: a [[term:programmer|programmer]] does not ask them, and the bytes go into any region. The difference shows at the next start — the [[term:acm|ACM]] checks the boot block, the engine checks its own region — and an edit inside the [[term:ibb|IBB]] or in the ME region ends up written and rejected. What those checks do not cover stays written, and works.

@see topic:flash-writes
@see term:flash-descriptor

@term descriptor-mode
@name Descriptor mode
@short Whether the chipset reads the flash as one flat BIOS or as a map of regions.

Up to ICH7 a firmware chip held BIOS code and nothing else: no descriptor, no regions, no access rights. From ICH8 the chipset can start in one of two ways. **Descriptor mode** puts a [[term:flash-descriptor|flash descriptor]] in the first `0x1000` bytes, dividing the chip into [[term:region|regions]] with independent permissions, and is what makes the [[term:me|Management Engine]], the [[term:gbe-region|GbE region]] and [[term:soft-straps|soft-straps]] possible at all. **Non-descriptor mode** is the old flat layout.

Every current Intel PCH requires a valid descriptor; non-descriptor mode is gone. So a dump from a modern board with no `0FF0A55A` signature near the start is a bad read or a partial image, not an old layout.

A board in descriptor mode may also spread its firmware across **two flash chips**. The image is then the two chips end to end — a 4 MB part followed by a 2 MB part is one 6 MB image — and both have to be read and joined before any of this parses. That is what [[topic:join-duplicate|joining a second dump]] is for.

@see term:flash-descriptor
@see topic:join-duplicate

@term soft-straps
@name Soft-straps
@short Chipset and CPU settings the descriptor carries, read at power-on before any firmware runs.

A strap is a configuration bit the silicon reads for itself. Hard-straps are resistors on the board; soft-straps are the same idea stored in the [[term:flash-descriptor|descriptor]], which is the only reason they are in a dump at all.

PCH straps say how many flash chips there are, how fast they may be clocked, whether the bus runs in dual or quad mode, and — among many others — the [[term:hap|HAP bit]] that soft-disables the Management Engine. CPU straps are mostly debug settings: core count, hyper-threading.

ByteRipper reports how many strap words the descriptor holds and not what each one means. Their layout changes with every chipset generation and almost none of it is published; a number the app cannot justify is a number it does not show.

@see term:flash-descriptor
@see term:hap

@term region
@name Region
@short A top-level area of the flash, defined by the descriptor.

The descriptor divides the chip into regions — descriptor, BIOS, ME, GbE, PDR, EC and others — each with a start and an end address. A region is the unit a bench usually moves between images, because each one is a self-contained format.

@see term:flash-descriptor
@see term:bios-region
@see term:me-region

@term bios-region
@name BIOS region
@short The firmware the CPU executes: volumes, files and sections.

The largest region on most images. Inside it are [[term:volume|firmware volumes]], and inside those the [[term:ffs-file|files]] and [[term:section|sections]] that make up the UEFI firmware itself — the boot code, the setup screens, the drivers.

This is the region a firmware update replaces, and the one most BIOS repairs are about.

@see term:volume
@see topic:tool-uefi

@term me-region
@name ME region
@short Intel Management Engine firmware — a separate processor's operating system, in its own region.

The ME (on newer platforms CSME) is a small independent processor inside the chipset with its own firmware, stored in its own region of the same flash chip. It runs before and alongside the main CPU and handles power management, provisioning and security functions.

It has nothing to do with the BIOS's own code and is a completely different format, which is why ByteRipper has a [[topic:tool-me|separate panel]] for it.

! The ME verifies its own firmware before running it. A hand-edited ME region does not become a patched ME — it becomes a board that hangs or reboots on a timer.

@see topic:tool-me
@see topic:recipe-me-check

@term gbe-region
@name GbE region
@short The integrated network controller's configuration — including the board's MAC address.

Small, and board-unique. Copying a donor's GbE region onto a board gives it the donor's MAC address.

@see topic:recipe-board-data

@term pdr-region
@name PDR region
@short "Platform Data Region" — an area the board vendor may use for its own data.

What is in it depends entirely on the vendor. Treat it as potentially board-specific: if a donor image has one and yours does, compare them before overwriting.

@see topic:recipe-board-data

@term ec-region
@name EC region
@short Firmware for the embedded controller — the small chip that runs the keyboard, fans, battery and power sequencing.

On laptops the EC firmware is sometimes in the same SPI chip as the BIOS, as its own region, and sometimes in a chip of its own. A board that does not power on at all, or that powers on and immediately shuts down, is often an EC problem rather than a BIOS one.

@term ifwi
@name IFWI
@short "Integrated Firmware Image" — a different whole-chip layout, found on Atom and TXE platforms.

Instead of the familiar separate regions, an IFWI image carries an IFWI region divided into two **Logical Boot Partitions** (LBP1 and LBP2, the same size as each other). Each begins with a [[term:bpdt|BPDT]] that lists the sub-partitions inside it: the engine's firmware, the IA firmware that is the BIOS, the power-management controller's, CPU microcode. A separate logical data region holds the non-volatile data and the UEFI [[term:nvram|NVRAM]].

Common where firmware is stored on eMMC rather than on an SPI part.

@see term:bpdt
@see term:region

@term volume
@name Firmware volume (FV)
@short A container inside the BIOS region, holding files. Its header starts with `_FVH`.

A firmware volume is the unit the firmware's own file system is built on. A BIOS region usually holds several: a boot block volume, one or more main volumes, an NVRAM volume.

A volume's header declares its length and its own checksum, and the space after its last file is its **free space** — which tells you how much room is left in it.

@see term:ffs-file
@see term:free-space

@term ffs-file
@name FFS file
@short One file inside a firmware volume, identified by a [[term:guid|GUID]].

Files are what a volume holds. Each has a GUID for a name, a type (a driver, an application, raw data, a volume image) and a header with its own checksums. Inside a file are [[term:section|sections]].

A row with a readable name like "DxeCore" is an FFS file whose GUID the [[topic:databases|catalogue]] recognises.

@see term:section
@see term:pad-file

@term pad-file
@name Padding file
@short A file that exists only to fill space so the next real file starts where it should.

It has a GUID because every file header does — usually all ones — and that GUID names nothing. Nothing is lost by ignoring it.

@term section
@name Section
@short A part of an FFS file: its code, its name, its version, or another whole volume.

A file is made of sections, and sections can nest. The common ones are the executable image (PE32), a compressed section (which holds more sections inside it), a user-interface section (the readable name of the file) and a version section.

A **compressed section** can be opened decompressed in ByteRipper — the panel expands it and shows you what is actually inside.

@see topic:fragments

@term free-space
@name Free space
@short The unwritten room left in a volume after its last file.

Listed by the panel on purpose: it is what tells you whether a module could be added to a volume, and its size is a quick sanity check that the volume's own length field is right.

@see term:padding

@term padding
@name Padding
@short Space between structures that nobody wrote to.

Erased padding is a dump's filler — usually `FF`. The tree hides it unless you ask for it, because a large dump is full of it and a row standing for nothing is a row to scroll past.

Padding that **holds data** is always listed: something is there, whether or not the parser knows what.

@see term:free-space

@term ec-firmware
@name EC firmware inside a BIOS image
@short The embedded controller's code, often sitting in the BIOS region with nothing to name it.

Since Skylake a board may have a proper [[term:ec-region|EC region]] that the descriptor declares. Before that — and on plenty of boards since — the EC firmware is simply a block inside the BIOS region, which the parser shows as [[term:padding|padding]], usually the first one.

What usually gives it away:

- **Size.** 128 KB (131 072 bytes) and 192 KB (196 608 bytes) are the common ones.
- **ITE controllers** open with a run of `A5` bytes — `A5 A5 A5 A5 A5 A5`.
- **ENE controllers** carry the string `ENE` in the first bytes.
- **Microchip (MEC)** firmware is more often inside the BIOS region's first volume than in padding.

! These are signs, not proof, and they come from one community source rather than from any datasheet. A block with no marker at all is common. The way to settle it is the way this app is built for: compare against a known-good dump of the same board.

@see term:ec-region
@see topic:recipe-donor

@term serial-data
@name Serial numbers, MAC and licence data
@short Board-specific data that has to survive a repair — and the places it hides.

A clean image from the vendor does not carry this board's serial number, its MAC address or its Windows licence. Moving them over from the old dump is often the whole job, and there is no universal tool for it: it comes down to comparing two images, which is what this app is for.

Where to look:

- **[[term:nvram|NVRAM]]** — most settings, and many serials.
- **[[term:padding|Padding]] between structures.** On most Intel-based ASUS laptops the serial, the Windows key and a few settings sit in the *second* non-empty padding block of the BIOS region.
- **`SMBiosFlashData`** — an ASUS structure, GUID `FD44820B-F1AB-41C0-AE4E-0C55556EB9BD`, holding serial information and the MAC address.
- **[[term:gbe-region|GbE region]]** — the MAC address on boards with an Intel network controller. Not every vendor puts it there.
- **[[term:slic|SLIC / MSDM]]** — the OEM Windows licence.

@see topic:recipe-board-data
@see topic:recipe-donor

@term nvram
@name NVRAM
@short Where the firmware keeps its settings between boots: setup options, boot order, Secure Boot keys.

NVRAM lives in its own area of the BIOS region, in a format that depends on the firmware vendor. ByteRipper reads the common ones — [[term:vss|VSS/VSS2]], FTW, EVSA, FDC and a few vendor-specific stores — and lists the variables in them.

On a bench NVRAM matters for two reasons: it is usually safe to take from a donor (the firmware rebuilds what it needs), and corruption there is a common cause of a board that hangs at the vendor logo or forgets its settings every boot.

@see term:vss
@see topic:recipe-board-data

@term vss
@name VSS / VSS2 store
@short The most common NVRAM format: a store of named variables.

Each entry is a variable with a name (`BootOrder`, `PK`, `Setup`), a vendor GUID and a value. ByteRipper names the entry by its variable name rather than by its GUID, because many variables share one vendor GUID.

Related stores you may see in the same area: **FTW** (a fault-tolerant write record, the journal that makes a variable update survive a power cut), **EVSA**, **FDC**, **CMDB** and vendor flash maps. They are different vendors' answers to the same problem.

@see term:nvram

@term dmi
@name DMI (Desktop Management Interface)
@short The standard set of facts a machine reports about itself — serial number, UUID, model — and the part of the image they are written into.

DMI is a DMTF standard, and in practice "DMI" and "SMBIOS" name the same thing: the tables the firmware publishes so that an operating system can say what machine it is running on. `dmidecode` on Linux reads exactly these.

What matters on a bench is that a board's own identity lives there: the system and baseboard serial numbers, the machine UUID, the asset tag, the model name. All of it is written at the factory rather than computed. A board with those fields blank loses warranty lookup, licence activation and management tooling.

Lost fields are not always lost for good. Some vendors — HP and Acer among them — ship service utilities that write the identity again, taking the serial number and the rest off the sticker on the case or on the board. Where no such utility exists, carrying the fields over from the old dump is what is left.

Where the fields sit inside the image is not standardised. Each vendor puts them where it likes and the layout moves between generations, which is why moving them across is a comparison job rather than something a tool can do for you.

@see term:serial-data
@see topic:recipe-board-data

@term slic
@name SLIC / MSDM
@short Windows OEM licence data stored in the firmware.

An ACPI table the firmware publishes so that a pre-installed Windows activates without a key. On older machines it is SLIC; on newer ones MSDM. It is board- and licence-specific: overwrite it with a donor's and the machine may stop activating.

@see topic:recipe-board-data

@term capsule
@name Capsule
@short An update file wrapped in a header, rather than a raw chip image.

A firmware update downloaded from a vendor is often a capsule: the image plus a header that says what it updates and how. ByteRipper reads through the wrapper and shows what is inside.

If a file opens as a capsule, remember that it is an **update**, not a dump — it may not contain every region the chip has.

@term microcode
@name Microcode update
@short A patch for the CPU itself, loaded before any firmware code runs.

Intel ships microcode updates inside the firmware image. The CPU loads the one matching its signature very early in the boot, through the [[term:fit|FIT]].

Each update carries its CPU signature, a revision number and a date in its header, which is how ByteRipper names them.

@see term:fit
@see topic:recipe-microcode

@term fit
@name FIT (Firmware Interface Table)
@short A table of things the CPU must load before executing BIOS code.

The FIT is found through a pointer at a fixed address near the top of the flash. Its entries point — by absolute address — at [[term:microcode|microcode updates]], ACMs, Boot Guard manifests and policy records.

Because the addresses are absolute, nothing a FIT points at may move. A FIT entry pointing into erased flash is a board that does not post at all.

@see topic:tool-fit
@see topic:recipe-microcode

@term reset-vector
@name Reset vector
@short The address an x86 processor starts executing from: the very top of the address space, `0xFFFFFFF0`.

The top of the address map is wired to the firmware chip, so the first instruction the CPU ever runs comes out of the flash — sixteen bytes from the end of the image, holding a jump into the [[term:sec-phase|Security Phase]]. The [[term:fit|FIT]] pointer sits just below it, at `0xFFFFFFC0`.

On a modern board this is no longer the beginning of the story. The [[term:me|Management Engine]] powers up first and only then releases the CPU from reset; the [[term:microcode|microcode]] the FIT names is applied before the reset vector runs; and on a [[term:boot-guard|Boot Guard]] platform an [[term:acm|ACM]] has already run and verified the code the reset vector is part of. The reset vector is early, not first.

@see term:fit
@see term:sec-phase

@term sec-phase
@name SEC (Security Phase)
@short The first UEFI phase: a machine with no working memory yet.

At SEC the system is entirely unconfigured — the CPU is still in 16-bit mode and DRAM is not up. The phase's whole job is to get far enough for the next one: switch to 32-bit, set up temporary memory (usually by using the CPU cache as RAM), map the flash into the address space, verify [[term:pei-phase|PEI]] and hand over.

@see term:reset-vector
@see term:ibb

@term pei-phase
@name PEI (Pre-EFI Initialization)
@short The phase that brings memory up, one module at a time.

PEI modules — PEIMs — run in dependency order: CPU cache and frequency, the memory controller, the I/O hub, and finally DRAM itself. PEI ends by checking the boot mode: a resume from S3 goes to the boot script instead, and everything else hands control to [[term:dxe-phase|DXE]].

Each PEIM is an [[term:ffs-file|FFS file]] of its own type, which is why the panel's Type column is worth reading when you are trying to tell early code from late.

@see term:sec-phase
@see term:ibb

@term dxe-phase
@name DXE / BDS
@short The phase where the real drivers run, and the one that picks what to boot.

Most of a firmware image by size is DXE drivers: storage, network, graphics, the setup screens, the vendor's own additions. They are discovered in the [[term:volume|volumes]], checked for whether their conditions are met, and run until none are left. Then the Boot Device Select (BDS) driver decides what to boot and starts it.

DXE is the part [[term:boot-guard|Boot Guard]] does not verify directly — see [[term:ibb|IBB / OBB]] — which is why an edit here can work on a board where an edit to the boot block never will.

@see term:volume
@see term:ibb

@term boot-guard
@name Boot Guard
@short A hardware-rooted check that the early firmware is the one the board vendor signed.

Boot Guard makes the silicon, not the firmware, the thing that decides whether the firmware may run. What it does when a check fails is fixed in the chipset's [[term:otp|fuses]] at the end of manufacturing, and nothing written to the flash can change it.

How a Boot Guard board comes up:

1. The [[term:me|Management Engine]] boots from its own on-die ROM, verifies its own firmware, and only then releases the main CPU from reset.
2. The CPU finds the [[term:fit|FIT]] and applies the [[term:microcode|microcode]] the table names.
3. The CPU loads the Startup [[term:acm|ACM]] the FIT names and runs it out of cache. The microcode verifies the ACM against a key Intel fused into the processor, so the chain starts with something the silicon already trusts.
4. The ACM reads the vendor's key hash and the [[term:boot-guard-profile|profile]] out of the chipset's fuses.
5. The ACM verifies the [[term:key-manifest|Key Manifest]] in the image against that fused hash. This is the link that ties *this* flash to *this* chipset.
6. The Key Manifest vouches for the key that signs the [[term:boot-policy|Boot Policy]]; the Boot Policy names the ranges of the [[term:ibb|IBB]] and their hashes; the ACM verifies them.
7. Only then does the [[term:reset-vector|reset vector]] run, inside code that has already been checked.

The image declares which ranges are covered. The [[topic:tool-uefi|UEFI panel]] counts those **protected ranges** in its summary line.

! Bytes inside a protected range cannot be changed. The signature will not match, and it cannot be recomputed without the vendor's private key. No tool fixes this; it is the point of the feature.

@see term:boot-guard-profile
@see topic:bench-safety

@term acm
@name ACM (Authenticated Code Module)
@short A small signed module the CPU runs out of its own cache, before there is any usable memory.

An ACM is signed by Intel and verified by the processor's own microcode against a key fused into the CPU. That is what lets it be the first link of a chain of trust: nothing in the flash vouches for it.

The **Startup ACM** is the one [[term:boot-guard|Boot Guard]] uses. It is named by an entry in the [[term:fit|FIT]], and it has the strictest placement rule of anything in the table — the area it runs from must hold the module and nothing else.

@see term:fit
@see term:boot-guard

@term key-manifest
@name Boot Guard Key Manifest (KM)
@short The image's half of the link between this flash and this chipset.

The Key Manifest carries the board vendor's public key, and the hash of the key that signs the [[term:boot-policy|Boot Policy]]. The Startup [[term:acm|ACM]] hashes the vendor key in it and compares the result against the value burned into the chipset's [[term:otp|fuses]].

That fused hash is the whole of what the silicon knows about the vendor — one value, set once, never rewritten. It is what makes a signed image belong to a board family rather than to firmware in general.

! Replacing the Key Manifest with one signed by a key of your own does not work: your key hashes to something else, and the fused value cannot be changed to match it. Writing the vendor's original bytes back is the fix — which is one more reason the backup dump is the most valuable file on the bench.

@see term:boot-policy
@see term:boot-guard

@term boot-policy
@name Boot Policy Manifest (BPM)
@short What exactly is protected: the ranges of the boot block, and their hashes.

The Boot Policy names the ranges that make up the [[term:ibb|Initial Boot Block]] and records a hash for each, so the [[term:acm|ACM]] can verify precisely those bytes. It is signed by a key the [[term:key-manifest|Key Manifest]] vouches for, which is how it inherits the trust the fuses started.

The protected ranges the [[topic:tool-uefi|UEFI panel]] counts are the ones this manifest declares.

@see term:key-manifest
@see term:ibb

@term ibb
@name IBB / OBB
@short "Initial Boot Block" — the part of the firmware Boot Guard itself verifies; the rest is the OEM's problem.

The IBB is roughly the [[term:sec-phase|SEC]] and [[term:pei-phase|PEI]] code: the early firmware, up to the point where memory works. That is what the [[term:acm|ACM]] hashes and checks against the [[term:boot-policy|Boot Policy]].

Everything after it is the **OBB**, the "OEM Boot Block" — in practice the [[term:dxe-phase|DXE]] half. The IBB is expected to verify the OBB before running it, using code the board vendor writes. Whether a given vendor actually does is up to that vendor.

This is why a panel marks some ranges as protected and others not, and why the same kind of edit can be impossible in one part of an image and routine in another.

@see term:boot-guard
@see term:boot-policy

@term boot-guard-profile
@name Boot Guard profile
@short What the board does when verification fails — fused into the chipset, not stored in the image.

Three independent things, and the names are built out of them:

- **Verified boot (V)** — the firmware is checked against the signature and refused if it does not match.
- **Measured boot (M)** — the firmware is hashed into the TPM, so something later can notice that it changed. On its own it stops nothing.
- **Enforcement** — immediate shutdown, a shutdown after a timeout, or nothing at all.

The profiles as they are usually written:

- `No_FVME` — Boot Guard disabled.
- `VE` — verified boot, shutdown after a timeout.
- `VME` — verified and measured, shutdown after a timeout.
- `VM` — verified and measured, **not enforced**: the board boots anyway.
- `FVE` — verified boot, immediate shutdown.
- `FVME` — verified and measured, immediate shutdown.

No tool can pull the *burned* value out of the silicon of a [[term:pch|chipset]] already installed on a board, ByteRipper included: it lives in the [[term:otp|fuses]], and nothing in the image says what a particular part was fused with.

What an image can say is what it will burn into a new [[term:pch|chipset]] that has never been installed on a board. That is the case after a [[term:pch|hub]] is replaced: the profile and the vendor's key hash are configuration that Intel's image tool wrote into the [[term:me-region|ME region]], and whether they are committed the first time the board is powered is a setting beside them. ByteRipper does not read those two fields yet. What it shows today is the [[term:boot-policy|protected ranges]] the image declares.

! A board on `VM` boots with a modified boot block. That is exactly why a modification that "worked" on one machine bricks the next one — the profile is a property of the board, not of the image.

@see term:boot-guard
@see term:otp

@term secure-boot
@name Secure Boot
@short A different thing from Boot Guard: the firmware checking the operating system's loader.

Secure Boot is part of the UEFI specification and lives in [[term:nvram|NVRAM]] as a set of databases:

- **db** — the authorized image database: keys and hashes of loaders that may run.
- **dbx** — the forbidden image database, the revocation list.
- **dbt** and **dbr** — the timestamp and recovery databases.

Above them are the Key Exchange Keys (**KEK**), which are allowed to update those databases, and the Platform Key (**PK**), which owns the KEKs and represents whoever owns the board.

! Do not confuse it with [[term:boot-guard|Boot Guard]]. Secure Boot looks outward, at what the firmware is about to boot, and the user can switch it off in the setup screen. Boot Guard looks inward, at the firmware itself, and cannot be switched off at all. Taking NVRAM from a donor replaces this machine's Secure Boot keys with the donor's, which is a common reason a repaired machine stops booting an operating system that was fine before.

@see term:nvram
@see term:boot-guard

@term top-swap
@name Top Swap
@short A chipset feature that swaps in a second copy of the boot block if the first fails.

The board keeps two boot blocks and a chipset bit chooses which one the CPU sees. It is a recovery mechanism: a bad flash of one copy can be survivable.

Worth knowing on a bench because it means an image may legitimately contain two nearly identical boot blocks, and a comparison will show them both.

@see topic:tool-fit

@term vscc
@name VSCC table
@short The list of flash chips the descriptor knows how to drive.

"Vendor Specific Component Capabilities": for each supported chip, the commands and timings the chipset should use with it. If a board was repaired with a flash chip whose ID is not in this table, the on-board flashing path may not work — an external programmer still will.

@see term:flash-descriptor

@term non-uefi-data
@name Non-UEFI data
@short Bytes inside the image that the parser does not recognise as any known structure.

Not an error. Vendors put their own data in firmware images all the time, and an EC image or an option ROM inside a BIOS region is a format of its own.

It is, however, where to look when something does not add up: a region that should be volumes and reads as non-UEFI data is a corrupted region.

@see topic:tool-zones
