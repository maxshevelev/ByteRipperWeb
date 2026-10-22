// The app's windows (Design/DESKTOP_WINDOWS.md, D1): one process, several windows, as upstream's
// AppDelegate keeps them. Each window holds the page — what a browser tab is, a window is here —
// and this keeps the list of them front to back, makes a new one cascaded off the one in front,
// gives each its own menu bar, and closes them one by one when the app is quit, each asking about
// its own unsaved work.

/** How far a new window stands off the one in front of it, down and to the right. */
const CASCADE = 26;

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
 * @param deps.BrowserWindow Electron's
 * @param deps.Menu Electron's
 * @param deps.screen Electron's
 * @param deps.app Electron's
 * @param deps.create makes a window's `BrowserWindow` at the bounds given (or the system's place)
 */
function register({ BrowserWindow, Menu, screen, app, create }) {
  /** Front to back. */
  const order = [];
  /** Each window's own menu bar, as the page last handed it over. */
  const menus = new WeakMap();
  /** Set while File ▸ Exit closes the windows one by one; an answer to stay ends it. */
  let quitting = false;
  /** Set once every window has gone, so the quit that follows is let through. */
  let leaving = false;

  const live = () => order.filter((window) => !window.isDestroyed());
  const front = () => live()[0];

  function toFront(window) {
    const at = order.indexOf(window);
    if (at > 0) {
      order.splice(at, 1);
      order.unshift(window);
    }
  }

  /**
   * A new window, cascaded off the one in front.
   *
   * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.makeWindow
   */
  function makeWindow() {
    const anchor = front();
    const bounds =
      anchor === undefined
        ? undefined
        : cascadeFrom(anchor.getBounds(), screen.getDisplayMatching(anchor.getBounds()).workArea);
    const window = create(bounds);
    order.unshift(window);
    window.on("focus", () => {
      toFront(window);
      // A Mac has one menu bar, the key window's.
      if (process.platform === "darwin") Menu.setApplicationMenu(menus.get(window) ?? null);
    });
    window.on("closed", () => {
      const at = order.indexOf(window);
      if (at >= 0) order.splice(at, 1);
      if (quitting) setImmediate(closeNext);
    });
    return window;
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

  function closeNext() {
    if (!quitting) return;
    const next = front();
    if (next === undefined) {
      quitting = false;
      return;
    }
    next.close();
  }

  /**
   * File ▸ Exit, and a quit asked of the app: the windows close front to back, each asking about
   * its own unsaved work as its ✕ would. An answer to stay keeps that window and the ones behind
   * it, and the app runs on.
   *
   * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.applicationShouldTerminate
   * @upstream-differs no "You have N documents…" question first: each window asks in turn, which
   *   is the Review Changes… path upstream's question leads to
   */
  function closeAll() {
    if (quitting) return;
    quitting = true;
    closeNext();
  }

  /** The reader chose to stay in a window that was being closed. */
  function stayed() {
    quitting = false;
  }

  // ⌘Q from a Mac's application menu, and the system's own quit: the same walk as Exit.
  app.on("before-quit", (event) => {
    if (leaving || live().length === 0) return;
    event.preventDefault();
    closeAll();
  });
  app.on("window-all-closed", () => {
    leaving = true;
    app.quit();
  });

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

  return { makeWindow, setMenu, closeAll, stayed, bringForward, windows: live };
}

module.exports = { register, cascadeFrom, CASCADE };
