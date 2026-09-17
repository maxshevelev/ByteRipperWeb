import { rowContaining } from "@/core/bookmarks/bookmarkStore";
import { mergeTitle } from "@/core/segments/segmentation";
import { formatHex, hexAddress } from "@/core/text/hexText";
import { type SizeForm, sizeCopyText } from "@/core/text/statusLine";
import { writeBytes } from "@/platform/clipboard/byteClipboard";
import { saveVerb } from "@/platform/files/capabilities";
import { saveRange } from "@/platform/files/rangeSave";
import { editBookmarkInPane, toggleBookmarkInPane } from "@/state/bookmarkEditStore";
import { bookmarkAt } from "@/state/bookmarksStore";
import { segmentsFor } from "@/state/segmentsStore";
import {
  type PaneId,
  type PaneState,
  swapPanes,
  type WorkspaceState,
} from "@/state/workspaceStore";
import { zonesFor } from "@/state/zoneStore";
import { type Zone, zonesContaining } from "@/tools/zone";
import { mergePiece, pieceAt } from "@/ui/segments/segmentCommands";
import type { MenuEntry } from "@/ui/shell/menuModel";

/**
 * The menus that act on one pane.
 *
 * Upstream builds these in `MainViewController` rather than in the pane, for
 * the reason that decides it here too: every item must resolve **the pane it
 * was opened on**, which may not be the active one. The shell knows both; a
 * pane knows only itself.
 *
 * Two of them, as upstream has: the header's File menu (`makePaneMenu`) and the
 * dump's offset menu (`makeOffsetMenu`), and they carry the same commands the
 * toolbar's own menu carries — the same command reached two ways, never two
 * commands that drift apart.
 */

/** What the shell can do, handed in so this module holds no state of its own. */
export interface PaneMenuActions {
  readonly onNew: () => void;
  readonly onOpen: (into?: PaneId) => void;
  readonly onSave: (pane: PaneId) => void;
  readonly onSaveAs: (pane: PaneId) => void;
  /** Turns the header's name into a field (§23). */
  readonly onRename: (pane: PaneId) => void;
  readonly onRevert: (pane: PaneId) => void;
  readonly onDuplicate: (pane: PaneId) => void;
  readonly onClose: (pane: PaneId) => void;
  readonly onFill: (pane: PaneId) => void;
  readonly onDeleteBytes: (pane: PaneId) => void;
  readonly onSelectBlockFrom: (pane: PaneId, offset: number) => void;
  /** Opens the cut dialog, prefilled with this offset (§21.3). */
  readonly onSplitHere: (pane: PaneId, offset: number) => void;
  /** Selects a zone the open tool published, and shows it. */
  readonly onSelectZone: (pane: PaneId, zone: Zone) => void;
  readonly onSegments: (pane: PaneId) => void;
  /** Append File… / Insert File at Start… (§22). */
  readonly onJoin: (pane: PaneId, position: "start" | "end") => void;
  /** A problem: a title and a message, in the window's own alert. */
  readonly onProblem: (title: string, message: string) => void;
  /** Something that happened and needs no answer, in the pane's own line. */
  readonly onMessage: (pane: PaneId, message: string) => void;
}

