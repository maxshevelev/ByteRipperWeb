import { rowContaining } from "@/core/bookmarks/bookmarkStore";
import { mergeTitle } from "@/core/segments/segmentation";
import { formatHex, hexAddress } from "@/core/text/hexText";
import { writeBytes } from "@/platform/clipboard/byteClipboard";
import { saveVerb } from "@/platform/files/capabilities";
import { saveRange } from "@/platform/files/rangeSave";
import { bookmarkAt, toggleBookmark } from "@/state/bookmarksStore";
import { segmentsFor } from "@/state/segmentsStore";
import {
  type PaneId,
  type PaneState,
  swapPanes,
  type WorkspaceState,
} from "@/state/workspaceStore";
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
  readonly onRevert: (pane: PaneId) => void;
  readonly onDuplicate: (pane: PaneId) => void;
  readonly onClose: (pane: PaneId) => void;
  readonly onFill: (pane: PaneId) => void;
  readonly onDeleteBytes: (pane: PaneId) => void;
  readonly onSelectBlockFrom: (pane: PaneId, offset: number) => void;
  /** Opens the bookmark list on the mark at this row, for renaming or moving. */
  readonly onEditBookmark: (offset: number) => void;
  /** Opens the cut dialog, prefilled with this offset (§21.3). */
  readonly onSplitHere: (pane: PaneId, offset: number) => void;
  readonly onSegments: (pane: PaneId) => void;
  readonly onProblem: (message: string | undefined) => void;
}

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
    { label: "Revert to Saved", disabled: !dirty, onSelect: () => actions.onRevert(pane) },
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
 * The dump's right-click menu (§10.2).
 *
 * The selection-scoped block comes first and only when the click landed inside
 * the selection, which is the rule that makes both readings of a right-click
 * work: on the selection it is about the selection, anywhere else it is about
 * the byte under the pointer.
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
    // The segment block (§21.3): the commands that shape the file's partition,
    // set off from the address-scoped commands above and the bookmark commands
    // below by their own separators.
    { kind: "separator" },
    ...segmentItems(pane, offset, actions),
    { kind: "separator" },
    ...bookmarkItems(offset, actions),
  ];
}

/** The segment block (§21.3): cut here, or merge the piece this byte is in. */
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
 */
function bookmarkItems(offset: number, actions: PaneMenuActions): (MenuEntry | undefined)[] {
  const row = rowContaining(offset);
  return [
    { label: `Toggle Bookmark at ${hexAddress(row)}`, onSelect: () => void toggleBookmark(offset) },
    bookmarkAt(offset) === undefined
      ? undefined
      : { label: "Edit Bookmark…", onSelect: () => actions.onEditBookmark(offset) },
  ];
}

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
        void copySelection(slot, actions.onProblem);
      },
    },
    {
      label: "Save Selection as…",
      onSelect: () => {
        void saveRange(slot.document.storage, start, end, selectionFileName(slot.name, start, end))
          .then((outcome) => {
            if (outcome === "downloaded") {
              actions.onProblem(
                "This browser cannot write to a chosen file, so a copy was downloaded."
              );
            }
          })
          .catch((error: unknown) =>
            actions.onProblem(
              error instanceof Error ? error.message : "That selection could not be saved."
            )
          );
      },
    },
    { label: "Fill Selection with…", onSelect: () => actions.onFill(pane) },
    { label: "Delete Bytes…", onSelect: () => actions.onDeleteBytes(pane), destructive: true },
  ];
}

/** `bios.bin_00001000-000010FF.bin` — what upstream names a saved selection. */
export function selectionFileName(base: string, start: number, end: number): string {
  return `${base}_${hexAddress(start)}-${hexAddress(Math.max(start, end - 1))}.bin`;
}

/**
 * The same bound the pane's own Copy uses: a megabyte of bytes is three
 * megabytes of hex text, past what any clipboard is for.
 */
const COPY_LIMIT = 1024 * 1024;

async function copySelection(
  slot: PaneState,
  onProblem: (message: string | undefined) => void
): Promise<void> {
  const { start, end } = slot.document.selection;
  if (end <= start) return;
  const bytes = await slot.document.read(start, Math.min(end - start, COPY_LIMIT));
  // The raw type first where the browser carries it, so a copy pastes back
  // losslessly; the hex text always, because that is what travels.
  if (!(await writeBytes(bytes))) {
    if (!(await copyText(formatHex(bytes)))) {
      onProblem("This browser would not let the page write to the clipboard.");
    }
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
