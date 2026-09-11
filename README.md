# ByteRipperWeb

A hex editor and binary-file comparator for firmware dumps, in the browser.

ByteRipperWeb is the web edition of
**[ByteRipper](https://github.com/maxshevelev/ByteRipper)** — a macOS tool
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

**Usable, for what it does so far.** It opens two dumps, compares them, and
lets you patch one and save it — the orange wash, the live
`1,057 differing · 4,193,247 same` summary that follows your edits, Next
Difference stepping by change rather than by byte, and a Save that writes back
to the file in Chromium and downloads a copy where it cannot. The domain half
is checked against the macOS app's own unit tests, ported with the code they
cover. What is missing is search, the minimap, segments and the firmware tools.
Milestone by milestone, the plan is
**[Design/IMPLEMENTATION_PLAN.md](Design/IMPLEMENTATION_PLAN.md)**; what is in
scope at all, and what the browser takes away, is
**[Design/ANALYSIS.md](Design/ANALYSIS.md)**.

| Milestone | |
| --- | --- |
| M0 Scaffolding and benchmarks | done |
| M1 Storage and document | done |
| M2 Hex grid, read-only, one file | done |
| M3 Comparison | done |
| M4 Editing and saving | done |
| M5 Search | next |
| M6 – M12 | see the plan |

## Stack

TypeScript throughout, React 19 and Vite for the interface, the hex grid drawn
on canvas, all heavy work in Web Workers. Static hosting, no server.

## Build and run

Node 22.18 or newer, which is what runs TypeScript files without a compile
step — the benchmark harness is written in TypeScript and Node executes it
directly, so there is no build tool in that path and no dependency standing in
for one.

```bash
npm install
npm run dev      # Vite dev server
npm run check    # types, lint, unit tests — what CI runs
npm run bench    # performance table against benchmarks/fixtures/
npm run build    # production bundle
```

`npm run bench` wants a real dump in `benchmarks/fixtures/` (gitignored). With
nothing there it measures a synthetic stand-in and says so; those numbers are
for watching a trend, not for quoting.

The frame cost of a repaint and of a scroll cannot be measured in Node, which
has no canvas. Those rows live in a page: `npm run dev`, then open
`/benchmarks/paint/`.

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
