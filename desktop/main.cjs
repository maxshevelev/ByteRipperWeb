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
  MessageChannelMain,
  net,
  protocol,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const agent = require("./agent.cjs");
const updates = require("./update.cjs");
const appWindows = require("./windows.cjs");
const projects = require("./projects.cjs");
const hostDisk = require("./hostDisk.cjs");

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

// One process, however often the app is launched (Design/DESKTOP_WINDOWS.md): a second launch
// hands itself to the first — which brings its window in front forward — and goes. Two processes
// on one profile would fight over its databases, and the Web Locks that keep one workspace and one
// project to one window do not reach from one process into another. The lock is the profile's,
// so it is taken after the development run has picked its own.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

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

/**
 * Whether an address is the app's own page — `app://byteripper/…`, or a `blob:`
 * it made. Only that page is given the bridge's answers, the permissions and
 * the window: anything else that ended up in the window would otherwise be
 * handed every permission and an installer.
 */
function isApp(address) {
  try {
    const url = new URL(String(address).replace(/^blob:/, ""));
    return url.protocol === `${SCHEME}:` && url.host === HOST;
  } catch {
    return false;
  }
}

/** Whether an IPC message came from the app's own page, in its own frame. */
function fromApp(event) {
  return isApp(event.senderFrame?.url);
}

/** The file under `web/` a request names, or nothing for a path outside it. */
function fileFor(requestUrl) {
  const { pathname } = new URL(requestUrl);
  const relative = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.slice(1);
  const file = path.normalize(path.join(WEB_ROOT, decodeURIComponent(relative) || "index.html"));
  return file.startsWith(WEB_ROOT) ? file : undefined;
}

/**
 * The launch height: the standard 900, or the screen's usable height when that is less. Only
 * the screen bounds it — the three-quarters cap of an earlier port is gone, as upstream's
 * (`bd20f98`), since the landing screen is what decides how tall a launch window wants to
 * be.
 *
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.maxLaunchHeight
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.launchHeight
 */
function launchHeight(standard) {
  return Math.min(standard, screen.getPrimaryDisplay().workAreaSize.height);
}

/**
 * Where the workspace's structure is written — the windows front to back, each one's workspace id
 * and frame (Design/DESKTOP_WINDOWS.md, D2) — beside the profile, as upstream keeps its
 * `Workspace.json` in Application Support. Each window's tab is its page's own record.
 */
const structureFile = () => path.join(app.getPath("userData"), "Workspace", "Windows.json");

const structureStore = {
  read() {
    try {
      return JSON.parse(fs.readFileSync(structureFile(), "utf8"));
    } catch {
      return undefined;
    }
  },
  write(value) {
    const file = structureFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Whole or not at all: a quit half-way through a write leaves the last one.
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
    fs.renameSync(temporary, file);
  },
};

/** Where the app's own windows — the help, the annotations, the agent — last stood. */
const ownFramesFile = () => path.join(app.getPath("userData"), "Workspace", "OwnWindows.json");

const ownFramesStore = {
  read() {
    try {
      return JSON.parse(fs.readFileSync(ownFramesFile(), "utf8"));
    } catch {
      return undefined;
    }
  },
  write(value) {
    const file = ownFramesFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  },
};

/** The size each of the app's own windows opens at the first time, before it has a frame kept. */
const OWN_SIZES = {
  help: { width: 980, height: 760 },
  notes: { width: 760, height: 720 },
  agent: { width: 720, height: 720 },
};

/**
 * What a page may hand the app's own window to show — a help page's link, an annotation's id —
 * as plain data of a modest size, or nothing.
 */
