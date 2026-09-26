@term dump
@name Dump
@short The contents of a chip, read out into a file.

A dump is what a programmer gives you when it reads a flash chip: every byte, in order, starting at address zero. Its size is the chip's capacity.

Because the file is the chip, an address in the file is an address on the chip — which is why ByteRipper compares by address and never shifts one file against another.

@see topic:overview
@see term:offset

@term offset
@name Offset (address)
@short A byte's position in the file, counted from zero.

Offsets in ByteRipper are zero-based and shown in hex. Offset `0` is the first byte; offset `0x1000` is the 4097th.

Everywhere the app takes an offset from you, hex needs the `0x` prefix and decimal needs no prefix.

Ranges inside the app are half-open: `[start, end)`, where the end is the first byte *not* included. A dialog may let you type an inclusive end, and converts it for you.

@see topic:navigation

@term checksum
@name Checksum
@short A small number stored inside a structure so that damage to it can be noticed.

A checksum is computed from a structure's own bytes and stored in it. Whatever reads the structure later recomputes it: if the two do not match, something changed.

Checksums are arithmetic, not cryptography. Anyone can recompute one, which is why ByteRipper can offer to fix them — and also why a correct checksum proves nothing about who wrote the bytes.

@see topic:recipe-checksums
@see term:crc

@term crc
@name CRC (cyclic redundancy check)
@short A stronger kind of checksum, and the one most firmware structures use.

A CRC — usually CRC-32 here — catches the kinds of damage a simple sum misses: a reordering, a shifted block, a run of flipped bits. Firmware tables use it widely.

Like any checksum it is a check against accident, not against tampering: it can be recomputed by anyone who changed the bytes.

@see term:checksum

@term signature
@name Signature
@short Two different things wear this name: a magic string, and a cryptographic signature.

**A magic signature** is a short fixed string at the start of a structure that says what the structure is: `_FVH` for a firmware volume, `$FPT` for the ME partition table, `_FIT_` for the interface table. That is how a parser finds things in a raw dump, and it is what a search for a few bytes ([[topic:search|⌘F]]) is usually looking for.

**A cryptographic signature** is a number computed over a region with a private key. It proves who produced those bytes, and it cannot be recomputed by anyone who does not hold the key. This is what makes some parts of a firmware image impossible to patch.

@see term:manifest
@see term:boot-guard

@term guid
@name GUID
@short A 16-byte identifier. UEFI uses them as names for almost everything.

A GUID looks like `8C8CE578-8A3D-4F1C-9935-896185C32DD3`. In a firmware image, files, sections, volumes and NVRAM variables are identified by GUID rather than by a text name.

GUIDs mean nothing on their own, which is why the app fetches a [[topic:databases|community catalogue]] of names for the well-known ones. A row that shows a bare GUID is a structure the catalogue has no name for — not an error.

@see term:ffs-file
@see topic:databases

@term zone
@name Zone
@short The coloured outline a firmware panel draws over a byte range in the dump.

When you select a row in a firmware panel, the panel publishes that row's byte range as a zone: an outline and a tint over those bytes in the hex view and a band in the [[topic:minimap|minimap]].

A zone is an outline rather than a background fill, so it never hides a difference or an unsaved edit underneath it.

@see topic:tools-overview
@see topic:tool-zones

@term flash-chip
@name SPI flash chip
@short The chip the firmware lives on: a fixed capacity, erased to `FF`.

A serial flash chip holds the board's firmware. Two properties matter here:

- **Its capacity is fixed.** An image for an 8 MB chip must be exactly 8 MB. This is why nothing on a bench should ever change a dump's length.
- **Erased means `FF`.** Flash erases to all ones. A long run of `FF` in a dump is empty space, not damage; a long run of `00` usually is written data.

@see topic:bench-safety

@term programmer
@name Programmer
@short The hardware that reads and writes the chip. ByteRipper never talks to it.

ByteRipper works on files. Getting the bytes off the chip and back onto it is the programmer's job — a clip, a socket or an in-circuit connection, driven by its own software.

That separation is deliberate: the app can be used on a dump from any programmer, and it can never write to a board by accident.

@term bios
@name BIOS
@short "Basic Input/Output System" — the firmware that brings a PC up before any operating system runs.

The BIOS is the first code the processor executes. It identifies and initialises the hardware, runs the [[term:post|power-on self-test]], and hands control to a boot loader on a drive.

Strictly the word means the older, pre-UEFI firmware, and what a modern board runs is [[term:uefi|UEFI]]. On a bench the two are used interchangeably, and "the BIOS chip" means the flash the firmware lives on whichever it is.

@see term:uefi
@see term:bios-region

@term uefi
@name UEFI
@short "Unified Extensible Firmware Interface" — the standard modern PC firmware, and the format this app reads.

