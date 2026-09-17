SHORT PROJECT CONTEXT

Project: ByteRipperWeb — the browser edition of ByteRipper, a tool for
comparing and editing two binary firmware dumps. Same question as the macOS app
(*is this chip's content the same as the one that works?*), reachable from any
bench on any operating system without installing anything.

Two documents are the plan of record, in this order:
- `Design/ANALYSIS.md` — which features are in scope, which are adapted, and
  which the browser takes away. Read it before proposing anything structural.
- `Design/IMPLEMENTATION_PLAN.md` — the technical decisions and the milestones,
  each with a definition of done. Read it before writing code.
- `Design/GAPS.md` — what is still left to port and what the web edition will
  not support, as tables to prioritise from. Keep it current in the same change:
  closing a gap moves its row to Closed, a new `later —` entry in the module map
  belongs to a row, and a dropped or adapted feature gets one.

The macOS reference implementation is a sibling clone at `../ByteRipper` (or
`$BYTERIPPER_REPO`). Read the Swift before inventing a mechanism: it has
already answered most of these questions, and its tests are the specification a
port is checked against.

Stack:
- TypeScript, strict. Vite. React 19 for the chrome around the canvas.
- No backend. Static hosting; files never leave the machine.
- Chromium is first-class (File System Access API, save in place). Firefox and
  Safari work fully but save through the download flow, and the UI says so.
- Long-running work in Web Workers, always cancellable, always with progress.
- No dependency is added without a reason worth writing down.

Running it:
- Start the dev server as plain `npm run dev`, with no flags. Which names it
  answers to, and on which port, is this machine's business rather than the
  repository's, and lives in the untracked `.env.local` — `vite.config.ts`
  reads it on every start, and `.env.local.example` says which keys it holds.
  A `--host` or `--port` on the command line overrides all of it and takes the
  address away from whichever machine was using it: leave the flags to the
  config. Never commit an address into `vite.config.ts`.
- The server binds every interface on purpose — one on loopback alone is one no
  other machine on the bench's network can open, whatever names it answers to.

Architecture:
- `src/core/` — pure TS: chunked storage, piece table, diff, search, segments,
  bookmarks, undo. No DOM, no React. This is the unit-tested half.
- `src/firmware/` — pure TS: UEFI image parser, FIT, ME analysis.
- `src/workers/` — diff, search, minimap build, firmware parsing.
- `src/render/` — canvas renderers, imperative, no React.
- `src/state/` — stores bridging workers and React.
- `src/ui/` — React components.
- `src/tools/` — one directory per tool module. A tool depends on
  `src/firmware/` and on shared code, never on the app and never on another
  tool. Code two tools both need moves to shared code.

Important rules:
- Domain code is pure TypeScript, modular, and unit-testable.
- Internal byte ranges are half-open: [start, end). Dialogs may use an inclusive
  end, but must convert at the edge.
- The app has two file slots: File A and File B. File B is optional; with one
  file the app is in single-file mode.
- Hex view shows 16 bytes per row plus the decoded text column.
- Comparison is by absolute zero-based offsets only. No block matching, no diff
  alignment.
- Difference state is background colour; unsaved modification is red foreground;
  a byte that is both shows both. State is carried by colour *and* form, so it
  survives a theme switch and colour blindness.
- Very large files are read in chunks and never loaded whole.
- The hex grid draws through a glyph atlas and repaints dirty regions only. When
  drawing lags, fix what is repainted; do not cache what was painted.
- One workspace per browser tab. No in-app tabs, no window management, no pane
  dragging — that was a deliberate decision, not an omission.

Skills:
- Skills live in the repo, committed under `Skills/<name>/`: `SKILL.md`
  (frontmatter `name` / `description` on line 1), plus optional `scripts/`
  (deterministic, stdlib-only) and `reference/`.
- `.claude/` is never committed. For a real `/name` on a machine, add the local
  gitignored hook once:
  `mkdir -p .claude/skills && ln -s ../../Skills/<name> .claude/skills/<name>`
- A skill's run is a diff to review, never a blind rewrite.

Relationship to ByteRipper:
- The macOS repository is the reference implementation and the source of truth
  for firmware knowledge. A parser fix belongs there first.
- `Skills/port-from-byteripper/` reports what changed upstream since the commit
  in `PORT_STATE.json`, mapped onto this repository through
  `Skills/port-from-byteripper/reference/module-map.json`.
- The clone is found at `../ByteRipper` or via `$BYTERIPPER_REPO`.
- Keep the module map current as part of doing the work. A stale map makes every
  future run lie.
- ByteRipper is the master: port its behaviour and its code structure, so the
  two stay comparable symbol by symbol. Every ported declaration carries an
  anchor naming the upstream one — `@upstream <path>#<Type.member>` — and
  anything that deliberately does not follow upstream says so with
  `@upstream-differs <why>` or `@web-only <why>`. Upstream declarations left out
  on purpose are `unported` entries in the module map, with the reason.
  `python3 Skills/port-from-byteripper/scripts/check_anchors.py` checks all of
  it; run it after porting.

Third-party data:
- The GUID catalogue, the ME databases and the microcode catalogue are fetched
  live from GitHub, as ByteRipper does: lazy and single-flight. Freshness is the
  desktop's own rule (`Freshened`): a body is held for a day, a body younger
  than that is not asked for at all, an older one is answered at once with the
  check running behind it, and a check that cannot be made keeps what is held.
  Unlike the desktop, that body, its validator and both of the rule's dates live
  in the Cache API, so a bench without network still has yesterday's databases —
  and the tool shows their date, so yesterday's data is never mistaken for
  today's. A check costs no bytes only where CORS lets this code read the
  `ETag` and send `If-None-Match` (which is `api.github.com`); at
  `raw.githubusercontent.com` the `ETag` is unreadable and a script-set
  `If-None-Match` is refused by the preflight, so there the request goes out
  with `cache: "no-cache"` and the browser revalidates the copy it holds with
  the validator it stored (`max-age=0` + `If-None-Match` on the wire, a `304`
  back). Measured in a browser; `cachedSource.ts` records the numbers.
- Each source sits behind an interface so tests install their own. A test that
  reaches the network is a test that fails on a train.
- The upstream projects these come from (UEFITool, MEAnalyzer, CPUMicrocodes)
  are credited in the README, as they are in ByteRipper.