function ownMessage(message) {
  if (message === undefined || message === null) return undefined;
  try {
    const text = JSON.stringify(message);
    return text.length <= 64 * 1024 ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/** The projects opened lately, kept beside the structure. */
const recentProjects = projects.recentStore(() =>
  path.join(app.getPath("userData"), "Workspace", "RecentProjects.json")
);

/** What each window's page settles its workspace by, as its launch handed it. */
const launches = new WeakMap();

/** The words of each window's text-field menu, in its page's language, as the page handed them. */
const fieldMenus = new WeakMap();

/** Until the page has said, the field menu's words in English. */
const FIELD_MENU = { cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All" };

/**
 * A text field's right-click menu: Cut, Copy, Paste and Select All, the system's own editing
 * commands, each available as the field says it is. Electron brings a page no menu at all, and
 * the page leaves a field's right-click to whoever shows the standard one — the browser, or here.
 */
function showFieldMenu(window, params) {
  if (!params.isEditable) return;
  const words = fieldMenus.get(window.webContents) ?? FIELD_MENU;
  const can = params.editFlags;
  Menu.buildFromTemplate([
    { role: "cut", label: words.cut, enabled: can.canCut },
    { role: "copy", label: words.copy, enabled: can.canCopy },
    { role: "paste", label: words.paste, enabled: can.canPaste },
    { type: "separator" },
    { role: "selectAll", label: words.selectAll, enabled: can.canSelectAll },
  ]).popup({ window });
}

/** Asks over `window` whether to leave its unsaved work, in the system's language. */
function confirmLeave(window) {
  const words = LEAVE_PROMPT[app.getLocale().slice(0, 2)] ?? LEAVE_PROMPT.en;
  const choice = dialog.showMessageBoxSync(window, {
    type: "warning",
    buttons: [words.leave, words.stay],
    defaultId: 1,
    cancelId: 1,
    message: words.message,
    detail: words.detail,
  });
  return choice === 0;
}

/** A window holding the page: at the bounds given, or the launch size where the system puts it. */
function createWindow(bounds, launch, shown = true) {
  const window = new BrowserWindow({
    ...(bounds ?? { width: 1400, height: launchHeight(900) }),
    show: shown,
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
  // The window shows the app and nothing else: a link that would take it away —
  // a file dropped on it, a page that sets `location` — goes nowhere, and a web
  // link goes to the system's browser as the help's links do.
  window.webContents.on("will-navigate", (event, url) => {
    if (isApp(url)) return;
    event.preventDefault();
    if (url.startsWith("https://")) void shell.openExternal(url);
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isApp(url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("context-menu", (_event, params) => showFieldMenu(window, params));
  // The page arms `beforeunload` while anything is unsaved. A browser asks the
  // reader; Electron, given no handler, silently keeps the window open — Exit
  // and the window's ✕ would do nothing. So the shell asks, in the system's
  // language, and lets the window go when the answer is to leave.
  window.webContents.on("will-prevent-unload", (event) => {
    if (confirmLeave(window)) event.preventDefault();
    else updates.stayed();
  });
  // Electron does not keep a page's zoom between runs. It is set again once the
  // page is up, which is when the zoom of its origin exists to be set.
  window.webContents.once("did-finish-load", () => window.webContents.setZoomLevel(savedZoom()));
  launches.set(window.webContents, launch ?? { adopt: false });
  void window.loadURL(`${SCHEME}://${HOST}${BASE}index.html`);
  return window;
}

/** The app's windows, once the app is ready. */
let windows;

app.whenReady().then(() => {
  if (!primary) return;
  windows = appWindows.register({
    BrowserWindow,
    Menu,
    screen,
    app,
    create: createWindow,
    store: structureStore,
    projects: { ...projects, recent: recentProjects },
    // A project is a folder: the system's own panel picks one, and gives its path.
    pickProjectToOpen: async (window) => {
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
      });
      return canceled ? undefined : filePaths[0];
    },
    pickProjectToSave: async (window, name) => {
      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        defaultPath: path.join(app.getPath("documents"), name),
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      return canceled || !filePath ? undefined : filePath;
    },
    confirmLeave: async (window) => confirmLeave(window),
    onStayed: () => updates.stayed(),
    createOwn: (kind, bounds, message, shown) =>
      createWindow(
        bounds ?? OWN_SIZES[kind],
        { adopt: false, own: kind, ...(message === undefined ? {} : { show: message }) },
        shown
      ),
    ownFrames: ownFramesStore,
  });
  protocol.handle(SCHEME, (request) => {
    const file = fileFor(request.url);
    if (file === undefined) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // What the page asks the browser for — opening and saving files, the
  // clipboard — is what the app is for, and there is no one else to ask. The
  // app's page, that is: nothing else is given anything.
  session.defaultSession.setPermissionRequestHandler((contents, _permission, grant, details) =>
    grant(isApp(details?.requestingUrl || contents.getURL()))
  );
  session.defaultSession.setPermissionCheckHandler((_contents, _permission, origin, details) =>
    isApp(details?.requestingUrl || origin)
  );

  // No menu bar until the page hands over its own: Electron's default one
  // carries Reload, which would throw every open file away.
  Menu.setApplicationMenu(null);

  // The page's command menu, as the menu bar. It arrives as data and comes
  // back as an id; the page runs the command. The shortcuts are drawn beside
  // the items but not registered — the page answers its own keys, and a menu
  // that answered them too would run every command twice.
  ipcMain.on("menu:set", (event, menus) => {
    if (!fromApp(event)) return;
    // The page's command runs as a user gesture: Chromium shows a file picker
    // — Open…, Save As… — only to code handling one, and a message over IPC
    // carries none. `userGesture` is what a click in the page itself has.
    const click = (id) => () =>
      void event.sender.executeJavaScript(
        `window.__byteripperMenuCommand(${JSON.stringify(id)})`,
        true
      );
    const item = (one) => {
      if (one.type === "separator") return { type: "separator" };
      // File ▸ Open Recent is a menu of its own; its rows are items of their own.
      if (one.type === "submenu")
        return { type: "submenu", label: one.label, submenu: one.submenu.map(item) };
      // Cut, Copy and Paste are the system's: the role raises the focused element's event, which
      // a text field answers with its text and the dump with its bytes. Without them a Mac's
      // Electron has no ⌘X, ⌘C or ⌘V in a field at all.
      if (one.role !== undefined)
        return {
          role: one.role,
          label: one.label,
          enabled: one.enabled !== false,
          ...(one.accelerator === undefined ? {} : { accelerator: one.accelerator }),
        };
      return {
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
    // Each window's own: the commands in it run in that window's page.
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) windows.setMenu(window, Menu.buildFromTemplate(template));
  });

  // The View menu's zoom: the window's page zoom, which is the only zoom the
  // page has (Help ▸ Moving around). Chromium's own Ctrl+Plus/Minus went with
  // the default menu, so the menu answers them.
  ipcMain.on("menu:field", (event, labels) => {
    if (!fromApp(event)) return;
    const words = {};
    for (const key of Object.keys(FIELD_MENU)) {
      words[key] = typeof labels?.[key] === "string" ? labels[key] : FIELD_MENU[key];
    }
    fieldMenus.set(event.sender, words);
  });

  ipcMain.on("zoom", (event, step) => {
    if (!fromApp(event)) return;
    const contents = event.sender;
    const level = clampZoom(step === 0 ? 0 : contents.getZoomLevel() + step * ZOOM_STEP);
    contents.setZoomLevel(level);
    rememberZoom(level);
  });

  // File ▸ Exit: every window writes its last snapshot and asks about what it cannot keep, front
  // to back, and only then do they all go.
  ipcMain.on("quit", (event) => {
    if (fromApp(event)) void windows.quit();
  });
  // Which workspace a window's page is to be (D2): the one its launch restores, or a fresh one.
  ipcMain.on("window:launch", (event) => {
    event.returnValue = fromApp(event) ? (launches.get(event.sender) ?? { adopt: false }) : null;
  });
  // The page says which workspace it is, and whether it records it.
  ipcMain.on("workspace:hold", (event, id, restores) => {
    if (!fromApp(event) || typeof id !== "string") return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) windows.hold(window, id, restores === true);
  });
  // File ▸ New Window and File ▸ Close Window.
  // @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.newWindow
  // A window torn off with a pane or files (D5) is told whom to take them from: the page's word,
  // passed on as it is, which the new page answers only through the other windows.
  ipcMain.on("window:new", (event, handover) => {
    if (!fromApp(event)) return;
    const valid =
      handover !== null &&
      typeof handover === "object" &&
      (handover.kind === "pane" || handover.kind === "files") &&
      typeof handover.from === "string";
    windows.makeWindow(valid ? { handover } : undefined);
  });
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.closeWindow
  ipcMain.on("window:close", (event) => {
    if (fromApp(event)) BrowserWindow.fromWebContents(event.sender)?.close();
  });
  // The app's own windows (D7): Help ▸ …, Window ▸ Annotations and Agent open the one window of
  // the kind, or bring it forward, at what the page names.
  ipcMain.on("window:own", (event, kind, message) => {
    if (fromApp(event) && typeof kind === "string") windows.openOwn(kind, ownMessage(message));
  });

  // Projects (D3): every window's, written by this process into the folder of the one open. A page
  // names a key to keep bytes under, never a path to write; the one path it may name is a recent
  // project's, to open it.
  const sender = (event) => (fromApp(event) ? BrowserWindow.fromWebContents(event.sender) : null);
  const openFolder = () => {
    const folder = windows.currentProject();
    if (folder === undefined) throw new Error("No project is open.");
    return folder;
  };
  ipcMain.handle("project:window", (event) => {
    const window = sender(event);
    return window ? windows.projectWindow(window) : undefined;
  });
  ipcMain.handle("project:record", (event, workspace) => {
    const window = sender(event);
    if (window) windows.projectRecorded(window, workspace);
  });
  ipcMain.handle("project:keeps", (event, keys) => {
    const window = sender(event);
    if (window && Array.isArray(keys)) windows.projectKeeps(window, keys);
  });
  // A kept document's content (P5–P6 of the persistent-undo port): its log, its base, written,
  // read, cut back and put on the disk by name, under the open project's `Kept/` and nowhere else.
  // The session host's disk (Design/FILE_SESSIONS.md, S7): a port for the page to hand to the
  // host, answered here. Every window asks for one; the host keeps whichever is still there.
  ipcMain.on("host:port", (event) => {
    if (!fromApp(event)) return;
    const { port1, port2 } = new MessageChannelMain();
    hostDisk.serve(port1, app.getPath("userData"), () => windows.currentProject());
    event.sender.postMessage("host:port", null, [port2]);
  });
  ipcMain.handle("project:kept", (event, request) => {
    if (!sender(event)) throw new Error("Not the app's page.");
    const folder = openFolder();
    const at = Number(request?.at ?? 0);
    if (!Number.isSafeInteger(at) || at < 0) throw new Error("Not a place in a kept file.");
    switch (request?.op) {
      case "write":
        if (!(request.bytes instanceof Uint8Array)) throw new Error("Not bytes.");
        return projects.writeLog(folder, request.name, at, request.bytes);
      case "read": {
        const count = Number(request.count);
        if (!Number.isSafeInteger(count) || count < 0 || count > 64 << 20) {
          throw new Error("Not a length to read.");
        }
        return projects.readLog(folder, request.name, at, count);
      }
      case "truncate":
        return projects.truncateLog(folder, request.name, at);
      case "sync":
        return projects.syncLog(folder, request.name);
      case "size":
        return projects.keptSize(folder, request.name);
      default:
        throw new Error(`Unknown kept request: ${request?.op}`);
    }
  });
  ipcMain.handle("project:open", (event, given, suggestedName) => {
    const window = sender(event);
    return window
      ? windows.openProject(
          window,
          typeof given === "string" ? given : undefined,
          String(suggestedName)
        )
      : {};
  });
  ipcMain.handle("project:save-as", (event, suggestedName) => {
    const window = sender(event);
    return window ? windows.saveAsProject(window, String(suggestedName)) : { ok: false };
  });
  ipcMain.handle("project:close", (event) => {
    if (sender(event)) return windows.closeProject();
  });
  ipcMain.handle("project:recent", (event) => (sender(event) ? recentProjects.list() : []));
  ipcMain.handle("project:clear-recent", (event) => {
    if (sender(event)) recentProjects.clear();
  });

  // Show in Its Window (D4): the window holding a file brings itself forward. A page cannot raise
  // its own window; the windows find the file among themselves (`openOnce.ts`).
  ipcMain.on("window:focus", (event) => {
    const window = sender(event);
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  updates.register(ipcMain, BrowserWindow, fromApp, () => void windows.quit());
  // The agent service runs in the Agent window's page (D7d): it is made, out of sight, when a
  // window turns the service on, and only that page holds the endpoint.
  agent.register(ipcMain, fromApp, app, {
    host: () => windows.openOwn("agent", undefined, false)?.webContents,
    isHost: (contents) => windows.ownKindOf(BrowserWindow.fromWebContents(contents)) === "agent",
  });

  windows.launch();
});

app.on("second-instance", () => windows?.bringForward());
// A Mac's Dock icon clicked with every window closed.
app.on("activate", () => {
  if (windows !== undefined && windows.windows().length === 0) windows.makeWindow();
});
