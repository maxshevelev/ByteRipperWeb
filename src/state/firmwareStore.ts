import type { UndoOperation } from "@/core/edit/undoHistory";
import type { FITReport } from "@/firmware/fit/fitTable";
import type { EFSVolume, MFSVolume } from "@/firmware/me/models/fileSystemFacts";
import { IMAGE_LAYOUT, type UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import type { RebuildTarget } from "@/firmware/uefi/uefiRebuild";
import { discardParkedStateFor } from "@/state/parkedToolState";
import { createStore } from "@/state/store";
import { applyTransaction } from "@/state/toolEdits";
import { type PaneId, paneState } from "@/state/workspaceStore";
import { ConfigRecordPaths } from "@/tools/configRecordPaths";
import { changeOfOperations, mergedWith, type ToolContentChange } from "@/tools/contentChange";
import { EFSFileNames } from "@/tools/efsFileNames";
import { MFSFileNames } from "@/tools/mfsFileNames";
import type {
  FirmwareDetailResponse,
  FirmwareProtectedRangesResponse,
  FirmwareRebuildResponse,
  FirmwareWorkerRequest,
  FirmwareWorkerResponse,
  FitEditRequest,
  FitEditResponse,
  MeAnalyzeResponse,
  MeChecksumsResponse,
  MeFileNamesResponse,
  WireDiagnostic,
  WireNode,
} from "@/workers/protocol";

/**
 * The firmware tree for each pane, and the worker that builds it.
 *
 * The tree lives here rather than inside the tool that shows it, for the reason
 * the tool contract gives: a tool is bound to one pane, and parsing an image is
 * expensive enough that switching tools must not throw the answer away. The
 * shell never looks at a node — the panel does — but the *work* belongs to the
 * workspace.
 *
 * One worker per pane, as the minimap has: two images are two independent
 * questions, and sharing one worker would make the second parse cancel the
 * first.
 */

export type FirmwareStatus = "idle" | "parsing" | "ready" | "failed";

/** @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState */
export interface PaneFirmware {
  readonly status: FirmwareStatus;
  readonly size: number;
  readonly roots: readonly WireNode[];
  readonly diagnostics: readonly WireDiagnostic[];
  /** `address = offset + addressDiff`, once something has asked for it. */
  readonly addressDiff: number | undefined;
  readonly fraction: number;
  readonly problem: string | undefined;
  /** The paths currently being expanded, so a row can say it is working. */
  readonly expanding: ReadonlySet<string>;
  /** What the detail panel shows about the node it was last asked about. */
  readonly detail: FirmwareDetailResponse | undefined;
  /**
   * The Boot Guard and vendor ranges, once the panel has asked for them.
   * Nothing means "not read yet", which is not the same as "none".
   */
  readonly protectedRanges: FirmwareProtectedRangesResponse | undefined;
}

export interface FirmwareState {
  readonly panes: Readonly<Record<PaneId, PaneFirmware | undefined>>;
}

const empty: PaneFirmware = {
  status: "idle",
  size: 0,
  roots: [],
  diagnostics: [],
  addressDiff: undefined,
  fraction: 0,
  problem: undefined,
  expanding: new Set(),
  detail: undefined,
  protectedRanges: undefined,
};

export const firmwareStore = createStore<FirmwareState>({ panes: { a: undefined, b: undefined } });

export const pathKey = (path: readonly number[]): string => path.join(".");

function update(pane: PaneId, patch: Partial<PaneFirmware>): void {
  firmwareStore.update((state) => {
    const current = state.panes[pane] ?? empty;
    return { panes: { ...state.panes, [pane]: { ...current, ...patch } } };
  });
}

/** @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.uefiState */
export function firmwareFor(pane: PaneId): PaneFirmware | undefined {
  return firmwareStore.getSnapshot().panes[pane];
}

// MARK: - The workers

interface PaneWorker {
  readonly worker: Worker;
  job: number;
}

const workers: Partial<Record<PaneId, PaneWorker>> = {};

function ensureWorker(pane: PaneId): PaneWorker {
  const existing = workers[pane];
  if (existing !== undefined) return existing;

  const worker = new Worker(new URL("../workers/firmware.worker.ts", import.meta.url), {
    type: "module",
  });
  const held: PaneWorker = { worker, job: 0 };
  worker.addEventListener("message", (event: MessageEvent<FirmwareWorkerResponse>) => {
    const response = event.data;
    // A reply to a superseded job is an answer to an old question.
    if (response.id !== held.job) return;

    switch (response.kind) {
      case "firmwareProgress":
        update(pane, { fraction: response.fraction });
        return;
      case "firmwareRoots":
        update(pane, {
          status: "ready",
          size: response.size,
          roots: response.roots,
          diagnostics: response.diagnostics,
          fraction: 1,
          problem: undefined,
        });
        return;
      case "firmwareInvalidated":
        // Everything that was being read is being read against a tree that just
        // moved, so no row is working any more and no address or detail is
        // still about the node it was asked about. What was complained about
        // went with the subtrees it was found in, and is re-collected as those
        // are read again.
        update(pane, {
          status: "ready",
          size: response.size,
          roots: response.roots,
          diagnostics: [],
          addressDiff: undefined,
          expanding: new Set(),
          detail: undefined,
          fraction: 1,
          problem: undefined,
        });
        return;
      case "firmwareChildren": {
        const current = firmwareFor(pane) ?? empty;
        const expanding = new Set(current.expanding);
        expanding.delete(pathKey(response.node));
        update(pane, {
          roots: replaceChildren(current.roots, response.node, response.children),
          diagnostics: [...current.diagnostics, ...response.diagnostics],
          expanding,
        });
        return;
      }
      case "firmwareNodeAtOffset": {
        const current = firmwareFor(pane) ?? empty;
        // The worker's tree is the truth, and it has just opened branches of
        // its own; taking it whole keeps the two from disagreeing.
        update(pane, {
          roots: response.roots,
          diagnostics: [...current.diagnostics, ...response.diagnostics],
        });
        offsetWaiters.get(pane)?.(response.path);
        offsetWaiters.delete(pane);
        return;
      }
      case "meAnalyze": {
        meWaiters.get(pane)?.(response);
        meWaiters.delete(pane);
        return;
      }
      case "meChecksums": {
        checksumWaiters.get(pane)?.(response);
        checksumWaiters.delete(pane);
        return;
      }
      case "meFileNames": {
        // The three name tables are values with behaviour, and a structured
        // clone carries only their fields: what arrives has the right shape and
        // none of the methods the rows call. They are put back together here,
        // at the boundary, rather than by every panel that asks.
        meFileNamesWaiters.get(pane)?.({
          ...response,
          mfs: response.mfs === undefined ? undefined : MFSFileNames.received(response.mfs),
          efs: response.efs === undefined ? undefined : EFSFileNames.received(response.efs),
          config:
            response.config === undefined ? undefined : ConfigRecordPaths.received(response.config),
        });
        meFileNamesWaiters.delete(pane);
        return;
      }
      case "fitEdit": {
        fitEditWaiters.get(pane)?.(response);
        fitEditWaiters.delete(pane);
        return;
      }
      case "fitReport": {
        fitWaiters.get(pane)?.(response.report);
        fitWaiters.delete(pane);
        return;
      }
      case "firmwareAddresses":
        update(pane, { addressDiff: response.addressDiff });
        return;
      case "firmwareDetail":
        update(pane, { detail: response });
        return;
      case "firmwareSpaceBytes":
        spaceBytesWaiters.get(pane)?.(response.bytes);
        spaceBytesWaiters.delete(pane);
        return;
      case "firmwareLayout":
        layoutWaiters.get(pane)?.({
          layout: response.layout,
          rebuild:
            response.rebuild === undefined
              ? undefined
              : {
                  space: response.rebuild.space,
                  ...(response.rebuild.range === undefined
                    ? {}
                    : {
                        range: { start: response.rebuild.range[0], end: response.rebuild.range[1] },
                      }),
                },
        });
        layoutWaiters.delete(pane);
        return;
      case "firmwareRebuildProgress":
        rebuildProgress.get(pane)?.(response.phase, response.fraction);
        return;
      case "firmwareRebuild":
        rebuildWaiters.get(pane)?.(response);
        rebuildWaiters.delete(pane);
        rebuildProgress.delete(pane);
        return;
      case "firmwareProtectedRanges":
        // The reading's own complaints join the panel's list: what the lists
        // say is as much a part of reading an image as what its headers say.
        update(pane, {
          protectedRanges: response,
          diagnostics: [...(firmwareFor(pane)?.diagnostics ?? []), ...response.diagnostics],
        });
        return;
      case "firmwareRepair": {
        const waiting = repairWaiters.get(pathKey(response.node));
        repairWaiters.delete(pathKey(response.node));
        waiting?.(response.writes);
        return;
      }
      case "firmwareFailed":
        // Whoever was waiting on this worker is told so rather than left
        // holding a promise that will never settle.
        dropAsks(pane, { id: response.id, problem: response.problem });
        update(pane, { status: "failed", problem: response.problem });
        return;
    }
  });
  workers[pane] = held;
  return held;
}

function send(pane: PaneId, request: FirmwareWorkerRequest): void {
  ensureWorker(pane).worker.postMessage(request);
}

/**
 * A one-at-a-time ask — a buffer's bytes, a part's reading, a rebuild plan, a
 * node's path, a FIT table or edit, an ME analysis or digests — supersedes the
 * pane's previous one, so it takes a job of its own: the reply to the one it
 * supersedes then carries a job that is no longer current and is dropped,
 * rather than settling the waiter that has just replaced it. The many-at-a-time
 * asks (a node's children, the addresses, a detail, a repair) keep the shared
 * job, because several of them run at once and none supersedes another.
 */
/**
 * Settles every one-at-a-time ask this pane has outstanding.
 *
 * Called where the pane's job moves on without an answer: the worker failed, or
 * the tree it was asked about has been replaced — a parse or an invalidation
 * takes the job with it, so the reply to a question asked of the old tree is
 * dropped on arrival and the caller would wait for ever. None of them can be
 * answered now, and saying so is what lets the caller give up and say why.
 */
function dropAsks(pane: PaneId, failure?: { readonly id: number; readonly problem: string }): void {
  fitWaiters.get(pane)?.(undefined);
  fitWaiters.delete(pane);
  spaceBytesWaiters.get(pane)?.(undefined);
  spaceBytesWaiters.delete(pane);
  layoutWaiters.get(pane)?.({ layout: IMAGE_LAYOUT, rebuild: undefined });
  layoutWaiters.delete(pane);
  offsetWaiters.get(pane)?.(undefined);
  offsetWaiters.delete(pane);
  rebuildWaiters.get(pane)?.(undefined);
  rebuildWaiters.delete(pane);
  rebuildProgress.delete(pane);
  // The one ask with something to say beyond "no": a failed edit carries the
  // worker's own reason, which the panel shows.
  fitEditWaiters.get(pane)?.(
    failure === undefined
      ? undefined
      : {
          kind: "fitEdit",
          id: failure.id,
          name: undefined,
          writes: [],
          problem: failure.problem,
          summary: undefined,
          landed: undefined,
        }
  );
  fitEditWaiters.delete(pane);
  meWaiters.get(pane)?.(undefined);
  meWaiters.delete(pane);
  checksumWaiters.get(pane)?.(undefined);
  checksumWaiters.delete(pane);
  meFileNamesWaiters.get(pane)?.(undefined);
  meFileNamesWaiters.delete(pane);
}

function nextAskJob(pane: PaneId): number {
  const held = ensureWorker(pane);
  held.job += 1;
  return held.job;
}

/**
 * Parses the pane's current content.
 *
 * The blob is the file itself while the document is clean, and a snapshot of
 * what the document holds once it is not — the tree has to be about the bytes
 * on screen, not the ones on disk.
 */
export function openFirmware(pane: PaneId, content: Blob, layout?: UEFIRootLayout): void {
  const held = ensureWorker(pane);
  held.job += 1;
  // The job this bump supersedes may have been somebody's question; its reply
  // is dropped on arrival, so the asker is told now rather than left waiting.
  dropAsks(pane);
  update(pane, {
    status: "parsing",
    fraction: 0,
    roots: [],
    diagnostics: [],
    addressDiff: undefined,
    expanding: new Set(),
    detail: undefined,
    problem: undefined,
  });
  held.worker.postMessage({ kind: "openFirmware", id: held.job, content, layout });
}

/**
 * The pane's content as it stands, as the blob the worker reads.
 *
 * A clean document is its file, byte for byte, so the file is handed over as it
 * is — structured clone shares a blob's bytes rather than copying them. A dirty
 * one needs its own bytes, which means materialising them. Every read of an
 * image goes through this, so a tree built now and a container read again after
 * an edit are about the same content.
 */
async function currentContent(pane: PaneId): Promise<Blob | undefined> {
  const slot = paneState(pane);
  if (slot === undefined) return undefined;
  if (!slot.document.isDirty && slot.file.source instanceof Blob) return slot.file.source;
  return new Blob([await slot.document.read(0, slot.document.size)]);
}

/**
 * Opens the pane's document through whichever blob is current.
 *
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.tree
 */
export async function parsePaneFirmware(pane: PaneId): Promise<void> {
  const content = await currentContent(pane);
  if (content === undefined) return;
  // A part is read as what the parent's tree knew it to be: a decompressed
  // body read as an image is a scan that finds nothing.
  openFirmware(pane, content, paneState(pane)?.origin?.layout);
}

/** Asks for one node's children, unless they are already on their way. */
export function expandFirmwareNode(pane: PaneId, path: readonly number[]): void {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") return;
  const key = pathKey(path);
  if (current.expanding.has(key)) return;
  const expanding = new Set(current.expanding);
  expanding.add(key);
  update(pane, { expanding });
  send(pane, { kind: "firmwareChildren", id: workers[pane]?.job ?? 0, node: path });
}

/**
 * Where the image is mapped, worked out only when something asks.
 *
 * Finding the anchor means walking to the last Volume Top File, and every panel
 * that wants an address would otherwise wait for that on open.
 */
export function resolveFirmwareAddresses(pane: PaneId): void {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready" || current.addressDiff !== undefined) {
    return;
  }
  send(pane, { kind: "firmwareAddresses", id: workers[pane]?.job ?? 0 });
}