/** @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.makePaneMenu */
export function paneFileMenu(
  state: WorkspaceState,
  pane: PaneId,
  actions: PaneMenuActions
): (MenuEntry | undefined)[] {
  const slot = state.panes[pane];
  if (slot === undefined) return [];
  // The verb follows this pane, not only the browser: a file opened without a
  // handle is downloaded however capable the browser is (D7).
  const verb = saveVerb(state.capabilities, slot.file.handle !== undefined);
  const dirty = slot.document.isDirty;
  const bothOpen = state.panes.a !== undefined && state.panes.b !== undefined;

  return [
    { label: "New File", onSelect: actions.onNew },
    { label: "Open…", onSelect: () => actions.onOpen(pane) },
    { kind: "separator" },
    { label: verb, disabled: !dirty && verb === "Save", onSelect: () => actions.onSave(pane) },
    {
      label: verb === "Save" ? "Save As…" : "Download As…",
      onSelect: () => actions.onSaveAs(pane),
    },
    // With the Saves: the third thing that decides what this document is
    // called, and the only one that writes nothing. A file's name is its file's.
    // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.renamePaneDocument
    {
      label: "Rename",
      disabled: slot.saved !== undefined,
      onSelect: () => actions.onRename(pane),
    },
    { label: "Revert to Saved", disabled: !dirty, onSelect: () => actions.onRevert(pane) },
    { kind: "separator" },
    // The join twins (§22.1). Insert is grouped with the edit commands above;
    // Append sits with it, both acting on THIS pane rather than the active one.
    { label: "Insert File at Start…", onSelect: () => actions.onJoin(pane, "start") },
    { label: "Append File…", onSelect: () => actions.onJoin(pane, "end") },
    { kind: "separator" },
    { label: "Duplicate", onSelect: () => actions.onDuplicate(pane) },
    { kind: "separator" },
    // Upstream's Copy Full Path and Show in Finder have no counterpart: a
    // browser is told a file's name and nothing else about where it came from.
    { label: "Copy File Name", onSelect: () => void copyText(slot.name) },
    { label: "Close", onSelect: () => actions.onClose(pane) },
    bothOpen ? { kind: "separator" } : undefined,
    bothOpen ? { label: "Swap Panes", onSelect: swapPanes } : undefined,
  ];
}

/**
 * The status bar's right-click menu on the file size (§3.4): copying the half
 * of the exact form the click landed on, in that half's own format.
 *
 * One item, titled with the value it will copy — the write happens when it is
 * chosen, from the string the item was titled with, and never from the pane
 * read again at click time, which a running scan may have changed under the
 * open menu.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.makeSizeMenu
 * @upstream-differs the payload is the closure's rather than a menu item's
 * `representedObject`, and what reaches the clipboard is the same string either way
 */
export function statusSizeMenu(size: number, form: SizeForm): MenuEntry[] {
  const named = form === "hex" ? "Copy hex size" : "Copy size";
  const text = sizeCopyText(size, form);
  return [{ label: `${named} ${text}`, onSelect: () => void copyText(text) }];
}

/**
 * The status bar's right-click menu on the caret's offset: copying the address
 * as the bar draws it (§3.4).
 *
 * The bar pads the address to the width of the file's largest address so that
 * the offsets in the line read as aligned columns (§21.3), and what it copies
 * is those digits — the ones the user read — rather than a second formatting of
 * the same number. The padding is harmless where the value goes next: an offset
 * field takes `0x` followed by hex, and leading zeros are hex.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.makeStatusOffsetMenu
 */
export function statusOffsetMenu(digits: string): MenuEntry[] {
  return [{ label: `Copy offset ${digits}`, onSelect: () => void copyText(digits) }];
}

/**
 * The dump's right-click menu (§10.2).
 *
 * The selection-scoped block comes first and only when the click landed inside
 * the selection, which is the rule that makes both readings of a right-click
 * work: on the selection it is about the selection, anywhere else it is about
 * the byte under the pointer.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.makeOffsetMenu
 * @upstream ByteRipperApp/Window/MainViewController.swift#OffsetContextTarget
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.copyOffset
 * @upstream-differs Copy Offset copies the address as the dump writes it, eight hex digits
 */
export function dumpMenu(
  state: WorkspaceState,
  pane: PaneId,
  offset: number,
  actions: PaneMenuActions,
  extra: readonly (MenuEntry | undefined)[] = []
): (MenuEntry | undefined)[] {
  const slot = state.panes[pane];
  if (slot === undefined) return [];
  const selection = slot.document.selection;
  const inSelection =
    selection.end > selection.start && offset >= selection.start && offset < selection.end;

  return [
    ...(inSelection ? selectionItems(slot, pane, actions) : []),
    inSelection ? { kind: "separator" as const } : undefined,
    { label: "Copy Offset", onSelect: () => void copyText(hexAddress(offset)) },
    { kind: "separator" },
    {
      label: `Select Block from Here at ${hexAddress(offset)}…`,
      onSelect: () => actions.onSelectBlockFrom(pane, offset),
    },
    ...extra,
    // The zone block: a right-click inside a range the open tool published
    // offers that range by name. Nothing at all where there are no zones —
    // which is most files, most of the time.
    ...zoneItems(slot, pane, offset, actions),
    // The segment block (§21.3): the commands that shape the file's partition,
    // set off from the address-scoped commands above and the bookmark commands
    // below by their own separators.
    { kind: "separator" },
    ...segmentItems(pane, offset, actions),
    { kind: "separator" },
    ...bookmarkItems(pane, offset),
  ];
}

