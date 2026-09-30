import { isMenuAction, type MenuEntry } from "@/ui/shell/menuModel";

/**
 * The command menu as a native menu bar, when the page runs in the optional
 * Windows shell (`desktop/`, D15).
 *
 * The shell's preload script puts a bridge on the window; a browser has none,
 * and then nothing here does anything. What crosses the bridge is data only —
 * labels, states, ids — so the commands themselves stay in the page: a click
 * on the native item comes back as its id, and the page runs the same
 * `onSelect` its own menu would have.
 *
 * @web-only the desktop shell's menu bar; the browser keeps its own, and the
 * app's commands are in the toolbar's menu
 */

/** One item of a native menu, as Electron's template takes it. */
export interface NativeMenuItem {
  readonly type: "normal" | "separator" | "checkbox" | "radio";
  readonly id?: string;
  readonly label?: string;
  readonly enabled?: boolean;
  readonly checked?: boolean;
  /** Shown beside the label; the page, not the shell, answers the keys. */
  readonly accelerator?: string;
  /** The shell answers the accelerator itself, rather than only drawing it. */
  readonly registerAccelerator?: boolean;
}

export interface NativeMenu {
  readonly label: string;
  readonly items: readonly NativeMenuItem[];
}

/** What the shell's preload script exposes. */
export interface DesktopBridge {
  setMenu(menus: readonly NativeMenu[]): void;
  /** The window's page zoom, one step in or out, or back to 100 % for 0. */
  zoom(step: -1 | 0 | 1): void;
  /** Closes the window as its ✕ does; the shell asks about unsaved work. */
  quit(): void;
  /**
   * Whether this build can replace itself: an installed one can, a portable
   * `.exe` or an unpacked `.zip` has nothing to install over.
   */
  readonly canInstallUpdate: boolean;
  /**
   * Downloads the release's setup, checks it against the release's own
   * `SHA256SUMS`, and runs it once the window has closed. Never answers when it
   * has worked — the app is gone by then.
   */
  installUpdate(version: string): Promise<UpdateInstallResult>;
  /** Stops a download that is running; `installUpdate` then answers "cancelled". */
  cancelUpdate(): void;
  /** Hears how far `installUpdate` has got. Returns the way to stop listening. */
  onUpdateProgress(callback: (progress: UpdateProgress) => void): () => void;
}

/** How far an installation has got, as the shell reports it. */
export interface UpdateProgress {
  /**
   * `preparing` asks GitHub which files the release has, `download` fetches the
   * setup, `verify` checks it against the release's checksums, and `install`
   * is the window closing so that the installer can run.
   */
  readonly phase: "preparing" | "download" | "verify" | "install";
  readonly received?: number;
  readonly total?: number;
}

/** Why an installation did not happen. */
export type UpdateInstallResult =
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly reason: "unavailable" | "download" | "checksum" };

/**
 * Where the shell delivers a click: a function on the page's own window, which
 * the shell calls with `executeJavaScript(…, userGesture)`. A message over IPC
 * would arrive with no user activation, and Chromium refuses a file picker —
 * Open…, Save As… — to anything that is not handling a gesture; a command
 * called as a gesture is let through, as a click on the page's own menu is.
 */
const COMMAND_ENTRY = "__byteripperMenuCommand";

/** The shell's bridge, or nothing in a browser. */
export function desktopBridge(): DesktopBridge | undefined {
  return (globalThis as { byteripperDesktop?: DesktopBridge }).byteripperDesktop;
}

const KEYS: Readonly<Record<string, string>> = {
  "⌘": "CmdOrCtrl",
  "⇧": "Shift",
  "⌥": "Alt",
  "⌃": "Ctrl",
  "←": "Left",
  "→": "Right",
  "↑": "Up",
  "↓": "Down",
};

/**
 * The menu's shortcut in Electron's accelerator form — `⇧⌘Z` is
 * `CmdOrCtrl+Shift+Z`, which the shell draws as Ctrl+Shift+Z on Windows — or
 * nothing for one it cannot spell.
 */
