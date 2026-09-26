# Who Writes to the Flash

> Only the chipset has wires to the chip. Everything on the board that wants to read or write the flash goes through it, and the descriptor holds who is allowed what.

Firmware is written to the chip one way by design: through the chipset. The [[term:pch|chipset]] holds the only SPI controller on the board, so firmware on the CPU, a flashing utility, the [[term:me|Management Engine]] and the network controller all reach the chip by asking it — and it checks their permissions against the descriptor before it obeys.

A [[term:programmer|programmer]] is not part of that design. It drives the chip's own pins, and there is nobody to ask: no permissions, no checks. It is not a second normal route but a step outside how the platform was built — the way a dump comes off a dead board, and the way bytes go back in when the chipset will no longer write them.

! No check at write time does not mean no check at all. The permissions fence off exactly what the platform verifies when it starts. A programmer removes the fence, not the verification: an edit inside a protected range is written without a word of complaint and turns into a board that will not boot. Before patching a region, know who checks it — the sections below say who.

## The board writes to its own flash all the time

Not only when someone updates the firmware:

- You change a setting in Setup and press F10, and the firmware writes the [[term:vss|NVRAM]] store back into the [[term:bios-region|BIOS region]].
- The Management Engine writes its own [[term:mfs|MFS]] — configuration, counters, state.
- A vendor's update tool, or Intel's FPT (Flash Programming Tool), rewrites a whole region from the running system.

So a chip read today and the file flashed into it yesterday will not match, even if nobody touched the board on purpose: NVRAM and MFS moved on their own. That is the first thing to suspect when a comparison shows differences nobody can account for.

## What the descriptor decides

The [[term:flash-descriptor|descriptor]] names four [[term:flash-master|masters]] — BIOS, ME, GbE and EC — and gives each a read mask and a write mask over the [[term:region|regions]]. A flashing utility running on the CPU *is* the BIOS master. Where the descriptor does not grant that master write access to a region, the chipset refuses the write, and repeating it changes nothing.

! Reading is gated the same way, and this one bites hardest. A region the BIOS master may not read cannot be dumped from the running system at all. Some tools refuse the whole read; others fill the gap with `FF` and print a warning. So `FF` in a dump taken in-system can mean "not allowed to read" rather than "erased" — and a comparison then shows a whole region as one enormous difference that is not really there. A dump taken with a programmer has no such holes. That is flashrom's documented behaviour: it refuses the read by default and fills with `FF` only when told to ignore the errors ([[web:https://flashrom.org/classic_cli_manpage.html|flashrom's manual page]]).

## Writing is not running

The masks decide one thing only: whether a write through the chipset is allowed. Whether what was written will then work is a different question, and it is answered at boot, by checks that have nothing to do with the descriptor:

- [[term:boot-guard|Boot Guard]] verifies the boot block before the CPU executes it. The chipset does not check that signature: the [[term:acm|ACM]], started by CPU microcode, does, and the hash of the root key sits in the chipset's [[term:otp|fuses]].
- The ME region is verified by the engine itself, as it comes up.

That is the split behind a patch that goes in and still fails. A programmer defeats the masks — it can write any byte into any region. It can do nothing about the checks at boot: an edit inside the [[term:ibb|IBB]] or in the ME region will be written and then rejected.

Everything those checks do not cover, though — NVRAM, the [[term:dmi|DMI]] area, [[term:ec|EC]] firmware, and often the DXE drivers as well ([[term:ibb|IBB / OBB]] says when) — is written by a programmer and simply works. A part of the work on dumps lives there: restoring a board's own data, putting settings back, tuning a BIOS.

## The locks the descriptor knows nothing about

The descriptor is one gate of several, and the others live in chipset registers rather than in the image:

- **BIOS Lock Enable** — an attempt to enable writing to the BIOS region traps into system management mode, where the firmware's own handler decides what happens.
- **SMM BIOS Write Protect** — the BIOS region is writable only while the processor is in system management mode.
- **Protected Range Registers** — up to five address ranges the firmware locks at boot, which hold even against system management mode.
- **Flash Configuration Lockdown** — freezes those ranges until the next platform reset.

None of this is in the dump, so no panel can show it and no edit can change it. It is the explanation for a write refused while the descriptor plainly allows it. The registers are in the chipset datasheets; a short account of how the four fit together is [[web:https://eclypsium.com/blog/firmware-security-realizations-part-3-spi-write-protections/|Eclypsium's]].

## The service override

Intel's chipsets carry a **Flash Descriptor Security Override**: a servicing mode that opens full read and write access to every region until the next reboot. It is not switched on by a program but by a wire on the board:

- On 6-series chipsets and later, the audio codec's `HDA_SDO` pin is shorted to its 3.3 V supply across the rising edge of `PWROK` — held while the system starts, released once the firmware begins to load.
- Before 2011 (5-series and older) it was `GPIO33` pulled to ground at the same moment instead.
- Some vendors bring the same thing out as a jumper or a switch.

This is what a service procedure uses to read or rewrite a locked region with a utility, without taking the chip off the board. No public datasheet describes it: it is written down in Intel's platform guides for manufacturers, and on a bench it is known from the repair community's own instructions — the fullest of them being [[web:https://winraid.level1techs.com/t/guide-unlock-intel-flash-descriptor-read-write-access-permissions-for-spi-servicing/32449|the Win-RAID guide to unlocking descriptor access]], which is where the detail above comes from. See [[topic:provenance|Where this knowledge comes from]].

See also: [[topic:bench-safety|Bench rules]], [[term:flash-descriptor|Flash descriptor]].
