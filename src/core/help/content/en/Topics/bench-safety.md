# Bench Rules

> Ways to ruin a dump (and how to avoid them).

## Keep the original

Save the original dump, read off the chip, exactly as it came off the programmer, and never edit that file. Work on a copy — or use **File ▸ Duplicate** and patch the duplicate. A board with a failed power rail may not survive a second read.

## Never change the length of a flash image

A chip's capacity is fixed. Every address inside a firmware image is absolute: the flash descriptor names region boundaries, the [[term:fit|FIT]] points at microcode by address, a signature covers a fixed range.

Overwrite and fill are relatively safe: they do not change the length. Paste Insert, Delete Bytes and Insert Mode are not, on a dump — the app asks before any of them for this reason. Before you flash, check the file's size in the status bar against the capacity of the chip.

## Mind what is board-unique

A donor dump from the internet may carry the donor's identity. Flash it raw and the board comes up with someone else's MAC address, serial number and machine UUID. It may equally carry none: dumps shared on the internet often have the [[term:dmi|DMI]] area wiped so that nobody's data travels with them, and a board that comes up with those fields empty is one whose warranty lookup and OEM activation stop working. See [[topic:recipe-board-data|Keeping board-unique data]].

## Signed and locked regions

Modern Intel platforms verify parts of the image before the CPU runs them, and the flash descriptor can lock regions against writes.

- If the image has [[term:boot-guard|Boot Guard]] protected ranges, the [[topic:tool-uefi|UEFI panel]] says so in its summary line. Bytes inside a protected range cannot be changed without the platform refusing to boot — the signature will not match, and you cannot re-sign it.
- The [[term:me-region|ME region]] is verified by the engine itself. Patching it by hand generally produces a board that hangs or reboots on a timer rather than a board with a patched ME.
- The descriptor's own master permissions decide what a flash programmer running *on the board* can write. An external programmer on the chip ignores them.

Knowing this before you patch is the difference between a five-minute fix and a bricked board.

## Verify before you flash

1. No red bytes left — every edit is saved ([[topic:saving|Saving]]).
2. The file's size is exactly the chip's capacity.
3. If you changed a header, its checksum is right — the [[topic:tool-uefi|UEFI panel]] flags bad ones and can fix them.
4. Compare your patched file against the original one last time ([[topic:first-comparison|comparison]]) and look at every difference. Every one of them should be a change you meant to make.