const offsetWaiters = new Map<PaneId, (path: readonly number[] | undefined) => void>();

/**
 * The path of the innermost node covering `offset`, once every branch on the
 * way to it is open — or nothing when no node covers it.
 */
export function findFirmwareNodeAt(
  pane: PaneId,
  offset: number
): Promise<readonly number[] | undefined> {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    // A second ask supersedes the first, which is then told nothing was found.
    offsetWaiters.get(pane)?.(undefined);
    offsetWaiters.set(pane, resolve);
    send(pane, { kind: "firmwareNodeAtOffset", id: nextAskJob(pane), offset });
  });
}

/** Asks for everything the detail panel shows about one node. */
/**
 * Reads the protected ranges, once. The worker hashes megabytes for them, so a
 * panel asks when it is opened and not before, and the answer is kept until an
 * edit makes it stale.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.show
 */
export function askFirmwareProtectedRanges(pane: PaneId): void {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") return;
  if (current.protectedRanges !== undefined) return;
  send(pane, { kind: "firmwareProtectedRanges", id: workers[pane]?.job ?? 0 });
}

/**
 * The bytes of one buffer, or a range of one — what a compressed section
 * decompresses to, and what a node inside it holds.
 *
 * Nothing where the section does not decompress: a stream the decoder cannot
 * read, or one that failed. The caller is what knows how to say so.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.decompressedBytes
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.withDecompressedBytes
 */