/**
 * The zone block.
 *
 * Zones nest, so a byte is often inside several: the FIT table, the row in it,
 * the microcode a row points at. All of them are offered, innermost first,
 * because the smallest zone under the pointer is the one being aimed at.
 *
 * Selecting is what tells the tool that published the zone which of its own it
 * is about; saving is the same read-only export Save Selection as… makes, the
 * source file never written.
 *
 * Open Zone in a New Tab is not here: a zone taken out into a document of its
 * own is a tab of the window it came from, and one workspace per browser tab
 * (D11) leaves it nowhere to go.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.addZoneMenuItems
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.selectZone
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.saveZone
 * @upstream ByteRipperApp/Window/MainViewController.swift#ZoneContextTarget
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapMenuSelectZone
 * @web-only several zones become one item per zone rather than a submenu: this menu has no submenus, and a command that has to be named twice beats one that cannot be reached
 */
function zoneItems(
  slot: PaneState,
  pane: PaneId,
  offset: number,
  actions: PaneMenuActions
): (MenuEntry | undefined)[] {
  const zones = zonesContaining(zonesFor(pane), offset);
  if (zones.length === 0) return [];
  return [
    { kind: "separator" },
    ...zones.map((zone) => ({
      label: `Select Zone “${zone.name}”`,
      onSelect: () => actions.onSelectZone(pane, zone),
    })),
    ...zones.map((zone) => ({
      label: `Save Zone “${zone.name}” as…`,
      onSelect: () =>
        saveRangeAs(
          slot,
          pane,
          zone.start,
          zone.end,
          zoneFileName(slot.name, zone.name, zone.start, zone.end),
          "zone",
          actions
        ),
    })),
  ];
}

/**
 * The segment block (§21.3): cut here, or merge the piece this byte is in.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.addSegmentMenuItems
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapMenuSelectSegment
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapMenuEditSegment
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapMenuRemoveSegment
 */
function segmentItems(
  pane: PaneId,
  offset: number,
  actions: PaneMenuActions
): (MenuEntry | undefined)[] {
  const piece = pieceAt(pane, offset);
  const pieces = segmentsFor(pane)?.segments.length ?? 0;
  return [
    {
      label: `Split Here at ${hexAddress(offset)}…`,
      onSelect: () => actions.onSplitHere(pane, offset),
    },
    piece === undefined
      ? undefined
      : {
          label: mergeTitle(piece.index),
          disabled: pieces < 2,
          destructive: true,
          onSelect: () => mergePiece(pane, piece.index),
        },
    { label: "Segments…", onSelect: () => actions.onSegments(pane) },
  ];
}

/**
 * The bookmark block (§20.3).
 *
 * One item marks and unmarks — the same command ⌘D is, so there is one thing to
 * learn — and a marked row is offered Edit Bookmark besides. The address is the
 * **row's**, not the clicked byte's: a right-click on a byte marks its row, and
 * the title is what says so.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.addBookmarkMenuItems
 */
function bookmarkItems(pane: PaneId, offset: number): (MenuEntry | undefined)[] {
  const row = rowContaining(offset);
  return [
    {
      label: `Toggle Bookmark at ${hexAddress(row)}`,
      onSelect: () => toggleBookmarkInPane(pane, offset),
    },
    bookmarkAt(offset) === undefined
      ? undefined
      : { label: "Edit Bookmark…", onSelect: () => editBookmarkInPane(pane, offset) },
  ];
}

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.addSelectionMenuItems
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.selectBlockFromHere
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.selectBlock
 */
