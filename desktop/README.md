# ByteRipper for Windows (optional)

The web edition in a window of its own, built with Electron. The web app is
the product; this is a wrapper around its production build
(Design/IMPLEMENTATION_PLAN.md, D15). Its one hook in `src/` is optional —
the native menu bar below — and a browser never sees it.

```bash
cd desktop
npm install
node node_modules/electron/install.js   # if npm skipped Electron's download
npm start                               # build the web edition and open it here
npm run dist:win                        # release/ByteRipper-<version>-portable.exe and -win.zip
```

How it works:

- `copy-web.mjs` copies `../dist` (the web build) into `web/`.
- `main.cjs` serves `web/` from `app://byteripper/`, a scheme registered as
  standard and secure: that is what gives the page File System Access (save in
  place), OPFS (Duplicate) and the Cache API (yesterday's databases). `file://`
  would give none of them.
- Every permission the page asks for is granted — opening files and the
  clipboard are what the app is for, and there is nobody else to ask.
- **The command menu is the window's menu bar**, and the ☰ button is not
  drawn. `preload.cjs` gives the page one bridge, `byteripperDesktop`; the page
  (`src/ui/shell/desktopMenu.ts`) sends its command list as data whenever it
  changes — File, Edit, Bookmarks, Segments, View, Tools, Help, with Settings…
  at the foot of File — and `main.cjs` builds the native menu from it. A click
  runs the page's own command by its id, so no command is written twice — and
  it runs as a user gesture (`executeJavaScript(…, true)`), because Chromium
  shows a file picker (Open…, Save As…) only to code handling one, and a
  message over IPC is not. The shortcuts are shown but not registered: the page answers
  its own keys, and a menu answering them too would run each command twice.
- Electron's default menu is never shown: its Reload would throw the open
  files away. Links out of the help open in the system browser.

- **The icon is upstream's.** `build/icon.ico` is made by `make-icon.py`
  from the ByteRipper clone's `AppIcon.appiconset` — the sizes it has are
  copied, 24 and 48 are downsampled from its 1024 master with `sips`, as
  upstream's own `render-appicon.sh` does. Run it again when upstream's icon
  changes (macOS; `$BYTERIPPER_REPO` or `../../ByteRipper`).
- **The File menu's keys** — Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S, as
  upstream's File menu has them, and Close on Ctrl+F4, Windows' own (Ctrl+W
  works too; a Mac shows ⌘W). The page answers them itself; in a browser
  Ctrl+N and Ctrl+W are the browser's, so the web menu lists only the other
  three.

Not done yet: code signing (SmartScreen warns on first launch), an installer,
and a check on a real Windows machine.