export async function readSpaceBytes(
  pane: PaneId,
  space: readonly number[],
  range?: readonly [number, number] | undefined
): Promise<Uint8Array | undefined> {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") return undefined;
  return new Promise<Uint8Array | undefined>((resolve) => {
    // A second ask supersedes the first, which is then told nothing came back.
    spaceBytesWaiters.get(pane)?.(undefined);
    spaceBytesWaiters.set(pane, resolve);
    send(pane, { kind: "firmwareSpaceBytes", id: nextAskJob(pane), space, range });
  });
}

/**
 * What a part of this pane's image would be read as, opened on its own: a
 * node's own layout, its body's alone, or a range of the file's.
 *
 * An image nothing has parsed — or a pane that is not firmware at all — answers
 * with the image layout, which is the honest "whatever the bytes announce".
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.of
 * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.forFileRange
 */
export async function askFirmwareLayout(
  pane: PaneId,
  target:
    | { readonly node: readonly number[]; readonly body?: boolean }
    | { readonly range: readonly [number, number] }
): Promise<UEFIRootLayout> {
  return (await askFirmwarePart(pane, target)).layout;
}

/**
 * What the parent's tree knows about a part of it, both halves at once: what
 * the bytes are read as on their own, and where they go back to through the
 * rebuild planner.
 *
 * One question because it is one question of the tree, asked at the one moment
 * a part is opened — upstream reads both off the image on the spot, having the
 * image at hand.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.of
 * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.forFileRange
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.target
 */
