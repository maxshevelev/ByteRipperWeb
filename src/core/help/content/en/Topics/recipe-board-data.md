# Keeping Board-Unique Data

> A donor image may carry the donor's identity. These are the bytes that must stay yours.

Almost every dump holds a small amount of data that belongs to **that specific board** and to no other. Flash a donor image raw and you move the donor's identity onto your board.

## What is usually board-unique

- **The [[term:gbe-region|GbE region]]** — the integrated network controller's configuration, and with it the **MAC address**. Two boards with one MAC address on the same network is a fault that shows up days later.
- **The machine UUID and serial numbers**, held by the vendor in a [[term:dmi|DMI/SMBIOS]] area inside the BIOS region. Blank fields are what a warranty lookup, an OEM activation or a management tool trips over.
- **The [[term:me-region|ME region]]'s configuration** — see [[topic:recipe-me-check|Checking an ME region]]. The ME holds board-specific settings, and on many platforms it also holds the values the vendor provisioned at the factory.
- **NVRAM / [[term:vss|VSS]] stores** — saved setup variables, boot entries, enrolled Secure Boot keys. Usually safe to take from a donor (the firmware rebuilds them), but not always: some vendors keep licence or configuration data there.
- **Windows OEM licence data** ([[term:slic|SLIC]] / MSDM) on older machines.

## What the DMI area holds

[[term:dmi|DMI]] is the one item on that list with no structure to click on, so it is worth knowing what is in it. The vendor writes it at the factory, and the operating system and diagnostic tools read it instead of interrogating the hardware:

- **Serial numbers** — the machine's and the board's, which are not the same number.
- **MAC addresses** of the built-in wired and wireless adapters. On many laptops they live here rather than in the [[term:gbe-region|GbE region]].
- **The system UUID.**
- **Inventory fields** — asset tag, manufacturer, the exact model, the BIOS version.
- **The Windows OEM key** on many laptops sits in the same vendor area — see [[term:slic|SLIC / MSDM]].

## How to do it

1. Open the donor image and your own original dump side by side.
2. Find each of the areas above in the [[topic:tool-uefi|UEFI panel]] — the GbE region and the ME region are top-level rows in the tree, with their offsets in the detail pane.
3. [[topic:bookmarks|Bookmark]] the start of each. Both panes show the marks at the same height, which is exactly what you want here.
4. Copy each range **out of your own dump** and paste it into the donor image — plain ⌘V overwrites, so nothing shifts.
5. Compare the result against your own dump one last time and read every remaining difference.

! Do this before you flash, not after. Once the chip carries the donor's MAC and UUID, your own copies exist only in the file you saved in step 1 — which is why [[topic:bench-safety|the first rule]] is to keep that dump. Some vendors let you write the fields again with a service utility, off the sticker ([[term:dmi|DMI]]), but that is not something to count on in advance.
