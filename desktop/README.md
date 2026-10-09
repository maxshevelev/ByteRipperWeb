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
npm run dist:win                        # release/ByteRipper-<version>-setup.exe, -portable.exe and -win.zip
npm run open                            # the same window without rebuilding the web edition
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

**The agent service** (`../Design/PORT_AGENT.md`). `agent.cjs` listens on a
named pipe (`\\.\pipe\ByteRipper-agent-<user>`; a Unix socket elsewhere,
`agent-endpoint.cjs` says where) while the page says the service is on, and
copies bytes between each connection and the page through the preload bridge
(`byteripperDesktop.agent`); it knows no message — MCP, the tools and every
answer are the page's. `relay.cjs` is what an agent's client launches: the
app's own executable run as Node (`ELECTRON_RUN_AS_NODE=1`), which connects
stdin and stdout to the pipe and starts the app if nothing is listening. Both
files are unpacked from the asar (`asarUnpack`), since a client runs the relay
by a path on disk. Files by path (`open_dump`, `survey`) are read here, only
while the service is on and only for the app's own page. `npm test` runs the
transport and the relay.

**Start-up time.** The portable `.exe` unpacks the whole application into a
temporary folder on every launch, and the antivirus scans it each time, so it
is the slowest way to start. The setup installs once, per user and without
asking for administrator rights, and then starts from files already on disk;
the `.zip` does the same when unpacked. Only the Electron locales the app is
translated into (en, ru, de) are shipped.

**The `global-agent` override.** electron-builder reaches Electron's download
through `@electron/get` 3, which asks for `global-agent` 3, which pulls
`roarr` and `sprintf-js` — a denial-of-service advisory with no fixed
`sprintf-js`. `global-agent` 4 has the same `bootstrap()` and no `roarr`, so
`package.json` overrides it to `^4.1.3`. It is used only when
`ELECTRON_GET_USE_PROXY` is set. Drop the override once electron-builder moves
to `@electron/get` 5, which has no `global-agent` at all. Do not take
`npm audit fix --force`: it "fixes" this by downgrading electron-builder.

Not done yet: code signing (SmartScreen warns on first launch) and a check on
a real Windows machine.
