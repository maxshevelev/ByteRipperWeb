// The app's windows (Design/DESKTOP_WINDOWS.md): one process, several windows, one workspace over
// them, as upstream's AppDelegate keeps them. Each window holds the page — what a browser tab is, a
// window is here — and records its own tab under its workspace id, as a browser tab does. This
// keeps the rest: the windows front to back, each one's frame and id, written down so a launch
// opens them all again (D2); making a new one cascaded off the one in front (D1); quitting — every
// window asked first, the last snapshot written, then the exit; and the project the app has open,
// which holds every window and is replaced whole (D3).

/** How far a new window stands off the one in front of it, down and to the right. */
const CASCADE = 26;
/** How long the structure waits after a move before it is written: a drag is many moves. */
const WRITE_DELAY_MS = 500;
/** How long a page is given to write its last snapshot and answer whether it asks. */
const QUERY_TIMEOUT_MS = 5000;

/**
 * Where a new window goes: off the window in front by one cascade step, or back at the work
 * area's top left when that would leave it hanging off the screen. Nothing in front: wherever the
 * system puts a new window.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.makeWindow
 * @upstream-differs AppKit cascades a window with no autosaved frame itself; Electron does not, so
 *   the step is worked out here
 */
function cascadeFrom(front, workArea) {
  if (front === undefined) return undefined;
  const width = Math.min(front.width, workArea.width);
  const height = Math.min(front.height, workArea.height);
  let x = front.x + CASCADE;
  let y = front.y + CASCADE;
  if (x + width > workArea.x + workArea.width) x = workArea.x;
  if (y + height > workArea.y + workArea.height) y = workArea.y;
  return { x, y, width, height };
}

/**
 * A recorded frame as it can be shown now: as it was while its title bar is on a screen, otherwise
 * nothing — the system places the window — since a screen unplugged since must not leave a window
 * out of reach.
 *
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.showWindow
 * @upstream-differs the frame is kept or dropped whole; AppKit's `constrainFrameRect` moves it
 */
function reachableFrame(frame, workAreas) {
  if (frame === undefined || !(frame.width > 0) || !(frame.height > 0)) return undefined;
  const bar = { x: frame.x, y: frame.y, width: frame.width, height: 30 };
  const meets = (area) =>
    bar.x < area.x + area.width &&
    bar.x + bar.width > area.x &&
    bar.y < area.y + area.height &&
    bar.y + bar.height > area.y;
  return workAreas.some(meets) ? frame : undefined;
}

/**
 * The structure as it is written: the windows front to back, each with its workspace id and frame,
 * or the project the app has open, whose own file holds its windows — only while every window
 * records itself (Settings ▸ General ▸ Reopen the workspace at launch).
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#WindowState
 * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore.lastProject
 * @upstream-differs a window's tab is its page's own record, under the id written here
 */
function structureOf(entries, project) {
  if (entries.some((one) => one.restores !== true || typeof one.id !== "string")) {
    return { version: 1, windows: [] };
  }
  if (project !== undefined) return { version: 1, project, windows: [] };
  return { version: 1, windows: entries.map(({ id, frame }) => ({ id, frame })) };
}

/**
 * @param deps.BrowserWindow Electron's
 * @param deps.Menu Electron's
 * @param deps.screen Electron's
 * @param deps.app Electron's
 * @param deps.create makes a window's `BrowserWindow` at the bounds given (or the system's place),
 *   handing its page the launch it is to settle (`{ id?, adopt, keep?, project? }`)
 * @param deps.store reads and writes the structure (`read()` → value or undefined, `write(value)`)
 * @param deps.projects projects on disk (`projects.cjs`), with `recent` its list of recent ones
 * @param deps.pickProjectToOpen asks, over a window, for a folder to open a project from
 * @param deps.pickProjectToSave asks, over a window, where to keep a project, suggesting a name
 * @param deps.confirmLeave asks, over a window, whether to leave its unsaved work; true to leave
 * @param deps.onStayed hears that a quit was given up because the reader stayed
 */