function selectionItems(
  slot: PaneState,
  pane: PaneId,
  actions: PaneMenuActions
): (MenuEntry | undefined)[] {
  const { start, end } = slot.document.selection;
  return [
    {
      label: "Copy",
      onSelect: () => {
        void copySelection(slot, actions);
      },
    },
    {
      label: "Save Selection as…",
      onSelect: () =>
        saveRangeAs(
          slot,
          pane,
          start,
          end,
          selectionFileName(slot.name, start, end),
          "selection",
          actions
        ),
    },
    { label: "Fill Selection with…", onSelect: () => actions.onFill(pane) },
    { label: "Delete Bytes…", onSelect: () => actions.onDeleteBytes(pane), destructive: true },
  ];
}

/**
 * The tail Save Selection as… and Save Zone as… share: reads a range out of the
 * pane's document and offers the bytes as a file to save. `purpose` — "the
 * selection", "the zone" — names the range in what goes wrong.
 *
 * A read only: the pane's file is never written by this, so it is offered
 * whether or not the pane is writable, and what is saved is what is shown,
 * edits and all.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.saveRange
 * @upstream-differs the picker is the browser's, and a browser without one — or without
 * somewhere to put what the picker would return — hands the bytes to the download flow (D7)
 */
function saveRangeAs(
  slot: PaneState,
  pane: PaneId,
  start: number,
  end: number,
  suggestedName: string,
  purpose: string,
  actions: PaneMenuActions
): void {
  void saveRange(slot.document.storage, start, end, suggestedName)
    .then((outcome) => {
      if (outcome === "downloaded") {
        actions.onMessage(
          pane,
          "This browser cannot write to a chosen file, so a copy was downloaded."
        );
      }
    })
    .catch((error: unknown) =>
      actions.onProblem(
        "Save failed.",
        error instanceof Error ? error.message : `That ${purpose} could not be saved.`
      )
    );
}

/**
 * The name a saved selection is offered under: the source file's stem with the
 * exported range appended, so a save of even the whole file cannot silently
 * land on the file that is open.
 *
 * The bounds are the range's own — half-open, so the second number is the byte
 * *after* the last one — because that is what upstream writes and what a size
 * can be read off at a glance.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.exportName
 */
export function selectionFileName(base: string, start: number, end: number): string {
  return `${fileStem(base)}_${hexAddress(start)}-${hexAddress(end)}.bin`;
}

/**
 * The name a saved zone is offered under: the source file's stem with the
 * zone's own name appended — that is what the reader is looking for, where the
 * offsets are not. A nameless zone falls back to its range, so the export still
 * cannot silently land on the file that is open.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.zoneExportName
 */
export function zoneFileName(base: string, zoneName: string, start: number, end: number): string {
  if (zoneName.length === 0) return selectionFileName(base, start, end);
  return `${fileStem(base)}_${zoneName}.bin`;
}

/**
 * A file's name without its extension — up to the **last** dot, as upstream's
 * `deletingPathExtension` reads it, and the whole of a dotless name.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.exportName
 */
function fileStem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * The same bound the pane's own Copy uses: a megabyte of bytes is three
 * megabytes of hex text, past what any clipboard is for.
 */
const COPY_LIMIT = 1024 * 1024;

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.copySelection
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.copyPaneSelection
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.copySelectionBytes
 */
async function copySelection(slot: PaneState, actions: PaneMenuActions): Promise<void> {
  const { start, end } = slot.document.selection;
  if (end <= start) return;
  const bytes = await slot.document.read(start, Math.min(end - start, COPY_LIMIT));
  // The raw type first where the browser carries it, so a copy pastes back
  // losslessly; the hex text always, because that is what travels.
  if (!(await writeBytes(bytes))) {
    if (!(await copyText(formatHex(bytes)))) {
      // @web-only upstream writes to `NSPasteboard` and has no refusal to
      // report; a page's clipboard write can be denied by the browser
      actions.onProblem(
        "Copy failed.",
        "This browser would not let the page write to the clipboard."
      );
    }
  }
}

/**
 * Puts a string on the clipboard — the one path every menu that copies text
 * goes through: the status bar's two items and the pane's Copy File Name.
 *
 * What reaches it is the string the item was **titled** with, closed over when
 * the menu was built, rather than a value read again at click time, which a
 * running scan may have changed under the open menu (§3.4).
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.copyStatusValue
 * @upstream-differs one helper for every string a menu copies, where upstream's action reads
 * the payload out of the item's `representedObject`; the item's own closure carries it here,
 * and it is the same string either way
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
