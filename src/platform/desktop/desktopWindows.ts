/**
 * The desktop shell's windows, as the page in one of them sees them (`Design/DESKTOP_WINDOWS.md`):
 * which workspace this window's launch hands it, and the page's word back on which it is. The
 * shell keeps the windows front to back with their frames and ids; each page keeps its own tab.
 *
 * @web-only a browser tab is one workspace of its own (D11); the shell's windows are one workspace
 */

/** What a window's launch hands its page. */
export interface WindowLaunch {
  /** The workspace the window restores; nothing for a new window, which makes its own. */
  readonly id?: string | undefined;
  /**
   * Whether the window may take up the workspace left most recently that no window holds — the
   * one window a launch opens when the structure names none, which a session from before there
   * were several windows comes back in. A window opened with File ▸ New Window never does.
   */
  readonly adopt: boolean;
  /** The workspaces the app still holds, handed to one window: what any other record was is gone. */
  readonly keep?: readonly string[] | undefined;
}

/** What the shell's preload script exposes for this. */
export interface DesktopWorkspaceBridge {
  launch(): WindowLaunch | null;
  hold(id: string, restores: boolean): void;
}

let installed: { readonly bridge: DesktopWorkspaceBridge | undefined } | undefined;

/** The shell's half, where the page runs in it; nothing in a browser. */
export function desktopWorkspace(): DesktopWorkspaceBridge | undefined {
  if (installed !== undefined) return installed.bridge;
  if (typeof window === "undefined") return undefined;
  return (window as { byteripperDesktop?: { workspace?: DesktopWorkspaceBridge } })
    .byteripperDesktop?.workspace;
}

/** Stands `bridge` in for the shell's, or with nothing puts the shell's back. */
export function installDesktopWorkspaceForTesting(bridge?: DesktopWorkspaceBridge | null): void {
  installed = bridge === undefined ? undefined : { bridge: bridge ?? undefined };
}

let launched: WindowLaunch | undefined;

/** This window's launch, asked of the shell once. */
export function windowLaunch(): WindowLaunch | undefined {
  if (launched !== undefined) return launched;
  const answer = desktopWorkspace()?.launch() ?? undefined;
  if (answer !== undefined && answer !== null) launched = answer;
  return launched;
}

/** Forgets the launch asked, for a test. */
export function resetWindowLaunchForTesting(): void {
  launched = undefined;
}
