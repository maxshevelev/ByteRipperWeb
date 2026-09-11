# ByteRipperWeb

A hex editor and binary-file comparator for firmware dumps, in the browser.

ByteRipperWeb is the web edition of
**[DumpCompare](https://github.com/maxshevelev/DumpCompare)** — a macOS tool
built around one question a repair bench asks constantly: *is this chip's
content the same as the one that works?* Two dumps, compared byte by byte at
absolute offsets, with the structure over those bytes — the UEFI tree, the FIT
table, the Intel ME region — readable beside them.

The point of the web edition is reach. A URL instead of an installer, Windows
and Linux benches as well as Macs, and every machine in a shop running the same
version at once.

**Your dumps never leave your machine.** There is no backend and no telemetry:
the file is opened by the browser, read in chunks, and every byte of analysis
happens locally. The app does reach GitHub for one thing — the firmware
databases the tools check a dump against, fetched fresh from the upstream
projects that publish them, exactly as the macOS app does. Nothing about your
file is part of that request.

## Status

**Planning.** No application code yet. What exists is the analysis of what to
build and what the browser allows — read
**[Design/ANALYSIS.md](Design/ANALYSIS.md)**, which records every feature of the
macOS app and whether it ports as-is, adapts, shrinks, or cannot exist here, and
why.

## Planned stack

TypeScript throughout, React 19 and Vite for the interface, the hex grid drawn
on canvas, all heavy work in Web Workers. Static hosting, no server.

Chromium browsers get the File System Access API, which is what makes *Save*
mean *save in place*. Firefox and Safari are fully usable and save a copy
through the download flow — the interface says which one you are getting rather
than pretending.

## Standing on other people's work

Same as upstream, and for the same reason: the firmware formats these tools read
were worked out by people who published what they learned.

- **[UEFITool](https://github.com/LongSoft/UEFITool)** by
  **[LongSoft](https://github.com/LongSoft)** — the shape of a UEFI image, the
  item and section types, the NVRAM formats, and the GUID catalogue.
- **[MEAnalyzer](https://github.com/platomav/MEAnalyzer)** by
  **[platomav](https://github.com/platomav)** — the reading of Intel ME/CSME
  firmware end to end, and the databases a dump is checked against.
- **[CPUMicrocodes](https://github.com/platomav/CPUMicrocodes)** by
  **[platomav](https://github.com/platomav)** — the Intel microcode catalogue.

If these tools are useful to you, those projects are where the credit belongs.