export async function askFirmwarePart(
  pane: PaneId,
  target:
    | { readonly node: readonly number[]; readonly body?: boolean }
    | { readonly range: readonly [number, number] }
): Promise<PartReading> {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") {
    return { layout: IMAGE_LAYOUT, rebuild: undefined };
  }
  return new Promise<PartReading>((resolve) => {
    // A second ask supersedes the first, which is then told the image as-is.
    layoutWaiters.get(pane)?.({ layout: IMAGE_LAYOUT, rebuild: undefined });
    layoutWaiters.set(pane, resolve);
    send(pane, { kind: "firmwareLayout", id: nextAskJob(pane), ...target });
  });
}

/** What the tree says a part of the image is, and what putting it back means. */
export interface PartReading {
  readonly layout: UEFIRootLayout;
  readonly rebuild: RebuildTarget | undefined;
}

/**
 * What putting `bytes` back at `target` would take, worked out in the pane's
 * own worker — the image parsed twice and every compressed section on the way
 * compressed again, which is seconds of work and none of it the main thread's.
 *
 * Nothing is written: the plan comes back, and the caller decides.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.performUpdateInParent
 */
export async function askFirmwareRebuild(
  pane: PaneId,
  bytes: Uint8Array,
  target: RebuildTarget,
  onProgress?: (phase: string, fraction: number) => void
): Promise<FirmwareRebuildResponse | undefined> {
  const content = await currentContent(pane);
  if (content === undefined) return undefined;
  return new Promise<FirmwareRebuildResponse | undefined>((resolve) => {
    // A second ask supersedes the first, which is then told nothing was planned.
    rebuildWaiters.get(pane)?.(undefined);
    rebuildWaiters.set(pane, resolve);
    if (onProgress !== undefined) rebuildProgress.set(pane, onProgress);
    send(pane, {
      kind: "firmwareRebuild",
      id: nextAskJob(pane),
      content,
      bytes,
      target: {
        space: target.space,
        ...(target.range === undefined
          ? {}
          : { range: [target.range.start, target.range.end] as const }),
      },
    });
  });
}

export function askFirmwareDetail(pane: PaneId, path: readonly number[]): void {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") return;
  send(pane, { kind: "firmwareDetail", id: workers[pane]?.job ?? 0, node: path });
}

/**
 * Puts one node's checksums back, as one undoable edit.
 *
 * The worker computes what to write because it has the image; the document
 * performs the writes because that is the only way an edit this application
 * makes can be taken back with the same key the user's own typing is. Then the
 * image is parsed again: the tree describes bytes, and these bytes changed.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.fixChecksum
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.onFixChecksum
 */
export async function fixFirmwareChecksum(
  pane: PaneId,
  path: readonly number[],
  volumeRevision: number
): Promise<number> {
  const slot = paneState(pane);
  if (slot === undefined) return 0;

  const writes = await new Promise<readonly { offset: number; bytes: Uint8Array }[]>((resolve) => {
    repairWaiters.set(pathKey(path), resolve);
    send(pane, {
      kind: "firmwareRepair",
      id: workers[pane]?.job ?? 0,
      node: path,
      volumeRevision,
    });
  });
  if (writes.length === 0) return 0;

  slot.document.beginEditGroup("Fix Checksum");
  for (const write of writes) await slot.document.overwrite(write.offset, write.bytes);
  slot.document.endEditGroup();
  await parsePaneFirmware(pane);
  return writes.length;
}

/**
 * Reads the pane's FIT table, against the tree this worker already holds.
 *
 * One worker per pane serves both tools, because both want the same two things:
 * a synchronous reader over the bytes, and the tree — a FIT row is named by
 * whatever node covers the address it points at.
 *
 * Nothing when the image has not been parsed yet: the caller asks for the parse
 * first, and a report read against no tree would name nothing.
 */
export function readPaneFit(pane: PaneId): Promise<FITReport | undefined> {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    // A second ask supersedes the first, which is then told no table was read.
    fitWaiters.get(pane)?.(undefined);
    fitWaiters.set(pane, resolve);
    send(pane, { kind: "fitRead", id: nextAskJob(pane) });
  });
}

/**
 * Changes the pane's FIT table, as one undoable step.
 *
 * The worker plans it because it has the image; the document performs the
 * writes because that is the only way an edit this application makes can be
 * taken back with the same key the user's own typing is. What comes back is
 * the sentence to say — which is the reason it could not be made, or what it
 * came to.
 */