function register({
  BrowserWindow,
  Menu,
  screen,
  app,
  create,
  store,
  projects,
  pickProjectToOpen,
  pickProjectToSave,
  confirmLeave,
  onStayed,
}) {
  /** Front to back. */
  const order = [];
  /** Each window's own menu bar, as the page last handed it over. */
  const menus = new WeakMap();
  /** Each window's workspace id, and whether its page records it. */
  const holds = new WeakMap();
  /** Set while a quit asks the windows; the order is not rewritten meanwhile. */
  let quitting = false;
  /** Set once every window has agreed, so the windows go and the quit that follows is let through. */
  let leaving = false;
  /** Set while every window is closed for others: a project opened or closed. */
  let switching = false;
  let pendingWrite;
  let pendingProjectWrite;

  /**
   * The project the app has open, by its folder; nothing for the session without one.
   *
   * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.currentProject
   */
  let project;
  /** Each window's workspace as its page last recorded it into the project. */
  let projectTabs = new WeakMap();
  /** The keys of the bytes each window's page keeps in the project. */
  let projectKeys = new WeakMap();
  /** The workspace a window opened with a project restores, as the project's file holds it. */
  const projectSeeds = new WeakMap();

  const live = () => order.filter((window) => !window.isDestroyed());
  const front = () => live()[0];
  const projectInfo = () =>
    project === undefined ? undefined : { path: project, name: projects.projectName(project) };

  function toFront(window) {
    const at = order.indexOf(window);
    if (at > 0) {
      order.splice(at, 1);
      order.unshift(window);
    }
  }

  const frameOf = (window) => window.getNormalBounds?.() ?? window.getBounds();

  /** The structure as it stands now. */
  function structure() {
    return structureOf(
      live().map((window) => {
        const hold = holds.get(window);
        return { id: hold?.id, restores: hold?.restores, frame: frameOf(window) };
      }),
      project
    );
  }

  /** Writes the structure now. Nothing is written once the app has gone. */
  function writeNow() {
    clearTimeout(pendingWrite);
    pendingWrite = undefined;
    if (leaving) return;
    try {
      store.write(structure());
    } catch {
      // A structure that is not written is a launch that opens one window; the work is in the pages.
    }
  }

  /**
   * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.record
   * @upstream-differs only the structure, written when it changes; each page records its own tab
   */
  function record() {
    if (quitting || leaving || switching) return;
    clearTimeout(pendingWrite);
    pendingWrite = setTimeout(writeNow, WRITE_DELAY_MS);
    if (project !== undefined) recordProject();
  }

  /**
   * Writes the open project's file now: every window that has recorded into it, front to back,
   * with its id and frame; and once every window has said what it keeps, the bytes none of them
   * names any more go. Answers whether the project holds its file.
   *
   * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.record
   */
  function writeProjectNow() {
    clearTimeout(pendingProjectWrite);
    pendingProjectWrite = undefined;
    if (project === undefined) return false;
    const windows = live();
    const entries = windows
      .filter((window) => projectTabs.has(window))
      .map((window) => ({
        ...(holds.get(window)?.id === undefined ? {} : { id: holds.get(window).id }),
        frame: frameOf(window),
        workspace: projectTabs.get(window),
      }));
    try {
      projects.write(project, entries);
      if (windows.every((window) => projectKeys.has(window))) {
        const keys = new Set(windows.flatMap((window) => [...projectKeys.get(window)]));
        projects.removeKeptExcept(project, keys);
      }
    } catch {
      // The next snapshot tries again; what was written last stays.
    }
    return projects.holdsProject(project);
  }

  function recordProject() {
    if (quitting || leaving || switching) return;
    clearTimeout(pendingProjectWrite);
    pendingProjectWrite = setTimeout(writeProjectNow, WRITE_DELAY_MS);
  }

  /** Calls one of the page's answers to the shell (`shellWorkspace.ts`) and waits for it. */
  function call(window, name, ...args) {
    if (window.isDestroyed()) return Promise.resolve(undefined);
    const list = args.map((one) => JSON.stringify(one)).join(", ");
    return window.webContents
      .executeJavaScript(`window.__byteripperShell?.${name}?.(${list})`)
      .catch(() => undefined);
  }

  /** As `call`, but a page that does not answer in time is taken as having nothing to say. */
  function callBriefly(window, name) {
    const late = new Promise((resolve) => setTimeout(() => resolve(undefined), QUERY_TIMEOUT_MS));
    return Promise.race([call(window, name), late]);
  }

  /**
   * A new window: cascaded off the one in front, or at the frame and with the workspace a launch
   * restores. While a project is open the window is the project's.
   *
   * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.makeWindow
   */
  function makeWindow(restored) {
    const anchor = front();
    const bounds =
      restored?.frame !== undefined
        ? reachableFrame(
            restored.frame,
            screen.getAllDisplays().map((display) => display.workArea)
          )
        : anchor === undefined
          ? undefined
          : cascadeFrom(anchor.getBounds(), screen.getDisplayMatching(anchor.getBounds()).workArea);
    const info = projectInfo();
    const window = create(bounds, {
      ...(restored?.id === undefined ? {} : { id: restored.id }),
      adopt: restored?.adopt === true,
      ...(restored?.keep === undefined ? {} : { keep: restored.keep }),
      ...(info === undefined ? {} : { project: info }),
      ...(restored?.handover === undefined ? {} : { handover: restored.handover }),
    });
    if (restored?.seed !== undefined) projectSeeds.set(window, restored.seed);
    order.unshift(window);
    window.on("focus", () => {
      toFront(window);
      // A Mac has one menu bar, the key window's.
      if (process.platform === "darwin") Menu.setApplicationMenu(menus.get(window) ?? null);
      record();
    });
    window.on("move", record);
    window.on("resize", record);
    // The last window closing is the app quitting, kept in the workspace as it stands — the same
    // walk as Exit, so its last snapshot is written before the page goes.
    // @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.applicationShouldTerminateAfterLastWindowClosed
    window.on("close", (event) => {
      if (leaving || quitting || switching || live().length > 1) return;
      event.preventDefault();
      void quit();
    });
    window.on("closed", () => {
      const at = order.indexOf(window);
      if (at >= 0) order.splice(at, 1);
      if (leaving || quitting || switching) return;
      // A window closed while others stay leaves the workspace, and what its page kept goes.
      const hold = holds.get(window);
      const next = front();
      if (hold?.id !== undefined && next !== undefined) void call(next, "forget", hold.id);
      record();
    });
    return window;
  }

  /** The window's page says which workspace it is, and whether it records it. */
  function hold(window, id, restores) {
    holds.set(window, { id: String(id), restores: restores === true });
    record();
  }

  /** The window's menu bar, from the page in it. */
  function setMenu(window, menu) {
    menus.set(window, menu);
    if (process.platform === "darwin") {
      if (BrowserWindow.getFocusedWindow() === window) Menu.setApplicationMenu(menu);
    } else {
      window.setMenu(menu);
    }
  }

  /** The page's last snapshot, written, and whether leaving it would lose work it must ask about. */
  async function query(window) {
    const answer = await callBriefly(window, "quit");
    return answer?.asks === true;
  }

  /**
   * File ▸ Exit, ⌘Q, the last window's ✕ and the update installer: the structure is written as it
   * stands, every page writes its last snapshot and says whether it holds work it cannot keep,
   * and each that does asks, the window in front first — and only once every one has agreed do
   * the windows go. An answer to stay keeps them all, as upstream's quit does.
   *
   * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.applicationShouldTerminate
   * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.askToClose
   * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.recordFinal
   * @upstream ByteRipperApp/Workspace/WorkspaceRecorder.swift#WorkspaceRecorder.freezeOrder
   * @upstream-differs no "You have N documents…" question first: each window asks in turn, which
   *   is the Review Changes… path upstream's question leads to
   */
  async function quit() {
    if (quitting || leaving || switching) return;
    writeNow();
    quitting = true;
    const windows = live();
    const asks = await Promise.all(windows.map(query));
    writeProjectNow();
    for (const [index, window] of windows.entries()) {
      if (!asks[index] || window.isDestroyed()) continue;
      window.show();
      window.focus();
      if (!(await confirmLeave(window))) {
        quitting = false;
        onStayed?.();
        return;
      }
    }
    leaving = true;
    for (const window of live()) window.destroy();
    app.quit();
  }

  // ⌘Q from a Mac's application menu, and the system's own quit: the same walk as Exit.
  app.on("before-quit", (event) => {
    if (leaving || live().length === 0) return;
    event.preventDefault();
    void quit();
  });
  app.on("window-all-closed", () => {
    if (switching) return;
    leaving = true;
    app.quit();
  });

  /**
   * Every window closed — what each holds is written or answered for already — and `windows`
   * opened in their place, the front one made last and focused.
   *
   * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.closeEverythingKept
   */
  function replaceWindows(windows) {
    switching = true;
    for (const window of live()) window.destroy();
    order.length = 0;
    projectTabs = new WeakMap();
    projectKeys = new WeakMap();
    const list = windows.length === 0 ? [{}] : windows;
    for (const one of [...list].reverse()) makeWindow(one);
    switching = false;
    front()?.focus();
    writeNow();
  }

  /** The windows a project holds, opened in place of every window open now. */
  function openProjectWindows(folder, windows) {
    project = folder;
    replaceWindows(
      windows.map((one) => ({
        ...(typeof one.id === "string" ? { id: one.id } : {}),
        ...(one.frame === undefined ? {} : { frame: one.frame }),
        seed: one.workspace,
      }))
    );
  }

  /**
   * Clears the app for another project: the open project is written and goes without a question;
   * the session without a project, when it holds anything, is offered to be saved as one, and
   * otherwise each window asks about what would be lost. Answers whether to go on.
   *
   * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.leaveCurrentSession
   */
  async function leaveCurrent(issuer, suggestedName) {
    const windows = live();
    if (project !== undefined) {
      await Promise.all(windows.map((window) => callBriefly(window, "quit")));
      writeProjectNow();
      return true;
    }
    const holding = await Promise.all(
      windows.map((window) => callBriefly(window, "holdsAnything"))
    );
    if (!holding.some((one) => one === true)) return true;
    const answer = await call(issuer, "askSaveSession");
    if (answer === "save") return (await saveAsProject(issuer, suggestedName)).ok === true;
    if (answer !== "discard") return false;
    for (const window of windows) {
      if ((await call(window, "confirmDiscard")) !== true) return false;
    }
    await Promise.all(windows.map((window) => call(window, "discard")));
    return true;
  }

  /**
   * File ▸ Open Project… and Open Recent Project: the project in a folder — or in the one project
   * folder inside it — opened in place of every window. A path the page names is opened only when
   * it is one of the recent projects. Answers what the page is to say.
   *
   * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.openProject
   * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.openRecentProject
   */
  async function openProject(issuer, given, suggestedName) {
    if (given !== undefined && !projects.recent.has(given)) return {};
    const chosen = given ?? (await pickProjectToOpen(issuer));
    if (chosen === undefined) return {};
    const folder = projects.locate(chosen);
    const windows = folder === undefined ? undefined : projects.read(folder);
    if (windows === undefined) return { error: "unreadable", name: projects.projectName(chosen) };
    if (folder === project) return {};
    if (!(await leaveCurrent(issuer, suggestedName))) return {};
    projects.recent.record(folder);
    openProjectWindows(folder, windows);
    return {};
  }

  /**
   * File ▸ Save as Project…: every window — the session, or the open project — written into a new
   * project, which is then the one open.
   *
   * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.saveAsProject
   * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.saveSession
   */
  async function saveAsProject(issuer, suggestedName) {
    const name = project === undefined ? suggestedName : projects.projectName(project);
    const chosen = await pickProjectToSave(issuer, `${name}.brw`);
    if (chosen === undefined) return { ok: false };
    const was = project;
    const windows = live();
    // The project being left keeps what it had up to now.
    if (was !== undefined) {
      await Promise.all(windows.map((window) => callBriefly(window, "quit")));
      writeProjectNow();
    }
    let folder;
    try {
      folder = projects.prepare(chosen, name);
    } catch {
      return { ok: false, error: "unwritable", name: projects.projectName(chosen) };
    }
    project = folder;
    projectTabs = new WeakMap();
    projectKeys = new WeakMap();
    const info = projectInfo();
    await Promise.all(
      windows.map((window) => call(window, "projectChanged", info, was === undefined))
    );
    if (!writeProjectNow()) {
      project = was;
      const back = projectInfo();
      await Promise.all(windows.map((window) => call(window, "projectChanged", back, false)));
      return { ok: false, error: "unwritable", name: projects.projectName(folder) };
    }
    projects.recent.record(folder);
    writeNow();
    return { ok: true };
  }

  /**
   * File ▸ Close Project: the project left as it stands — everything in it is written already —
   * and one empty window in place of its windows.
   *
   * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.closeProject
   */
  async function closeProject() {
    if (project === undefined) return;
    await Promise.all(live().map((window) => callBriefly(window, "quit")));
    writeProjectNow();
    project = undefined;
    replaceWindows([]);
  }

  /** What the window's page restores from the project, once. */
  function projectWindow(window) {
    const seed = projectSeeds.get(window);
    projectSeeds.delete(window);
    return seed;
  }

  /** The window's page recorded its workspace into the project. */
  function projectRecorded(window, workspace) {
    if (project === undefined) return;
    projectTabs.set(window, workspace);
    recordProject();
  }

  /** The window's page says which bytes it keeps in the project. */
  function projectKeeps(window, keys) {
    if (project === undefined) return;
    projectKeys.set(window, new Set(keys.filter(projects.isKey)));
  }

  /**
   * The launch: the project open when the app was last closed, or every window the workspace
   * holds, the one in front made last so it ends up in front, or one window when it holds none —
   * which may take up the workspace a tab left before there were several windows.
   *
   * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.rebuild
   * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.applicationDidFinishLaunching
   */
  function launch() {
    let saved;
    try {
      saved = store.read();
    } catch {
      saved = undefined;
    }
    if (typeof saved?.project === "string") {
      const windows = projects.read(saved.project);
      if (windows !== undefined) {
        openProjectWindows(saved.project, windows);
        return;
      }
    }
    const windows = Array.isArray(saved?.windows)
      ? saved.windows.filter((one) => typeof one?.id === "string")
      : [];
    if (windows.length === 0) {
      makeWindow({ adopt: true });
      return;
    }
    const keep = windows.map((one) => one.id);
    for (const [index, one] of [...windows].reverse().entries()) {
      // The one made last — the front one — is told which workspaces the app still holds, so the
      // records of windows closed for good can go.
      makeWindow({
        id: one.id,
        frame: one.frame,
        ...(index === windows.length - 1 ? { keep } : {}),
      });
    }
    front()?.focus();
  }

  /** A second launch hands itself over: the window in front comes forward. */
  function bringForward() {
    const window = front();
    if (window === undefined) {
      makeWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  return {
    makeWindow,
    launch,
    hold,
    setMenu,
    quit,
    bringForward,
    openProject,
    saveAsProject,
    closeProject,
    projectWindow,
    projectRecorded,
    projectKeeps,
    currentProject: () => project,
    windows: live,
    structure,
  };
}

module.exports = { register, cascadeFrom, reachableFrame, structureOf, CASCADE };
