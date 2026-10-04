/**
 * Which edition of the app is running: the page in a browser, or the same page
 * inside the Electron shell on the desktop.
 *
 * The shell's preload sets `byteripperDesktop` before any page code runs, and
 * nothing sets it anywhere else, so its presence is the whole of the question.
 * That is the same probe `desktopMenu.desktopBridge` uses; it is read here
 * rather than imported from it because the help — and the rest of `core` — must
 * not reach into `ui/shell` to ask where it is running.
 */

export type AppEdition = "browser" | "desktop";

/**
 * The edition the page is in. A build is one or the other for its whole life —
 * the shell either installed its bridge at load or did not — so this is read at
 * the moment it is asked, not cached.
 */
export function appEdition(): AppEdition {
  return (globalThis as { byteripperDesktop?: unknown }).byteripperDesktop !== undefined
    ? "desktop"
    : "browser";
}
