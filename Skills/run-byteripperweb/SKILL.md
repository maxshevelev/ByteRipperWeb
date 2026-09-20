---
name: run-byteripperweb
description: Run, drive and screenshot ByteRipperWeb — open a dump in a real browser, open a tool panel, drag a splitter or a column, read the DOM and capture a picture. Use when asked to run the app, start the dev server, drive it, check how something looks in the browser, or take a screenshot of a panel.
---

# Running ByteRipperWeb

The app is a static page with no backend: a dev server serves it and everything
happens in the browser. So it is driven the way a person meets it — headless
Chrome on a socket — and not through the test suite.

`Skills/run-byteripperweb/scripts/drive.mjs` is the driver. It speaks Chrome
DevTools Protocol over node's own `fetch` and `WebSocket`, with no dependency to
install: the browser stays up between commands, so a check is a few invocations
rather than a script per question. All paths below are relative to the
repository root.

## Prerequisites

- **Node ≥ 22.18** (`package.json`'s `engines`, and the driver needs a global
  `WebSocket`).
- **A Chromium-based browser.** The driver looks in `$CHROME`, then the two
  macOS application paths, then `google-chrome` / `chromium` on `PATH`; pass
  `--chrome <path>` for anything else.
- **The dev server running.** The driver does not start it.

## Setup

```bash
npm install
```

## Run (agent path)

```bash
npm run dev &            # plain, no flags — the address is `.env.local`'s
node Skills/run-byteripperweb/scripts/drive.mjs start
node Skills/run-byteripperweb/scripts/drive.mjs open ~/Desktop/1.bin --tool ME --tab "Full Tree"
node Skills/run-byteripperweb/scripts/drive.mjs shot /tmp/panel.png
```

`open` prints what it got to, and fails loudly with the reason if it did not.
Screenshots are wherever you point `shot`; `/tmp` is a good place.

| command | what it does |
|---|---|
| `start [--port 9222] [--chrome P] [--width W] [--height H]` | launches headless Chrome with CDP and remembers it |
| `open <file> [--tool NAME] [--tab TEXT] [--url U]` | opens the dump, then optionally a tool and one of its tabs |
| `shot <path>` | PNG of the page |
| `eval "<js>"` | evaluates in the page and prints the value |
| `hover <what> [dx dy]` | moves the pointer over an element with nothing held |
| `drag <what> [dx dy]` | a real mouse drag from the element's centre, in 12 steps |
| `click <what>` | a real click |
| `rclick <what>` | a real right-click, which is what opens the app's own menus |

`<what>` is a selector, or `@x,y` for a point in the viewport. The dump needs
the point: its bytes, its addresses, its bookmark marks and its selection are
pixels on a canvas, so there is no element to name. Where a row is: the address
column is about 8px in from the pane's left edge, and a row is one row height
below the pane's top — read both off a screenshot rather than guessing.
| `keys <key>...` | `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Home`, `Enter`, `Escape` |
| `text` | the page's visible text |
| `stop` | closes the browser and forgets it |

A tool's name is matched against the Tools menu — `ME`, `FIT`, `UEFI` — and the
tab against your wording, `"Full Tree"`. A dump the app has not been pointed at
is the one thing that stops a check, so `open` takes a path; `~/Desktop/1.bin` is
the CSME 15 dump this project's firmware work is measured against.

## Run (human path)

```bash
npm run dev
```

Then open the address `.env.local` names — on this machine
`http://admins-imac:5173/ByteRipperWeb/`. Closing the server is Ctrl-C.

## Test

```bash
npm test
```

2552 pass. `src/core/document/binaryDocument.test.ts` has one case that times
out under a parallel run and passes on its own — `npx vitest run
src/core/document/binaryDocument.test.ts` to check it.

## Gotchas

- **The file chooser is the hard part.** The app reaches a dump through the File
  System Access picker, which headless Chrome cannot show. `open` deletes
  `showOpenFilePicker` before any app code runs so the app takes the
  `<input type="file">` fallback every other browser takes, intercepts the
  chooser, and sets the file on the input. Two things there are load-bearing:
  the click that opens it needs `Runtime.evaluate` with `userGesture: true` —
  Chrome opens no chooser for a script's click otherwise, and it fails silently
  — and the DOM agent needs a `DOM.getDocument` before `DOM.querySelector`,
  because that call is what fills its node map. Both are in the driver.
- **A drag must be a real drag.** `Input.dispatchMouseEvent` in steps, not a
  script calling the handlers: the app decides whether a gesture is running from
  `buttons`, and a synthetic `click()` carries none of that.
- **`--tool ME` is not a substring match.** The Tools menu's first row is
  "None", and `"None".includes("me")` is true. The driver takes a whole word
  first and only then a substring.
- **A CDP socket keeps node alive.** Every command ends in `process.exit(0)`;
  without it the script finishes its work and then hangs on the open socket,
  with no output, which reads exactly like a deadlock.
- **Headless Chrome writes to its profile while closing**, so deleting it can
  fail with `ENOTEMPTY`. It is a temp directory and the next `start` wipes it.
- The pane the dump lands in is `.hex-pane`. `.pane` matches nothing.
- **A menu this app opens is a list of `.menu-item` buttons.** `rclick` opens
  the one under the pointer; then
  `eval "Array.from(document.querySelectorAll('.menu-item')).map(e=>(e.disabled?'[x] ':'')+e.textContent).join(' | ')"`
  reads it — `disabled` is how a refused command says so — and
  `eval "Array.from(document.querySelectorAll('.menu-item'))[N].click()"` picks
  one. Escape closes the menu; a second Escape reaches the window behind it.

## Troubleshooting

- **`timed out waiting for the dump to open`**: the file was never handed over.
  The driver prints the step it reached and Chrome's reason. Usually the dump
  path is wrong, or another Chrome already holds port 9222.
- **`nothing is running: run drive.mjs start first`**: the state file is in
  `$TMPDIR/byteripperweb-run.json`, and `stop` removes it. A browser killed by
  hand leaves it behind — `start` again overwrites it.
- **`no Chrome found`**: pass `--chrome <path>` or set `$CHROME`.
- **The page is blank or on the landing screen after `open`**: the app was
  reloaded but the file did not go in; re-run `open`.
