import { BinaryDocument } from "@/core/document/binaryDocument";
import { ChunkCache } from "@/core/storage/chunkCache";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { makeByteDecoder } from "@/core/text/byteDecoderRegistry";
import { detectFileCapabilities, type FileCapabilities } from "@/platform/files/capabilities";
import type { OpenedFile } from "@/platform/files/openedFile";
import type { WordSize } from "@/render/hexGrid/hexLayout";
import { createStore } from "@/state/store";

/**
 * The workspace: one per browser tab (D11), so this is a module-level store and
 * not something a component instantiates.
 *
 * It owns the two file slots, the view settings both panes share, and the
 * browser's file capabilities — detected once, on the way in, so nothing below
 * has to ask again.
 */

/** Which slot. File B is optional; with only A the app is in single-file mode. */
export type PaneId = "a" | "b";

export const PANE_IDS: readonly PaneId[] = ["a", "b"];

export interface PaneState {
  readonly name: string;
  /** Kept so the comparison worker can be handed the file itself. */
  readonly file: OpenedFile;
  readonly document: BinaryDocument;
  /** True when this file can be written back to itself (D7). */
  readonly writable: boolean;
}

/**
 * How the two panes sit. Side by side is the default — a firmware dump is 16
 * bytes wide and two of those fit on any bench monitor — and stacked is for a
 * narrow window or a long region read down the page.
 */
export type PaneLayout = "sideBySide" | "stacked";

/**
 * How far apart differing bytes may sit and still count as one change. One,
 * two, four and sixteen hex rows, as upstream offers.
 */
export const GROUPING_GAP_CHOICES: readonly number[] = [16, 32, 64, 256];

/**
 * Four rows: close enough that a press moves to a change you were not already
 * looking at, without folding neighbouring changes into one.
 */
export const DEFAULT_GROUPING_GAP = 64;

export interface WorkspaceState {
  readonly panes: Readonly<Record<PaneId, PaneState | undefined>>;
  readonly layout: PaneLayout;
  /** Which pane the keyboard and the commands act on. */
  readonly activePane: PaneId;
  readonly capabilities: FileCapabilities;
  readonly wordSize: WordSize;
  readonly decoderIdentifier: string;
  readonly fontSizePx: number;
  readonly groupingGap: number;
  /** Something the user needs told — a file that would not open. */
  readonly problem: string | undefined;
}

export const workspaceStore = createStore<WorkspaceState>({
  panes: { a: undefined, b: undefined },
  layout: "sideBySide",
  activePane: "a",
  capabilities: detectFileCapabilities(),
  wordSize: 1,
  decoderIdentifier: "cp1252",
  fontSizePx: 13,
  groupingGap: DEFAULT_GROUPING_GAP,
  problem: undefined,
});

/** The decoder the panes draw with, rebuilt only when the setting changes. */
let cachedDecoder = makeByteDecoder(workspaceStore.getSnapshot().decoderIdentifier);
let cachedDecoderIdentifier = workspaceStore.getSnapshot().decoderIdentifier;

export function activeDecoder() {
  const { decoderIdentifier } = workspaceStore.getSnapshot();
  if (decoderIdentifier !== cachedDecoderIdentifier) {
    cachedDecoder = makeByteDecoder(decoderIdentifier);
    cachedDecoderIdentifier = decoderIdentifier;
  }
  return cachedDecoder;
}

/**
 * Where a file opened without a named target goes: the first free slot, or —
 * when both are full — the active pane.
 *
 * Replacing the active pane is the only answer that is not arbitrary. Always
 * replacing A means a drop can silently throw away the file the user was
 * looking at while they were looking at it.
 */
export function slotForNewFile(): PaneId {
  const { panes, activePane } = workspaceStore.getSnapshot();
  if (panes.a === undefined) return "a";
  if (panes.b === undefined) return "b";
  return activePane;
}

/**
 * Puts a file in a slot.
 *
 * The chunk cache is created here and belongs to this file alone: a cache is
 * keyed by chunk index, so one shared between two files would serve one file's
 * bytes at the other's offsets.
 */
export function openInPane(pane: PaneId, file: OpenedFile): void {
  try {
    const base = new FileBackedStorage(file.source, new ChunkCache());
    const document = new BinaryDocument(new EditOverlayStorage(base));
    workspaceStore.update((state) => ({
      ...state,
      panes: {
        ...state.panes,
        [pane]: { name: file.name, file, document, writable: file.handle !== undefined },
      },
      activePane: pane,
      problem: undefined,
    }));
  } catch (error) {
    workspaceStore.update((state) => ({
      ...state,
      problem: error instanceof Error ? error.message : "This file could not be opened.",
    }));
  }
}

export function closePane(pane: PaneId): void {
  workspaceStore.update((state) => ({
    ...state,
    panes: { ...state.panes, [pane]: undefined },
    activePane: pane === "a" && state.panes.b !== undefined ? "b" : "a",
    problem: undefined,
  }));
}

/**
 * Swaps the two files.
 *
 * The comparison itself is symmetric — a byte differs or it does not — but
 * which file is on the left is how a person keeps "the one that works" apart
 * from "the one that does not".
 */
export function swapPanes(): void {
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: state.panes.b, b: state.panes.a },
    activePane: state.activePane === "a" ? "b" : "a",
  }));
}

export function setActivePane(pane: PaneId): void {
  workspaceStore.update((state) =>
    state.activePane === pane ? state : { ...state, activePane: pane }
  );
}

export function setLayout(layout: PaneLayout): void {
  workspaceStore.update((state) => ({ ...state, layout }));
}

export function setWordSize(wordSize: WordSize): void {
  workspaceStore.update((state) => ({ ...state, wordSize }));
}

export function setGroupingGap(groupingGap: number): void {
  workspaceStore.update((state) => ({ ...state, groupingGap }));
}

export function setFontSize(fontSizePx: number): void {
  workspaceStore.update((state) => ({
    ...state,
    fontSizePx: Math.min(24, Math.max(9, fontSizePx)),
  }));
}

export function reportProblem(problem: string | undefined): void {
  workspaceStore.update((state) => ({ ...state, problem }));
}