export async function editPaneFit(
  pane: PaneId,
  edit: FitEditRequest["edit"]
): Promise<{ readonly problem: string | undefined; readonly summary: string | undefined }> {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") {
    return { problem: "That image has not been read yet.", summary: undefined };
  }
  const planned = await new Promise<FitEditResponse | undefined>((resolve) => {
    // A second edit supersedes the first, which is then told it did not happen:
    // the newer one is the one that counts, and its plan is the one applied.
    fitEditWaiters.get(pane)?.(undefined);
    fitEditWaiters.set(pane, resolve);
    send(pane, { kind: "fitEdit", id: nextAskJob(pane), edit });
  });
  if (planned === undefined) {
    return { problem: undefined, summary: undefined };
  }
  if (planned.problem !== undefined) {
    return { problem: planned.problem, summary: undefined };
  }

  const problem = await applyTransaction(pane, {
    name: planned.name ?? "Edit FIT Table",
    writes: planned.writes,
  });
  return problem === undefined
    ? { problem: undefined, summary: planned.summary }
    : { problem, summary: undefined };
}

/**
 * An analysis as it was read, and what it was read against — the pane's own
 * cache, so the two panels that present the ME region share one reading of it
 * rather than each making the most expensive read the application makes.
 *
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.cachedAnalysis
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.cachedAnalysisRegion
 * @upstream-differs the file's content generation and the three data files in
 * place of the region's byte range: upstream drops the cache when an edit lands
 * inside the region and when the database source says it has a newer one, and
 * both of those are answered here by the key missing. The key must count
 * *every* input the worker's `meAnalyze` reads — the database, the Huffman
 * dictionaries and the FileTable — or a reading made before one of them loaded
 * stands as the answer to the question that now includes it: the dictionaries
 * change what the analysis says of a Huffman module, and the table changes which
 * files an FTBL volume reads.
 */
interface CachedMeAnalysis {
  readonly generation: number;
  readonly database: string | undefined;
  readonly huffman: string | undefined;
  readonly fileTable: string | undefined;
  readonly response: MeAnalyzeResponse;
}

/**
 * What the pane's analysis said its files are called, and what it was said against.
 *
 * The ask is a function of the analysis (the volumes and config record IDs it
 * carries) and the `FileTable.dat` it is looked up in, and the analysis is a
 * function of the four inputs it is itself keyed by — so the names are kept by
 * the pane the way the analysis and the digests are, and a re-ask is answered
 * from the pane rather than re-parsing the largest of the databases.
 *
 * The key is the four inputs *and the ask*, though, because a panel does not
 * hold the two in step: its names effect runs the moment a data file lands,
 * with the analysis that is still on screen, while the re-reading that file
 * asked for is still in the worker. Keyed by the four alone, the answer to the
 * *old* analysis' ask is filed under the new inputs, and the analysis that
 * arrives a moment later — the one those inputs belong to — is handed the names
 * of the volumes it replaced.
 */
interface CachedMeFileNames {
  readonly generation: number;
  readonly database: string | undefined;
  readonly huffman: string | undefined;
  readonly fileTable: string | undefined;
  readonly ask: MeFileNamesQuestion;
  readonly response: MeFileNamesResponse;
}

/**
 * The half of a names ask that is not a data file: what the worker's
 * `meFileNames` actually reads, all of it out of the analysis on screen.
 */
interface MeFileNamesQuestion {
  readonly mfs: MFSVolume | undefined;
  readonly efs: EFSVolume | undefined;
  readonly configIDs: readonly number[];
  readonly platform: number;
  readonly dictionary: number;
}

/**
 * Whether two asks are the same question.
 *
 * The volumes go by identity: both panels build their ask out of the same
 * analysis — the pane's own cached one — so one reading hands out one pair of
 * objects and a different reading a different pair. The IDs are gathered afresh
 * on every ask (`meConfigIDs`), so those go by their values.
 */
function sameQuestion(one: MeFileNamesQuestion, two: MeFileNamesQuestion): boolean {
  return (
    one.mfs === two.mfs &&
    one.efs === two.efs &&
    one.platform === two.platform &&
    one.dictionary === two.dictionary &&
    one.configIDs.length === two.configIDs.length &&
    one.configIDs.every((id, at) => id === two.configIDs[at])
  );
}

/** The last analysis of each pane's ME region. */
const meAnalysisCache = new Map<PaneId, CachedMeAnalysis>();

/**
 * The analysis being read right now, and what it is being read against.
 *
 * Two panels on one file ask for the same region in the same moment — the UEFI
 * Structure opening it, the ME Analyzer re-reading on the switch to it — and
 * both would otherwise find the cache empty and read the whole region. The
 * second ask awaits this instead.
 *
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.analysisInFlight
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.analysisInFlightRegion
 */
const meAnalysisInFlight = new Map<
  PaneId,
  {
    readonly generation: number;
    readonly database: string | undefined;
    readonly huffman: string | undefined;
    readonly fileTable: string | undefined;
    readonly promise: Promise<MeAnalyzeResponse | undefined>;
  }
>();

/** What the pane's ME region was last read as, for a caller that only wants a hit. */
const meGenerationOf = (pane: PaneId): number => paneState(pane)?.document.contentGeneration ?? 0;