UEFI replaced the BIOS with a specified interface between the firmware and the operating system, and with firmware built out of drivers and applications instead of one monolithic blob. That modularity is why a UEFI image opens as a tree of volumes, files and sections rather than as a wall of code.

The reference implementation is the open-source TianoCore EDK II. Independent BIOS vendors fork it, board makers modify it again, and that chain is why two images for two different boards can be laid out alike and share almost no bytes.

@see term:bios
@see topic:tool-uefi

@term post
@name POST
@short "Power-On Self-Test" — the firmware's own check of the hardware, before anything boots.

The firmware identifies and tests memory, video and storage before it looks for an operating system. A board that "does not POST" never got through this, which on a repair bench usually means the early firmware, the [[term:me|Management Engine]] or the hardware itself — not the operating system.

@see topic:bench-safety

@term spi
@name SPI
@short "Serial Peripheral Interface" — the few-wire bus the firmware chip hangs on.

The flash chip talks to the chipset over four signals plus power. It is slow and simple, which is why a programmer with a clip can speak it, and why a full dump of a 16 MB part takes minutes rather than seconds.

Some platforms run the bus in dual or quad mode — two or four data lines instead of one. Which mode a board uses is configured in the [[term:flash-descriptor|descriptor]]'s [[term:soft-straps|straps]].

@see term:flash-chip
@see term:programmer

@term pch
@name PCH / ICH / FCH
@short The chipset: the companion chip that owns the firmware flash.

Intel's names for it, oldest first: ICH (I/O Controller Hub), then PCH (Platform Controller Hub). AMD's equivalent is the FCH (Fusion Controller Hub). All three end in Hub, which is why a bench calls it the hub as readily as the chipset.

It matters twice over here. The chipset, not the CPU, reads the flash and enforces which master may write which [[term:region|region]]. And on Intel it physically contains the [[term:me|Management Engine]], along with the [[term:otp|fuses]] that hold a board's [[term:boot-guard|Boot Guard]] configuration.

@see term:region
@see term:otp

@term ec
@name EC
@short "Embedded Controller" — the small microcontroller that runs the keyboard, fans, battery and power sequencing.

On a laptop the EC is powered before anything else and decides whether the main system comes up at all. It has firmware of its own, which may sit on a separate chip or share the same flash as the BIOS.

@see term:ec-region
@see term:ec-firmware

@term otp
@name OTP / fuses
@short "One-Time Programmable" — bits inside a chip that can be set once and never cleared.

Field-programmable fuses are burned at the end of manufacturing. Once set they are read-only for good: no firmware, no programmer and no amount of rewriting the flash changes them.

That is the whole reason [[term:boot-guard|Boot Guard]] cannot be switched off from a dump. Its configuration, and the hash of the board vendor's key, live in fuses inside the chipset.

@see term:boot-guard
@see term:pch

@term lpc
@name LPC
@short "Low Pin Count" — an old, slow bus still used for the embedded controller and TPM headers.

Some boards can be configured to read firmware over LPC rather than SPI. Even then an Intel platform still needs a valid [[term:flash-descriptor|descriptor]] on the SPI bus.

@see term:spi

@term bmc
@name BMC
@short "Baseboard Management Controller" — a server board's remote-management processor, with firmware of its own.

A BMC is a server's equivalent of the management hardware a desktop does not have: it runs while the machine is off and serves a remote console. Its firmware is a separate image on a separate chip, not part of a UEFI dump.

@term psp
@name AMD PSP
@short "Platform Security Processor" — AMD's counterpart to the Intel Management Engine.

The PSP is a small processor inside the AMD chipset with firmware and a boot role of its own. Unlike the [[term:me-region|ME region]] it is not a region the descriptor declares: on an AMD image the PSP firmware sits embedded between the UEFI filesystems.

@see term:me

@term ibv
@name OEM / IBV / ODM
@short Who made which part of the firmware you are looking at.

- **IBV** — Independent BIOS Vendor: AMI, Insyde, Phoenix. They take EDK II and build the firmware platform an OEM starts from.
- **OEM** — the brand on the case: Dell, HP, ASUS, Lenovo. They configure and extend the IBV's firmware.
- **ODM** — the factory that actually designs and builds the board.

Worth keeping straight when reading an image: the volume and file layout is usually the IBV's, while the settings, the logo and the [[term:serial-data|board-specific data]] are the OEM's.

@see term:serial-data

@term tcb
@name TCB
@short "Trusted Computing Base" — the part of a system that everything else has to trust, because nothing checks it.

Every verification chain ends somewhere. On an Intel board it ends in the CPU's microcode and the chipset's [[term:otp|fuses]]: they check the [[term:acm|ACM]], which checks the manifests, which check the firmware — and nothing checks them. That is the TCB.

The practical reading: the smaller the part nobody verifies, the better, and anything you can change in a dump is by definition outside it.

@see term:boot-guard
