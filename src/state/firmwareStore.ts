import { createStore } from "@/state/store";
import { type PaneId, workspaceStore } from "@/state/workspaceStore";
import type {
  FirmwareWorkerRequest,
  FirmwareWorkerResponse,
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
      case "firmwareAddresses":
        update(pane, { addressDiff: response.addressDiff });
        return;
      case "firmwareRepair": {
        const waiting = repairWaiters.get(pathKey(response.node));
        repairWaiters.delete(pathKey(response.node));
        waiting?.(response.writes);
        return;
      }
      case "firmwareFailed":
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

/** Who is waiting for a repair, by the node it is about. */
const repairWaiters = new Map<
  string,
  (writes: readonly { offset: number; bytes: Uint8Array }[]) => void
>();

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
