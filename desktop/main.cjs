// ByteRipper for Windows: the web edition in a window of its own.
//
// The page is served from a scheme of the app's own, `app://byteripper/`,
// registered as standard and secure. Both matter: a secure context is what
// the page's File System Access, its private storage (OPFS, which Duplicate
// needs) and the Cache API (yesterday's databases) all require, and a
// standard scheme is what gives the page an origin of its own for IndexedDB.
// `file://` would give neither.
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const updates = require("./update.cjs");

const SCHEME = "app";
const HOST = "byteripper";
/** The web build is made for GitHub Pages, under this subdirectory. */
const BASE = "/ByteRipperWeb/";
const WEB_ROOT = path.join(__dirname, "web");
/** Zoom levels are logarithmic: 0.5 is a step of about 10 %, and −3…5 is 58…250 %. */
const LEAVE_PROMPT = {
  en: {
    leave: "Leave",
    stay: "Stay",
    message: "Close with unsaved changes?",
    detail: "The changes you made will be lost.",
  },
  ru: {
    leave: "Выйти",
    stay: "Остаться",
    message: "Закрыть без сохранения изменений?",
    detail: "Внесённые изменения будут потеряны.",
  },
  de: {
    leave: "Verlassen",
    stay: "Bleiben",
    message: "Mit ungesicherten Änderungen schließen?",
    detail: "Ihre Änderungen gehen verloren.",
  },
};
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -3;
const ZOOM_MAX = 5;

/** Where the zoom is kept between runs: beside the profile's other state. */
const zoomFile = () => path.join(app.getPath("userData"), "zoom.json");
const clampZoom = (level) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));

/** The zoom the last run ended with, or 100 % when there is none to trust. */
function savedZoom() {
  try {
    const { level } = JSON.parse(fs.readFileSync(zoomFile(), "utf8"));
    return Number.isFinite(level) ? clampZoom(level) : 0;
  } catch {
    return 0;
  }
}

/** Kept as it is chosen, so a run that ends any way at all still has it. */
function rememberZoom(level) {
  try {
    fs.writeFileSync(zoomFile(), JSON.stringify({ level }));
  } catch {
    // A zoom that is not remembered is a zoom the reader sets again.
  }
}

// `npm start` runs Electron from the source tree, and a build made earlier may
// be open at the same time. Two processes on one profile fight over its locked
// databases — Chromium then says "Failed to reset the quota database" and takes
// a long time to start — so a development run keeps a profile of its own.
if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "ByteRipper-dev"));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/** The file under `web/` a request names, or nothing for a path outside it. */
function fileFor(requestUrl) {
  const { pathname } = new URL(requestUrl);
  const relative = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.slice(1);
  const file = path.normalize(path.join(WEB_ROOT, decodeURIComponent(relative) || "index.html"));
  return file.startsWith(WEB_ROOT) ? file : undefined;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "ByteRipper",
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  // A link out of the help — [[web:https://…]] — opens in the system's
  // browser, never in a second app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  // The page arms `beforeunload` while anything is unsaved. A browser asks the
  // reader; Electron, given no handler, silently keeps the window open — Exit
  // and the window's ✕ would do nothing. So the shell asks, in the system's
  // language, and lets the window go when the answer is to leave.
  window.webContents.on("will-prevent-unload", (event) => {
    const words = LEAVE_PROMPT[app.getLocale().slice(0, 2)] ?? LEAVE_PROMPT.en;
    const choice = dialog.showMessageBoxSync(window, {
      type: "warning",
      buttons: [words.leave, words.stay],
      defaultId: 1,
      cancelId: 1,
      message: words.message,
      detail: words.detail,
    });
    if (choice === 0) event.preventDefault();
    else updates.stayed();
  });
  // Electron does not keep a page's zoom between runs. It is set again once the
  // page is up, which is when the zoom of its origin exists to be set.
  window.webContents.once("did-finish-load", () => window.webContents.setZoomLevel(savedZoom()));
  void window.loadURL(`${SCHEME}://${HOST}${BASE}index.html`);
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, (request) => {
    const file = fileFor(request.url);
    if (file === undefined) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // What the page asks the browser for — opening and saving files, the
  // clipboard — is what the app is for, and there is no one else to ask.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, grant) =>
    grant(true)
  );
  session.defaultSession.setPermissionCheckHandler(() => true);

  // No menu bar until the page hands over its own: Electron's default one
  // carries Reload, which would throw every open file away.
  Menu.setApplicationMenu(null);

  // The page's command menu, as the menu bar. It arrives as data and comes
  // back as an id; the page runs the command. The shortcuts are drawn beside
  // the items but not registered — the page answers its own keys, and a menu
  // that answered them too would run every command twice.
  ipcMain.on("menu:set", (event, menus) => {
    // The page's command runs as a user gesture: Chromium shows a file picker
    // — Open…, Save As… — only to code handling one, and a message over IPC
    // carries none. `userGesture` is what a click in the page itself has.
    const click = (id) => () =>
      void event.sender.executeJavaScript(
        `window.__byteripperMenuCommand(${JSON.stringify(id)})`,
        true
      );
    const item = (one) =>
      one.type === "separator"
        ? { type: "separator" }
        : {
            type: one.type,
            label: one.label,
            enabled: one.enabled !== false,
            ...(one.checked === undefined ? {} : { checked: one.checked }),
            ...(one.accelerator === undefined
              ? {}
              : {
                  accelerator: one.accelerator,
                  registerAccelerator: one.registerAccelerator === true,
                }),
            ...(one.id === undefined ? {} : { click: click(one.id) }),
          };
    // Zoom In is Ctrl+Plus, and on most keyboards that is Ctrl+= as well, or the
    // numeric pad's: the same command under the other spellings, not drawn.
    const ALSO = {
      "CmdOrCtrl+Plus": ["CmdOrCtrl+=", "CmdOrCtrl+numadd"],
      "CmdOrCtrl+-": ["CmdOrCtrl+numsub"],
    };
    const items = (list) =>
      list.flatMap((one) => [
        item(one),
        ...(one.registerAccelerator === true ? (ALSO[one.accelerator] ?? []) : []).map(
          (accelerator) => ({ ...item(one), accelerator, visible: false })
        ),
      ]);
    const template = menus.map((menu) => ({ label: menu.label, submenu: items(menu.items) }));
    // A Mac's first menu is the application's, whatever it is given.
    if (process.platform === "darwin") template.unshift({ role: "appMenu" });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  });

  // The View menu's zoom: the window's page zoom, which is the only zoom the
  // page has (Help ▸ Moving around). Chromium's own Ctrl+Plus/Minus went with
  // the default menu, so the menu answers them.
  ipcMain.on("zoom", (event, step) => {
    const contents = event.sender;
    const level = clampZoom(step === 0 ? 0 : contents.getZoomLevel() + step * ZOOM_STEP);
    contents.setZoomLevel(level);
    rememberZoom(level);
  });

  // File ▸ Exit: the window closes as its ✕ would, so unsaved work is asked
  // about on the way out, and the last window closing quits the app.
  ipcMain.on("quit", (event) => BrowserWindow.fromWebContents(event.sender)?.close());

  updates.register(ipcMain, BrowserWindow);

  createWindow();
});

app.on("window-all-closed", () => app.quit());