/**
 * Analyses the pane's ME region, against the database and the Huffman
 * dictionaries when there are some — or hands back the analysis already made of
 * these bytes against this database.
 *
 * Both files cross to the worker as text rather than parsed: parsing belongs
 * with the parser, and this side has no business holding a few thousand lines it
 * never reads.
 *
 * The cache is the pane's rather than a panel's, which is upstream's own
 * arrangement and the whole reason the UEFI Structure can open the ME region
 * without reading it again: a panel switch, a second panel, and a session put
 * away and brought back all find the same answer. It is dropped by its key
 * rather than by an event — an edit bumps the file's content generation, and a
 * newer database is a different text — so nothing has to remember to clear it.
 *
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.meAnalysis
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.cachedMEAnalysis
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.setCachedMEAnalysis
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.meAnalysis
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.cachedMEAnalysis
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.setCachedMEAnalysis
 */
export function analyzePaneMe(
  pane: PaneId,
  databaseText: string | undefined,
  huffmanText: string | undefined,
  fileTableText: string | undefined
): Promise<MeAnalyzeResponse | undefined> {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") return Promise.resolve(undefined);
  const generation = meGenerationOf(pane);
  const cached = meAnalysisCache.get(pane);
  if (
    cached?.generation === generation &&
    cached.database === databaseText &&
    cached.huffman === huffmanText &&
    cached.fileTable === fileTableText
  ) {
    return Promise.resolve(cached.response);
  }
  const flight = meAnalysisInFlight.get(pane);
  if (
    flight?.generation === generation &&
    flight.database === databaseText &&
    flight.huffman === huffmanText &&
    flight.fileTable === fileTableText
  ) {
    return flight.promise;
  }
  const promise = new Promise<MeAnalyzeResponse | undefined>((resolve) => {
    // A second ask supersedes the first, which is then told nothing was analysed.
    meWaiters.get(pane)?.(undefined);
    meWaiters.set(pane, resolve);
    send(pane, {
      kind: "meAnalyze",
      id: nextAskJob(pane),
      databaseText,
      huffmanText,
      fileTableText,
    });
  }).then((response) => {
    // Only the ask that started it clears it: an edit may have dropped this
    // marker and a later ask put its own in its place.
    if (meAnalysisInFlight.get(pane)?.promise === promise) meAnalysisInFlight.delete(pane);
    // An answer about bytes that have since moved is not this file's answer.
    if (response !== undefined && meGenerationOf(pane) === generation) {
      meAnalysisCache.set(pane, {
        generation,
        database: databaseText,
        huffman: huffmanText,
        fileTable: fileTableText,
        response,
      });
    }
    return response;
  });
  meAnalysisInFlight.set(pane, {
    generation,
    database: databaseText,
    huffman: huffmanText,
    fileTable: fileTableText,
    promise,
  });
  return promise;
}

/** Who is waiting for an ME analysis, by pane. */
const meWaiters = new Map<PaneId, (response: MeAnalyzeResponse | undefined) => void>();

/**
 * The ME region's digests — asked for only when somebody looks at them, since
 * they are three passes over the region — and kept with the analysis they
 * belong to, so the second panel to look at the Checksums row is answered
 * rather than reading the region three more times.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.loadChecksums
 * @upstream-differs upstream puts the digests into the cached analysis itself
 * (`FirmwareAnalysis.checksums`); here they are an input to the presentation, so
 * the pane caches them beside the analysis rather than inside it
 */
export function checksumPaneMe(pane: PaneId): Promise<MeChecksumsResponse | undefined> {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") return Promise.resolve(undefined);
  const generation = meGenerationOf(pane);
  const cached = meChecksumsCache.get(pane);
  if (cached?.generation === generation) return Promise.resolve(cached.response);
  const flight = meChecksumsInFlight.get(pane);
  if (flight?.generation === generation) return flight.promise;
  const promise = new Promise<MeChecksumsResponse | undefined>((resolve) => {
    checksumWaiters.get(pane)?.(undefined);
    checksumWaiters.set(pane, resolve);
    send(pane, { kind: "meChecksums", id: nextAskJob(pane) });
  }).then((response) => {
    if (meChecksumsInFlight.get(pane)?.promise === promise) meChecksumsInFlight.delete(pane);
    if (response !== undefined && meGenerationOf(pane) === generation) {
      meChecksumsCache.set(pane, { generation, response });
    }
    return response;
  });
  meChecksumsInFlight.set(pane, { generation, promise });
  return promise;
}

/** The region's digests as last computed, by pane. */
const meChecksumsCache = new Map<PaneId, { generation: number; response: MeChecksumsResponse }>();
const meChecksumsInFlight = new Map<
  PaneId,
  { readonly generation: number; readonly promise: Promise<MeChecksumsResponse | undefined> }
>();

/** The names an analysis' files were last looked up as, by pane. */
const meFileNamesCache = new Map<PaneId, CachedMeFileNames>();
const meFileNamesInFlight = new Map<
  PaneId,
  {
    readonly generation: number;
    readonly database: string | undefined;
    readonly huffman: string | undefined;
    readonly fileTable: string | undefined;
    readonly ask: MeFileNamesQuestion;
    readonly promise: Promise<MeFileNamesResponse | undefined>;
  }
>();

/**
 * Everything the pane's ME region was read as, dropped: the pane is gone, or
 * what it holds is no longer what was read.
 *
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.reset
 */
function forgetMeAnalysis(pane: PaneId): void {
  meAnalysisCache.delete(pane);
  meAnalysisInFlight.delete(pane);
  meChecksumsCache.delete(pane);
  meChecksumsInFlight.delete(pane);
  meFileNamesCache.delete(pane);
  meFileNamesInFlight.delete(pane);
}

/** Who is waiting for the ME region's digests, by pane. */
const checksumWaiters = new Map<PaneId, (response: MeChecksumsResponse | undefined) => void>();

