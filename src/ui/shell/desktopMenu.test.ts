import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceleratorOf,
  type DesktopBridge,
  type NativeMenu,
  type NativeMenuItem,
  nativeMenus,
  publishNativeMenu,
} from "@/ui/shell/desktopMenu";
import type { MenuEntry } from "@/ui/shell/menuModel";

/**
 * The command menu as the desktop shell's menu bar: the page's own list, cut
 * into menus at the headings that open one, with the commands left in the
 * page behind an id.
 */

describe("a shortcut as an accelerator", () => {
  it("spells the menu's symbols the way Electron reads them", () => {
    expect(acceleratorOf("⌘Z")).toBe("CmdOrCtrl+Z");
    expect(acceleratorOf("⇧⌘Z")).toBe("CmdOrCtrl+Shift+Z");
    expect(acceleratorOf("⌥⌘B")).toBe("CmdOrCtrl+Alt+B");
    expect(acceleratorOf("⌘L")).toBe("CmdOrCtrl+L");
    expect(acceleratorOf("⌘+")).toBe("CmdOrCtrl+Plus");
    expect(acceleratorOf("⌘-")).toBe("CmdOrCtrl+-");
    expect(acceleratorOf("⌘0")).toBe("CmdOrCtrl+0");
    expect(acceleratorOf("⌃F4")).toBe("Ctrl+F4");
    // Difference and matching-block navigation: the designation the native menu
    // draws beside the row is the same chord the page answers (Ctrl+Alt+arrow
    // on Windows) and the help carries for the shell edition.
    expect(acceleratorOf("⌥⌘→")).toBe("CmdOrCtrl+Alt+Right");
    expect(acceleratorOf("⌥⌘←")).toBe("CmdOrCtrl+Alt+Left");
    expect(acceleratorOf("⇧⌥⌘→")).toBe("CmdOrCtrl+Alt+Shift+Right");
    expect(acceleratorOf("⇧⌥⌘←")).toBe("CmdOrCtrl+Alt+Shift+Left");
  });

  it("leaves out what it cannot spell", () => {
    expect(acceleratorOf(undefined)).toBeUndefined();
    expect(acceleratorOf("")).toBeUndefined();
    expect(acceleratorOf("⌘?")).toBeUndefined();
  });
});

describe("the list as menus", () => {
  const ran: string[] = [];
  const entries: MenuEntry[] = [
    { label: "Settings…", onSelect: () => ran.push("settings") },
    { kind: "separator" },
    { kind: "heading", label: "File", opensMenu: true },
    { label: "Open…", onSelect: () => ran.push("open") },
    { label: "Save", disabled: true, onSelect: () => ran.push("save") },
    { kind: "separator" },
    { kind: "heading", label: "View", opensMenu: true },
    { label: "Show Minimap", shortcut: "⌘M", onSelect: () => ran.push("minimap") },
    { kind: "separator" },
    { kind: "heading", label: "Grouping distance" },
    { label: "16 bytes", checked: true, exclusive: true, onSelect: () => ran.push("16") },
    { label: "Wrap", checked: false, onSelect: () => ran.push("wrap") },
    { kind: "separator" },
  ];

  it("starts a menu at every heading that opens one, and ends File with Settings", () => {
    const { menus } = nativeMenus(entries);

    expect(menus.map((menu) => menu.label)).toEqual(["File", "View"]);
    expect(menus[0]?.items.map((one) => one.label ?? one.type)).toEqual([
      "Open…",
      "Save",
      "separator",
      "Settings…",
    ]);
  });

  it("keeps a group's title greyed inside its menu, and the items' states", () => {
    const view = nativeMenus(entries).menus[1]?.items ?? [];

    expect(view[0]).toMatchObject({ label: "Show Minimap", accelerator: "CmdOrCtrl+M" });
    expect(view[2]).toEqual({ type: "normal", label: "Grouping distance", enabled: false });
    expect(view[3]).toMatchObject({ type: "radio", checked: true });
    expect(view[4]).toMatchObject({ type: "checkbox", checked: false });
    expect(view.at(-1)?.type).not.toBe("separator");
    expect(nativeMenus(entries).menus[0]?.items[1]).toMatchObject({ enabled: false });
  });

  it("runs the page's own command for the id a click sends back", () => {
    const { menus, commands } = nativeMenus(entries);
    const open = menus[0]?.items.find((one) => one.label === "Open…");

    commands.get(open?.id ?? "")?.();

    expect(ran).toEqual(["open"]);
  });

  it("reads an ampersand as itself, not as a mnemonic", () => {
    const { menus } = nativeMenus([
      { kind: "heading", label: "Tools", opensMenu: true },
      { label: "Find & Replace", onSelect: () => {} },
    ]);

    expect(menus[0]?.items[0]?.label).toBe("Find && Replace");
  });
});

// The Open Recent submenu the page hangs on the shell's File menu. The bridge
// the shell's preload puts on the window is faked, so publishNativeMenu runs
// its real path and the menus it would send are what is read back.
describe("File ▸ Open Recent", () => {
  const fileOnly: MenuEntry[] = [
    { kind: "heading", label: "File", opensMenu: true },
    { label: "Open…", onSelect: () => {} },
    { label: "Save", disabled: true, onSelect: () => {} },
  ];
  let seen: NativeMenu[][];

  beforeEach(() => {
    seen = [];
    (globalThis as { byteripperDesktop?: DesktopBridge }).byteripperDesktop = {
      setMenu: (menus: readonly NativeMenu[]) => seen.push(menus as NativeMenu[]),
      zoom: () => {},
      quit: () => {},
      canInstallUpdate: false,
      installUpdate: () => Promise.resolve({ status: "cancelled" }),
      latestRelease: () => Promise.resolve(undefined),
      cancelUpdate: () => {},
      onUpdateProgress: () => () => {},
    } as DesktopBridge;
  });

  afterEach(() => {
    delete (globalThis as { byteripperDesktop?: DesktopBridge }).byteripperDesktop;
  });

  const submenu = (menus: readonly NativeMenu[]): readonly NativeMenuItem[] =>
    menus.find((menu) => menu.label === "File")?.items.find((one) => one.type === "submenu")
      ?.submenu ?? [];

  it("lists the files, then Clear Menu set apart by a separator", () => {
    publishNativeMenu(fileOnly, {
      rows: [
        { name: "a.bin", open: () => {} },
        { name: "b.bin", open: () => {} },
      ],
      clear: () => {},
    });

    expect(submenu(seen[seen.length - 1] ?? []).map((one) => one.label ?? one.type)).toEqual([
      "a.bin",
      "b.bin",
      "separator",
      "Clear Menu",
    ]);
  });

  it("shows a greyed Empty where the list is empty", () => {
    publishNativeMenu(fileOnly, { rows: [], clear: () => {} });

    expect(submenu(seen[seen.length - 1] ?? [])).toEqual([
      { type: "normal", label: "Empty", enabled: false },
    ]);
  });
});
