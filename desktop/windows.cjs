// The app's windows (Design/DESKTOP_WINDOWS.md): one process, several windows, one workspace over
// them, as upstream's AppDelegate keeps them. Each window holds the page — what a browser tab is, a
// window is here — and records its own tab under its workspace id, as a browser tab does. This
// keeps the rest: the windows front to back, each one's frame and id, written down so a launch
// opens them all again (D2); making a new one cascaded off the one in front (D1); and quitting —
// every window asked first, the last snapshot written, then the exit.

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
 * The structure as it is written: the windows front to back, each with its workspace id and frame
 * — only while every window records itself (Settings ▸ General ▸ Reopen the workspace at launch).
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#WindowState
 * @upstream-differs a window's tab is its page's own record, under the id written here
 */
function structureOf(entries) {
  if (entries.some((one) => one.restores !== true || typeof one.id !== "string")) {
    return { version: 1, windows: [] };
  }
  return { version: 1, windows: entries.map(({ id, frame }) => ({ id, frame })) };
}

/**
 * @param deps.BrowserWindow Electron's
 * @param deps.Menu Electron's
 * @param deps.screen Electron's
 * @param deps.app Electron's
 * @param deps.create makes a window's `BrowserWindow` at the bounds given (or the system's place),
 *   handing its page the launch it is to settle (`{ id?, adopt, keep? }`)
 * @param deps.store reads and writes the structure (`read()` → value or undefined, `write(value)`)
 * @param deps.confirmLeave asks, over a window, whether to leave its unsaved work; true to leave
 * @param deps.onStayed hears that a quit was given up because the reader stayed
 */
function register({ BrowserWindow, Menu, screen, app, create, store, confirmLeave, onStayed }) {
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
  let pendingWrite;

  const live = () => order.filter((window) => !window.isDestroyed());
  const front = () => live()[0];

  function toFront(window) {
    const at = order.indexOf(window);
    if (at > 0) {
      order.splice(at, 1);
      order.unshift(window);
    }
  }

  /** The structure as it stands now. */
  function structure() {
    return structureOf(
      live().map((window) => {
        const hold = holds.get(window);
        return {
          id: hold?.id,
          restores: hold?.restores,
          frame: window.getNormalBounds?.() ?? window.getBounds(),
        };
      })
    );
  }

  /** Writes the structure now. Nothing is written while a quit is asking, or once it has gone. */
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
    if (quitting || leaving) return;
    clearTimeout(pendingWrite);
    pendingWrite = setTimeout(writeNow, WRITE_DELAY_MS);
  }

  /**
   * A new window: cascaded off the one in front, or at the frame and with the workspace a launch
   * restores.
   *
   * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.makeWindow
   */
  function makeWindow(restored) {
    const anchor = front();
    const bounds =
      restored !== undefined
        ? reachableFrame(
            restored.frame,
            screen.getAllDisplays().map((display) => display.workArea)
          )
        : anchor === undefined
          ? undefined
          : cascadeFrom(anchor.getBounds(), screen.getDisplayMatching(anchor.getBounds()).workArea);
    const window = create(bounds, {
      ...(restored?.id === undefined ? {} : { id: restored.id }),
      adopt: restored?.adopt === true,
      ...(restored?.keep === undefined ? {} : { keep: restored.keep }),
    });
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
      if (leaving || quitting || live().length > 1) return;
      event.preventDefault();
      void quit();
    });
    window.on("closed", () => {
      const at = order.indexOf(window);
      if (at >= 0) order.splice(at, 1);
      if (leaving || quitting) return;
      // A window closed while others stay leaves the workspace, and what its page kept goes.
      const hold = holds.get(window);
      const next = front();
      if (hold?.id !== undefined && next !== undefined) {
        void next.webContents
          .executeJavaScript(`window.__byteripperForgetWorkspace?.(${JSON.stringify(hold.id)})`)
          .catch(() => undefined);
      }
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
  function query(window) {
    const asked = window.webContents
      .executeJavaScript("window.__byteripperQuit ? window.__byteripperQuit() : { asks: false }")
      .then((answer) => answer?.asks === true)
      .catch(() => false);
    const late = new Promise((resolve) => setTimeout(() => resolve(false), QUERY_TIMEOUT_MS));
    return Promise.race([asked, late]);
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
    if (quitting || leaving) return;
    writeNow();
    quitting = true;
    const windows = live();
    const asks = await Promise.all(windows.map(query));
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
    leaving = true;
    app.quit();
  });

  /**
   * The launch: every window the workspace holds, the one in front made last so it ends up in
   * front, or one window when it holds none — which may take up the workspace a tab left before
   * there were several windows.
   *
   * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.rebuild
   */
  function launch() {
    let saved;
    try {
      saved = store.read();
    } catch {
      saved = undefined;
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

  return { makeWindow, launch, hold, setMenu, quit, bringForward, windows: live, structure };
}

module.exports = { register, cascadeFrom, reachableFrame, structureOf, CASCADE };