/**
 * The names an analysis cannot give itself, looked up in `FileTable.dat` off
 * the main thread — the follow-up ask that names the files of an analysis.
 *
 * The volumes and the config record IDs cross, not the analysis: the worker is
 * where the table is parsed, and the panel never holds it. A second ask
 * supersedes the first, the way the analysis's does.
 *
 * The names are kept by the pane the way the analysis is, and keyed the same
 * way (G58) — on the document's generation and the three data files, and on the
 * ask itself, which is the analysis' half of the question and is not always in
 * step with the other four (see `CachedMeFileNames`). So a re-ask is answered
 * from the pane rather than re-sending — and re-parsing — the largest of the
 * databases. Upstream never re-parses: it reads the table from the data
 * source's in-memory cache, and keeps the looked-up names on the session.
 *
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.fileNames
 * @upstream-differs the web's store bridge for the ask upstream's session makes inline,
 * kept by the pane the way the analysis is rather than on the session
 */
export function fileNamesPaneMe(
  pane: PaneId,
  options: {
    readonly mfs: MFSVolume | undefined;
    readonly efs: EFSVolume | undefined;
    readonly configIDs: readonly number[];
    readonly platform: number;
    readonly dictionary: number;
    readonly databaseText: string | undefined;
    readonly huffmanText: string | undefined;
    readonly fileTableText: string | undefined;
  }
): Promise<MeFileNamesResponse | undefined> {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") return Promise.resolve(undefined);
  const generation = meGenerationOf(pane);
  const ask: MeFileNamesQuestion = {
    mfs: options.mfs,
    efs: options.efs,
    configIDs: options.configIDs,
    platform: options.platform,
    dictionary: options.dictionary,
  };
  const cached = meFileNamesCache.get(pane);
  if (
    cached?.generation === generation &&
    cached.database === options.databaseText &&
    cached.huffman === options.huffmanText &&
    cached.fileTable === options.fileTableText &&
    sameQuestion(cached.ask, ask)
  ) {
    return Promise.resolve(cached.response);
  }
  const flight = meFileNamesInFlight.get(pane);
  if (
    flight?.generation === generation &&
    flight.database === options.databaseText &&
    flight.huffman === options.huffmanText &&
    flight.fileTable === options.fileTableText &&
    sameQuestion(flight.ask, ask)
  ) {
    return flight.promise;
  }
  const promise = new Promise<MeFileNamesResponse | undefined>((resolve) => {
    // A second ask supersedes the first, which is then told nothing was named.
    meFileNamesWaiters.get(pane)?.(undefined);
    meFileNamesWaiters.set(pane, resolve);
    send(pane, {
      kind: "meFileNames",
      id: nextAskJob(pane),
      mfs: options.mfs,
      efs: options.efs,
      configIDs: options.configIDs,
      platform: options.platform,
      dictionary: options.dictionary,
      fileTableText: options.fileTableText,
    });
  }).then((response) => {
    // Only the ask that started it clears it: an edit may have dropped this
    // marker and a later ask put its own in its place.
    if (meFileNamesInFlight.get(pane)?.promise === promise) meFileNamesInFlight.delete(pane);
    // An answer about bytes that have since moved is not this file's answer.
    if (response !== undefined && meGenerationOf(pane) === generation) {
      meFileNamesCache.set(pane, {
        generation,
        database: options.databaseText,
        huffman: options.huffmanText,
        fileTable: options.fileTableText,
        ask,
        response,
      });
    }
    return response;
  });
  meFileNamesInFlight.set(pane, {
    generation,
    database: options.databaseText,
    huffman: options.huffmanText,
    fileTable: options.fileTableText,
    ask,
    promise,
  });
  return promise;
}

/** Who is waiting for an analysis's names, by pane. */
const meFileNamesWaiters = new Map<PaneId, (response: MeFileNamesResponse | undefined) => void>();

/** Who is waiting for a planned FIT edit, by pane; nothing when it was superseded. */
const fitEditWaiters = new Map<PaneId, (planned: FitEditResponse | undefined) => void>();

/** Who is waiting for a FIT report, by pane. One panel asks at a time. */
const fitWaiters = new Map<PaneId, (report: FITReport | undefined) => void>();

/** Who is waiting for a buffer's bytes, by pane. One command asks at a time. */
const spaceBytesWaiters = new Map<PaneId, (bytes: Uint8Array | undefined) => void>();

/** Who is waiting to be told what a part of this image would be read as. */
const layoutWaiters = new Map<PaneId, (reading: PartReading) => void>();

/** Who is waiting for a rebuild plan, by pane. One update runs at a time. */
const rebuildWaiters = new Map<PaneId, (response: FirmwareRebuildResponse | undefined) => void>();

/** Where a running rebuild's progress goes, by pane. */
const rebuildProgress = new Map<PaneId, (phase: string, fraction: number) => void>();

/** Who is waiting for a repair, by the node it is about. */
const repairWaiters = new Map<
  string,
  (writes: readonly { offset: number; bytes: Uint8Array }[]) => void
>();

/**
 * How long after the last keystroke a session is told what changed.
 *
 * An edit lands one change per keystroke and a parse per keystroke is not work,
 * it is heat — but the wait has to stay below the point where the panel looks
 * stale. Long enough that a burst is one delivery, short enough that a panel is
 * never quietly stale.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.changeDelay
 * @upstream-differs 300 ms against 150 ms, measured over a worker round trip rather than an in-process write
 */
const CHANGE_DELAY = 300;