export function acceleratorOf(shortcut: string | undefined): string | undefined {
  if (shortcut === undefined || shortcut.length === 0) return undefined;
  const characters = [...shortcut];
  const parts: string[] = [];
  // The modifiers lead; what follows them is the key — one letter or digit,
  // an arrow, or a function key (⌃F4).
  while (characters.length > 1) {
    const named = KEYS[characters[0] ?? ""];
    if (named === undefined || ["Left", "Right", "Up", "Down"].includes(named)) break;
    parts.push(named);
    characters.shift();
  }
  const rest = characters.join("");
  const arrow = KEYS[rest];
  const key =
    arrow !== undefined && !parts.includes(arrow)
      ? arrow
      : /^[A-Za-z0-9]$/.test(rest)
        ? rest.toUpperCase()
        : rest === "+"
          ? "Plus"
          : rest === "-"
            ? "-"
            : /^F([1-9]|1[0-9]|2[0-4])$/.test(rest)
              ? rest
              : undefined;
  if (key === undefined || ["CmdOrCtrl", "Ctrl", "Alt", "Shift"].includes(key)) return undefined;
  // Modifiers in Electron's order.
  const modifiers = ["CmdOrCtrl", "Ctrl", "Alt", "Shift"].filter((one) => parts.includes(one));
  return [...modifiers, key].join("+");
}

/** Windows reads `&` as the next letter's mnemonic; a label means it literally. */
const plain = (label: string) => label.replaceAll("&", "&&");

/**
 * The flat command list as menus: every heading that opens a menu starts one,
 * and what comes before the first closes the first. A heading inside a menu is a
 * greyed title over its group, as the page's own menu draws it. Returns the
 * menus and the command each id stands for.
 */
export function nativeMenus(entries: readonly MenuEntry[]): {
  readonly menus: NativeMenu[];
  readonly commands: Map<string, () => void>;
} {
  const menus: { label: string; items: NativeMenuItem[] }[] = [];
  const commands = new Map<string, () => void>();
  const leading: NativeMenuItem[] = [];
  let current: { label: string; items: NativeMenuItem[] } | undefined;
  for (const entry of entries) {
    if (entry.kind === "heading" && entry.opensMenu === true) {
      current = { label: plain(entry.label), items: [] };
      menus.push(current);
      continue;
    }
    const into = current?.items ?? leading;
    if (entry.kind === "separator") {
      if (into.length > 0 && into[into.length - 1]?.type !== "separator") {
        into.push({ type: "separator" });
      }
      continue;
    }
    if (entry.kind === "heading") {
      into.push({ type: "normal", label: plain(entry.label), enabled: false });
      continue;
    }
    if (!isMenuAction(entry)) continue;
    const id = `c${commands.size}`;
    commands.set(id, entry.onSelect);
    const accelerator = acceleratorOf(entry.shortcut);
    into.push({
      type: entry.checked === undefined ? "normal" : entry.exclusive ? "radio" : "checkbox",
      id,
      label: plain(entry.label),
      enabled: entry.disabled !== true,
      ...(entry.checked === undefined ? {} : { checked: entry.checked }),
      ...(accelerator === undefined ? {} : { accelerator }),
      ...(entry.shellKey === true ? { registerAccelerator: true } : {}),
    });
  }
  // What came before the first menu — Settings… — closes it, set apart, where
  // a Windows application keeps its settings: at the foot of File.
  while (leading[leading.length - 1]?.type === "separator") leading.pop();
  const first = menus[0];
  if (first !== undefined && leading.length > 0) {
    while (first.items[first.items.length - 1]?.type === "separator") first.items.pop();
    first.items.push({ type: "separator" }, ...leading);
  }
  // A separator that closes a menu separates nothing.
  for (const menu of menus) {
    while (menu.items[menu.items.length - 1]?.type === "separator") menu.items.pop();
  }
  return { menus, commands };
}

let commands = new Map<string, () => void>();
let sent = "";

/**
 * Hands the menus to the shell, when there is one and they changed. The
 * command list is rebuilt on every render — a caret move changes what Merge
 * would merge — so the same menus are not sent twice.
 */
export function publishNativeMenu(entries: readonly MenuEntry[]): void {
  const bridge = desktopBridge();
  if (bridge === undefined) return;
  (globalThis as Record<string, unknown>)[COMMAND_ENTRY] = (id: string) => commands.get(id)?.();
  const built = nativeMenus(entries);
  commands = built.commands;
  const text = JSON.stringify(built.menus);
  if (text === sent) return;
  sent = text;
  bridge.setMenu(built.menus);
}
