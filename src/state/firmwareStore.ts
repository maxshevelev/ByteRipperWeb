import type { UndoOperation } from "@/core/edit/undoHistory";
import type { FITReport } from "@/firmware/fit/fitTable";
import { discardParkedStateFor } from "@/state/parkedToolState";
import { createStore } from "@/state/store";
import { applyTransaction } from "@/state/toolEdits";
import { type PaneId, workspaceStore } from "@/state/workspaceStore";
import { changeOfOperations, mergedWith, type ToolContentChange } from "@/tools/contentChange";
import type {
  FirmwareDetailResponse,
  FirmwareProtectedRangesResponse,
  FirmwareWorkerRequest,
  FirmwareWorkerResponse,
  FitEditRequest,
  FitEditResponse,
  MeAnalyzeResponse,
  MeChecksumsResponse,
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
        fitWaiters.get(pane)?.(undefined);
        fitWaiters.delete(pane);
        fitEditWaiters.get(pane)?.({
          kind: "fitEdit",
          id: response.id,
          name: undefined,
          writes: [],
          problem: response.problem,
          summary: undefined,
          landed: undefined,
        });
        fitEditWaiters.delete(pane);
        meWaiters.get(pane)?.(undefined);
        meWaiters.delete(pane);
        checksumWaiters.get(pane)?.(undefined);
        checksumWaiters.delete(pane);
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
 * Parses the pane's current content.
 *
 * The blob is the file itself while the document is clean, and a snapshot of
 * what the document holds once it is not — the tree has to be about the bytes
 * on screen, not the ones on disk.
 */
export function openFirmware(pane: PaneId, content: Blob): void {
  const held = ensureWorker(pane);
  held.job += 1;
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
  held.worker.postMessage({ kind: "openFirmware", id: held.job, content });
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
  const slot = workspaceStore.getSnapshot().panes[pane];
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
  openFirmware(pane, content);
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
    send(pane, { kind: "firmwareNodeAtOffset", id: workers[pane]?.job ?? 0, offset });
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
  const slot = workspaceStore.getSnapshot().panes[pane];
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
  const job = workers[pane]?.job ?? 0;
  return new Promise((resolve) => {
    fitWaiters.set(pane, resolve);
    send(pane, { kind: "fitRead", id: job });
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
  const job = workers[pane]?.job ?? 0;
  const planned = await new Promise<FitEditResponse>((resolve) => {
    fitEditWaiters.set(pane, resolve);
    send(pane, { kind: "fitEdit", id: job, edit });
  });
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
 * Analyses the pane's ME region, against the database and the Huffman
 * dictionaries when there are some.
 *
 * Both files cross to the worker as text rather than parsed: parsing belongs
 * with the parser, and this side has no business holding a few thousand lines it
 * never reads.
 *
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.cachedMEAnalysis
 * @upstream ByteRipperApp/Pane/PaneUEFIState.swift#PaneUEFIState.setCachedMEAnalysis
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
  const job = workers[pane]?.job ?? 0;
  return new Promise((resolve) => {
    meWaiters.set(pane, resolve);
    send(pane, { kind: "meAnalyze", id: job, databaseText, huffmanText, fileTableText });
  });
}

/** Who is waiting for an ME analysis, by pane. */
const meWaiters = new Map<PaneId, (response: MeAnalyzeResponse | undefined) => void>();

/**
 * The ME region's digests — asked for only when somebody looks at them, since
 * they are three passes over the region.
 */
export function checksumPaneMe(pane: PaneId): Promise<MeChecksumsResponse | undefined> {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") return Promise.resolve(undefined);
  const job = workers[pane]?.job ?? 0;
  return new Promise((resolve) => {
    checksumWaiters.get(pane)?.(undefined);
    checksumWaiters.set(pane, resolve);
    send(pane, { kind: "meChecksums", id: job });
  });
}

/** Who is waiting for the ME region's digests, by pane. */
const checksumWaiters = new Map<PaneId, (response: MeChecksumsResponse | undefined) => void>();

/** Who is waiting for a planned FIT edit, by pane. */
const fitEditWaiters = new Map<PaneId, (planned: FitEditResponse) => void>();

/** Who is waiting for a FIT report, by pane. One panel asks at a time. */
const fitWaiters = new Map<PaneId, (report: FITReport | undefined) => void>();

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
  if (change.kind === "reloaded") discardParkedStateFor(pane);
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
  // Nothing that was being read is being read against this tree any more.
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