/** A change waiting out its delay, or one that has just gone through. */
interface PendingChange {
  change: ToolContentChange;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const pendingChanges = new Map<PaneId, PendingChange>();

/**
 * Told that the bytes of `pane` changed, and holds the news briefly.
 *
 * The hold is why this is one place rather than each tool's own: a burst of
 * typing is one change to a reader and would be thirty parses to the worker,
 * and every tool would have to say so for itself.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.schedule
 */
export function noteFirmwareContentChange(pane: PaneId, change: ToolContentChange): void {
  // Whatever any tool-module parked against this pane described the file as it
  // was. The running one is told and re-reads; the parked ones have no way to
  // hear it, so they go — and before the guard below, because a parked state
  // outlives the session that left it and there may be nobody reading at all.
  //
  // @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.paneReloaded
  // @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.discardParkedState
  if (change.kind === "reloaded") {
    discardParkedStateFor(pane);
    // And the reading of its ME region, for the same reason and one more: the
    // cache is keyed by the document's content generation, and a document that
    // has just been replaced starts counting again from zero — so a key that
    // still matched would answer about the file that was here before.
    //
    // @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.reset
    forgetMeAnalysis(pane);
  }
  // Nothing is reading this pane's tree, so there is nothing to tell — and a
  // tree opened later is read from the content as it is then. Without this the
  // map below would hold a change for every pane anyone has ever edited.
  if (workers[pane] === undefined) return;
  const held = pendingChanges.get(pane);
  const merged = held === undefined ? change : mergedWith(held.change, change);
  if (held?.timer !== undefined) clearTimeout(held.timer);
  // A reload is not a keystroke: the content has just been replaced under the
  // session, there is nothing coming behind it to coalesce with, and holding it
  // back is the panel sitting on a tree of a file that is no longer there. It
  // goes straight through.
  if (merged.kind === "reloaded") {
    pendingChanges.delete(pane);
    void deliverContentChange(pane, merged);
    return;
  }
  const waiting: PendingChange = { change: merged, timer: undefined };
  waiting.timer = setTimeout(() => {
    pendingChanges.delete(pane);
    void deliverContentChange(pane, waiting.change);
  }, CHANGE_DELAY);
  pendingChanges.set(pane, waiting);
}

/**
 * A transaction's operations, as the change the pane's tree is told.
 *
 * An edit and an undo are the same news — the offsets are no longer what the
 * tree read, and how much of it that is depends only on the operations. A
 * transaction with no operations is the content being replaced outright, which
 * is a reload: there is nothing about it to be precise about.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.paneEdited
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.paneReloaded
 */
export function noteFirmwareOperations(pane: PaneId, operations: readonly UndoOperation[]): void {
  noteFirmwareContentChange(pane, changeOfOperations(operations) ?? { kind: "reloaded" });
}

/**
 * Hands one change to the pane's tree.
 *
 * An edit does not re-read the image: it says what the edit covered and whether
 * the length moved, and the worker drops only what that made stale, which is
 * what keeps every branch the user had opened. A reload has nothing to be
 * precise about — the content was replaced — so the image is read again from
 * the top.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.deliverPendingChange
 * @upstream-differs the tree is the worker's, not the session's: what a session
 * reads is the tree this holds, so telling it *is* replacing the tree
 */
async function deliverContentChange(pane: PaneId, change: ToolContentChange): Promise<void> {
  const held = workers[pane];
  if (held === undefined) return;
  if (change.kind === "reloaded") {
    await parsePaneFirmware(pane);
    return;
  }
  // The worker reads its own `Blob`, so the content as it now stands has to
  // cross — the containers the collapse drops are read again from it later.
  const content = await currentContent(pane);
  // The pane may have closed while the bytes were being gathered.
  if (content === undefined || workers[pane] !== held) return;
  // The job number is bumped before anything is sent, so a reply to the parse
  // this supersedes is dropped rather than applied to a tree it knows nothing
  // about — the stale-session guard.
  held.job += 1;
  // Nothing that was being read is being read against this tree any more —
  // including the one-at-a-time asks, whose replies this bump drops.
  dropAsks(pane);
  update(pane, { expanding: new Set() });
  held.worker.postMessage({
    kind: "firmwareInvalidate",
    id: held.job,
    content,
    range: [change.start, change.end],
    sizeDelta: change.sizeDelta,
  });
}

/**
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.reset
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.invalidate
 */
export function closeFirmware(pane: PaneId): void {
  workers[pane]?.worker.terminate();
  delete workers[pane];
  forgetMeAnalysis(pane);
  firmwareStore.update((state) => ({ panes: { ...state.panes, [pane]: undefined } }));
}

/** The node at `path`, or nothing. */
export function firmwareNodeAt(
  roots: readonly WireNode[],
  path: readonly number[]
): WireNode | undefined {
  let nodes = roots;
  let found: WireNode | undefined;
  for (const index of path) {
    const next = nodes[index];
    if (next === undefined) return undefined;
    found = next;
    nodes = next.children;
  }
  return found;
}

/**
 * A copy of the tree with one node's children filled in.
 *
 * Copied rather than mutated because the store compares by identity: a mutated
 * tree is a render that never happens.
 */
function replaceChildren(
  roots: readonly WireNode[],
  path: readonly number[],
  children: readonly WireNode[]
): WireNode[] {
  if (path.length === 0) return [...children];
  const [index, ...rest] = path;
  return roots.map((node, at) => {
    if (at !== index) return node;
    if (rest.length === 0) return { ...node, children, isExpandable: false };
    return { ...node, children: replaceChildren(node.children, rest, children) };
  });
}
