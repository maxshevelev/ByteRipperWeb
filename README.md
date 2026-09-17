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

**Feature-complete against the plan, and being hardened.** Try it at
**[maxshevelev.github.io/ByteRipperWeb](https://maxshevelev.github.io/ByteRipperWeb/)**.

It opens two dumps, compares them, and lets you patch one and save it — the
orange wash, the live `1,057 differing · 4,193,247 same` summary that follows
your edits, Next Difference stepping by change rather than by byte,
synchronised scrolling, and a Save that writes back to the file in Chromium and
downloads a copy where it cannot. Search finds hex bytes or text, guesses the
encoding from what you typed and names it once found, keeps an exact count
however common the pattern, remembers your recent searches, and keeps named
favourites. The minimap shows the whole file at a glance, with differences,
edits and matches marked on it. Bookmarks mark the rows you come back to, and
segments cut a dump into named pieces and join files back together.

Beside the dump sit the firmware tools: the **UEFI Structure** tree with its
checksums, the **FIT Table** with microcode added, replaced and removed in
place, and the **ME Analyzer**'s reading of the Intel ME/CSME region. Settings
cover the font, the theme, the grouping and the text decoding table.

The **pattern library** travels between machines. In Chromium it can live in a
folder you choose — iCloud Drive, OneDrive, Dropbox — where each browser and
each Mac running ByteRipper writes its own file and reads the others'. Changes
merge, and a disagreement is asked about rather than decided for you. Firefox and
Safari can take what such a folder holds, and every browser can export and
import the library as one file.

The domain half is checked against the macOS app's own unit tests, ported with
the code they cover. What is still left to port — Boot Guard
protected ranges, the compressors a rebuild would need, and a list of smaller
details — is tabled with priorities in **[Design/GAPS.md](Design/GAPS.md)**.
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
| M5 Search | done |
| M6 Minimap | done |
| M7 Bookmarks and segments | done |
| M8 Tool panel and UEFI Structure | done |
| M9 FIT Table | done |
| M10 ME Analyzer | done |
| M11 Settings and the pattern library | done |
| M12 Hardening | in progress — deployed from CI; the cross-browser pass, flow tests and the low-end benchmark are open |

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
mean *save in place* and lets the pattern library live in a folder. Firefox and
Safari are fully usable and save a copy through the download flow — the
interface says which one you are getting rather than pretending.

Chromium offers that API only to a secure page: `https://`, or
`http://localhost`. The dev server opened from another machine at
`http://192.168.…:5173` is not one, so there it behaves like Firefox — saving
downloads a copy and the Favorites tab has no Move…. Open it on the machine
running the server, or allow the address in
`chrome://flags/#unsafely-treat-insecure-origin-as-secure`.

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
