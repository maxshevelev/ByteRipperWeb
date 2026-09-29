// ByteRipper for Windows: the web edition in a window of its own.
//
// The page is served from a scheme of the app's own, `app://byteripper/`,
// registered as standard and secure. Both matter: a secure context is what
// the page's File System Access, its private storage (OPFS, which Duplicate
// needs) and the Cache API (yesterday's databases) all require, and a
// standard scheme is what gives the page an origin of its own for IndexedDB.
// `file://` would give neither.
const { app, BrowserWindow, ipcMain, Menu, net, protocol, session, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCHEME = "app";
const HOST = "byteripper";
/** The web build is made for GitHub Pages, under this subdirectory. */
const BASE = "/ByteRipperWeb/";
const WEB_ROOT = path.join(__dirname, "web");

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
              : { accelerator: one.accelerator, registerAccelerator: false }),
            ...(one.id === undefined ? {} : { click: click(one.id) }),
          };
    const template = menus.map((menu) => ({ label: menu.label, submenu: menu.items.map(item) }));
    // A Mac's first menu is the application's, whatever it is given.
    if (process.platform === "darwin") template.unshift({ role: "appMenu" });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  });

  createWindow();
});

app.on("window-all-closed", () => app.quit());
