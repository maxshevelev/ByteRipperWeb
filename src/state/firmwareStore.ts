import type { FITReport } from "@/firmware/fit/fitTable";
import { editStore } from "@/state/editStore";
import { createStore } from "@/state/store";
import { applyTransaction } from "@/state/toolEdits";
import { type PaneId, workspaceStore } from "@/state/workspaceStore";
import type {
  FirmwareDetailResponse,
  FirmwareWorkerRequest,
  FirmwareWorkerResponse,
  FitEditRequest,
  FitEditResponse,
  MeAnalyzeResponse,
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
};

export const firmwareStore = createStore<FirmwareState>({ panes: { a: undefined, b: undefined } });

export const pathKey = (path: readonly number[]): string => path.join(".");

function update(pane: PaneId, patch: Partial<PaneFirmware>): void {
  firmwareStore.update((state) => {
    const current = state.panes[pane] ?? empty;
    return { panes: { ...state.panes, [pane]: { ...current, ...patch } } };
  });
}

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
      case "meAnalyze": {
        meWaiters.get(pane)?.(response);
        meWaiters.delete(pane);
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

/** Opens the pane's document through whichever blob is current. */
export async function parsePaneFirmware(pane: PaneId): Promise<void> {
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined) return;
  // A clean document is its file, byte for byte, so the file is handed over as
  // it is — structured clone shares a blob's bytes rather than copying them.
  // A dirty one needs its own bytes, which means materialising them.
  if (!slot.document.isDirty && slot.file.source instanceof Blob) {
    openFirmware(pane, slot.file.source);
    return;
  }
  const bytes = await slot.document.read(0, slot.document.size);
  openFirmware(pane, new Blob([bytes]));
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

/** Asks for everything the detail panel shows about one node. */
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
 * Analyses the pane's ME region, against the database when there is one.
 *
 * The database's text crosses to the worker rather than a parsed database:
 * parsing it belongs with the parser, and this side has no business holding a
 * few thousand lines it never reads.
 */
export function analyzePaneMe(
  pane: PaneId,
  databaseText: string | undefined
): Promise<MeAnalyzeResponse | undefined> {
  const current = firmwareFor(pane);
  if (current === undefined || current.status !== "ready") return Promise.resolve(undefined);
  const job = workers[pane]?.job ?? 0;
  return new Promise((resolve) => {
    meWaiters.set(pane, resolve);
    send(pane, { kind: "meAnalyze", id: job, databaseText });
  });
}

/** Who is waiting for an ME analysis, by pane. */
const meWaiters = new Map<PaneId, (response: MeAnalyzeResponse | undefined) => void>();

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
 * How long after the last keystroke the image is read again.
 *
 * A tool's claim is that what it shows is what is in the file, so an edit has
 * to reach it — but not per byte: typing over a run of bytes is one edit to the
 * reader and would be thirty parses to the worker. Long enough that a burst is
 * one parse, short enough that a panel is never quietly stale.
 */
const RE_PARSE_AFTER = 300;

let reParseTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Every pane a tool has open is read again when its bytes settle.
 *
 * The rule lives here rather than in each tool because it is one rule, and a
 * tool that forgot it would show a table of what the file used to hold. A pane
 * has a worker only while a tool has asked for one, so this parses exactly what
 * something is looking at — and the undo of an edit is a change like any other,
 * which is the case a tool re-parsing only after its own edits gets wrong.
 */
editStore.subscribe(() => {
  if (reParseTimer !== undefined) clearTimeout(reParseTimer);
  reParseTimer = setTimeout(() => {
    reParseTimer = undefined;
    for (const pane of Object.keys(workers) as PaneId[]) void parsePaneFirmware(pane);
  }, RE_PARSE_AFTER);
});

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
