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

export interface PaneState {
  readonly name: string;
  readonly document: BinaryDocument;
  /** True when this file can be written back to itself (D7). */
  readonly writable: boolean;
}

export interface WorkspaceState {
  /** File A. File B, and with it single-file mode's counterpart, arrives in M3. */
  readonly paneA: PaneState | undefined;
  readonly capabilities: FileCapabilities;
  readonly wordSize: WordSize;
  readonly decoderIdentifier: string;
  readonly fontSizePx: number;
  /** Something the user needs told — a file that would not open. */
  readonly problem: string | undefined;
}

export const workspaceStore = createStore<WorkspaceState>({
  paneA: undefined,
  capabilities: detectFileCapabilities(),
  wordSize: 1,
  decoderIdentifier: "cp1252",
  fontSizePx: 13,
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
 * Puts a file in slot A.
 *
 * The chunk cache is created here and belongs to this file alone: a cache is
 * keyed by chunk index, so one shared between two files would serve one file's
 * bytes at the other's offsets.
 */
export function openInPaneA(file: OpenedFile): void {
  try {
    const base = new FileBackedStorage(file.source, new ChunkCache());
    const document = new BinaryDocument(new EditOverlayStorage(base));
    workspaceStore.update((state) => ({
      ...state,
      paneA: { name: file.name, document, writable: file.handle !== undefined },
      problem: undefined,
    }));
  } catch (error) {
    workspaceStore.update((state) => ({
      ...state,
      problem: error instanceof Error ? error.message : "This file could not be opened.",
    }));
  }
}

export function closePaneA(): void {
  workspaceStore.update((state) => ({ ...state, paneA: undefined, problem: undefined }));
}

export function setWordSize(wordSize: WordSize): void {
  workspaceStore.update((state) => ({ ...state, wordSize }));
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
