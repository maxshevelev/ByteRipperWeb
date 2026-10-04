# Data Unique to a Board

> Which parts of a firmware image belong to one individual board rather than to the model, and where in the image they are held.

Two boards of the same model, the same revision and the same firmware version do not hold identical images. A part of the image is written per unit: at the factory, by the firmware itself during operation, and by service procedures afterwards. This page lists those parts and states which of them the tool panels can locate.

## Why images of one model differ

Four separate mechanisms account for it.

1. **Per-unit programming at manufacture.** Serial numbers, the machine UUID, MAC addresses and inventory fields are written into the image after the common firmware has been programmed. The values differ by definition; the fields holding them do not.
2. **Configuration written by the platform during operation.** BIOS setup and state variables are written to [[term:vss|NVRAM]] inside the [[term:bios-region|BIOS region]] whenever they change, and the [[term:me|Management Engine]] writes its own [[term:mfs|MFS]] file system continuously. Two boards that have been switched on differ here even if nothing was changed deliberately. See [[topic:flash-writes|Who Writes to the Flash]].
3. **Several configurations of one model.** One board layout is frequently shipped in several configurations under a single model designation. The firmware version and build may differ between them, and with it the factory values of the setup parameters.
4. **Later service.** A firmware update, a warranty repair or an earlier board-level repair leaves its own traces in the same places.

## Where the data is held

- **[[term:gbe-region|GbE region]]** — the configuration of the integrated network controller, including the **MAC address**. It is a top-level row in the [[topic:tool-uefi|UEFI Structure]] tree, and its address and length are in the detail list.
- **[[term:me-region|ME region]]** — what makes it unique is not primarily its settings, which are usually common to the platform. A region in the **Initialized** state is bound to one individual chipset, the files of its file system being protected by keys derived from that part's secret. The state is reported by [[topic:tool-me|ME Analyzer]]; see [[topic:recipe-me-check|Reading the ME Region Report]].
- **NVRAM stores ([[term:vss|VSS]])** — BIOS setup and state variables. They are rows in the UEFI tree. Their content differs between two boards: the firmware writes these variables whenever a setting changes and in the course of operation.
- **The [[term:dmi|DMI/SMBIOS]] area** inside the BIOS region — described below.
- **Manufacturer Windows licensing data** ([[term:slic|SLIC]] / MSDM) on machines of the corresponding period.

## The DMI area

[[term:dmi|DMI]] is the one item on the list that is not a node in the tree: it has no signature the parser can find, and its position is a manufacturer's decision. The manufacturer writes it at the factory, and operating systems and diagnostic utilities read it instead of interrogating the hardware. It usually holds:

- **Serial numbers** — of the machine and of the board, which are two different numbers.
- **MAC addresses** of the integrated wired and wireless adapters. On some notebook models they are held here rather than in the [[term:gbe-region|GbE region]].
- **The machine UUID.**
- **Inventory fields** — asset tag, manufacturer, exact model, BIOS version.
- **The Windows OEM key** on some notebooks, in the same manufacturer block; see [[term:slic|SLIC / MSDM]].

Because the area is not a tree node, it is located by searching for a value that is known independently — a serial number read from the label, a MAC address read from the operating system — using [[topic:search|Finding Bytes and Text]], and marked with a [[topic:bookmarks|bookmark]].

## What the program provides

- The two panes and the comparison report every address at which two images differ, which is how the extent of per-unit data is established for a given model.
- The UEFI panel gives the address and length of the GbE region, the ME region and the NVRAM stores.
- **Select Block from Here at…**, in the pane's right-click menu, selects such a range by number, and [[key:paste]] overwrites it without moving any following byte.
- Bookmarks are shared by both panes at the same address, so the same range is found in both images.

The program does not identify which values are correct for a given board, and does not read anything from the board itself.

! In images published on the internet the DMI area is frequently overwritten so that the original owner's data is not distributed with the file. Such an image carries empty fields rather than another board's values.
