import type { Workspace } from "@/core/workspace/workspace";
import type { ProjectBridge } from "@/platform/files/projectFolder";

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
  /**
   * What the window was opened to take up from the one it was torn off from (D5): a pane, or the
   * files dropped on its New Window strip (`paneTransfer.ts`, `Handover`).
   */
  readonly handover?: unknown;
  /** The project the app has open, which this window is one of (D3). */
  readonly project?: ShellProject | undefined;
  /** Which of the app's own windows this is (D7); nothing for a window of the workspace. */
  readonly own?: OwnWindowKind | undefined;
  /** What the app's own window is to show first, as the page that opened it named it. */
  readonly show?: unknown;
}

/**
 * The app's own windows in the desktop shell (`Design/DESKTOP_WINDOWS.md`, D7): the help book, the
 * annotations and the agent's log, one of each, which a browser holds as panels of the dock.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController
 * @upstream-differs the kinds as data; upstream has a controller class per window
 */
export type OwnWindowKind = "help" | "notes" | "agent";

/** What the shell's preload script exposes for the app's own windows. */
export interface DesktopOwnWindowsBridge {
  open(kind: OwnWindowKind, message?: unknown): void;
  onShow(callback: (message: unknown) => void): () => void;
  /** Closes this page's window, as its title bar's close does. */
  close(): void;
}

let installedOwn: { readonly bridge: DesktopOwnWindowsBridge | undefined } | undefined;

/** The shell's own windows, where the page runs in it; nothing in a browser. */
export function desktopOwnWindows(): DesktopOwnWindowsBridge | undefined {
  if (installedOwn !== undefined) return installedOwn.bridge;
  if (typeof window === "undefined") return undefined;
  return (window as { byteripperDesktop?: { own?: DesktopOwnWindowsBridge } }).byteripperDesktop
    ?.own;
}

/** Stands `bridge` in for the shell's own windows, or with nothing puts the shell's back. */
export function installDesktopOwnWindowsForTesting(bridge?: DesktopOwnWindowsBridge | null): void {
  installedOwn = bridge === undefined ? undefined : { bridge: bridge ?? undefined };
}

/** Which of the app's own windows this page is, or nothing for a window of the workspace. */
export function ownWindowKind(): OwnWindowKind | undefined {
  return windowLaunch()?.own;
}

/** A project as the shell names it: its folder's path, and its name. */
export interface ShellProject {
  readonly path: string;
  readonly name: string;
}

/** Why the shell could not do what a project command asked. */
export interface ProjectRefusal {
  readonly error?: "unreadable" | "unwritable" | undefined;
  readonly name?: string | undefined;
}

/**
 * The shell's projects (`Design/DESKTOP_WINDOWS.md`, D3): the folder of the one the app has open,
 * kept by the main process, and the commands that open, save and close one — each replacing or
 * re-recording every window.
 */
export interface DesktopProjectBridge extends ProjectBridge {
  /** The workspace this window restores from the project it was opened with, once. */
  window(): Promise<Workspace | undefined>;
  open(path: string | undefined, suggestedName: string): Promise<ProjectRefusal>;
  saveAs(suggestedName: string): Promise<{ readonly ok: boolean } & ProjectRefusal>;
  close(): Promise<void>;
  recent(): Promise<readonly ShellProject[]>;
  clearRecent(): Promise<void>;
}

let installedProject: { readonly bridge: DesktopProjectBridge | undefined } | undefined;

/** The shell's projects, where the page runs in it; nothing in a browser. */
export function desktopProject(): DesktopProjectBridge | undefined {
  if (installedProject !== undefined) return installedProject.bridge;
  if (typeof window === "undefined") return undefined;
  return (window as { byteripperDesktop?: { project?: DesktopProjectBridge } }).byteripperDesktop
    ?.project;
}

/** Stands `bridge` in for the shell's projects, or with nothing puts the shell's back. */
export function installDesktopProjectForTesting(bridge?: DesktopProjectBridge | null): void {
  installedProject = bridge === undefined ? undefined : { bridge: bridge ?? undefined };
}

/** Brings this window forward, in the desktop shell; nothing in a browser. */
export function desktopWindowFocus(): (() => void) | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = (window as { byteripperDesktop?: { focusWindow?: () => void } }).byteripperDesktop;
  return bridge?.focusWindow === undefined ? undefined : () => bridge.focusWindow?.();
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
