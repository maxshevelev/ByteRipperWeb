import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import {
  DETAIL_PREFERRED_MAX_SIZE,
  type MinimapMode,
  overviewIsInformative,
  preferredMode,
} from "@/render/minimap/minimapGeometry";
import type { OverviewPicture } from "@/render/minimap/minimapRenderer";
import { MINIMAP_COLUMNS, OverviewBinning } from "@/render/minimap/overviewBinning";
import { buildOverviewRows, type OverviewSource } from "@/render/minimap/overviewBuild";
import { diffStore } from "@/state/diffStore";
import { resultsFor, searchStore } from "@/state/searchStore";
import { createStore } from "@/state/store";
import { PANE_IDS, type PaneId, workspaceStore } from "@/state/workspaceStore";
import type { JobId, MinimapWorkerRequest, MinimapWorkerResponse } from "@/workers/protocol";

/**
 * The minimap's pictures, and the worker that builds them.
 *
 * The split is deliberate. The density picture reads every byte of the file, so
 * it is built in a worker and kept until the *file* changes — a new search or a
 * fresh comparison must not cost a rebuild. The masks over it are arithmetic
 * over ranges this side already holds (the piece table's edits, the comparison
 * index's blocks, the match set), so they are recomputed here, cheaply, as
 * often as they change.
 *
 * Both maps are binned over the longer file, so the same height is the same
 * absolute offset on both — which is the whole reason two maps are worth
 * showing side by side.
 */

export type MinimapStatus = "idle" | "building" | "ready" | "failed";

/**
 * The panel's width band, from `MainViewController`: it keeps at least the
 * minimum when shown, and never grows past the maximum, so it stays a compact
 * column beside the dumps however wide the window gets.
 */
export const MIN_MINIMAP_WIDTH = 120;
export const MAX_MINIMAP_WIDTH = 240;
/** Upstream opens at the minimum when the user has never chosen a width. */
export const DEFAULT_MINIMAP_WIDTH = MIN_MINIMAP_WIDTH;

const WIDTH_STORAGE_KEY = "byteripper.minimapWidth";

export const clampMinimapWidth = (width: number): number =>
  Math.min(MAX_MINIMAP_WIDTH, Math.max(MIN_MINIMAP_WIDTH, Math.round(width)));

/**
 * The width the user last chose.
 *
 * Upstream keeps this in `UserDefaults`; the browser's counterpart is
 * `localStorage`, which can throw outright in a private window — so a failure
 * to read it means the default, never a failure to open the panel.
 */
function storedWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (raw === null) return DEFAULT_MINIMAP_WIDTH;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? clampMinimapWidth(parsed) : DEFAULT_MINIMAP_WIDTH;
  } catch {
    return DEFAULT_MINIMAP_WIDTH;
  }
}

export interface MinimapState {
  readonly visible: boolean;
  /** The panel's width in CSS pixels, within the band above. */
  readonly width: number;
  readonly mode: MinimapMode;
  /** True once the user has chosen a mode, which then survives opening a file. */
  readonly modeChosen: boolean;
  /** How many pixel rows the panel can show; 0 until it has been measured. */
  readonly rowCount: number;
  /** The longest open file — the axis both maps share. */
  readonly extent: number;
  readonly pictures: Readonly<Record<PaneId, OverviewPicture | undefined>>;
  readonly status: MinimapStatus;
  /** In `[0, 1]` while a picture is being built. */
  readonly progress: number;
  readonly problem: string | undefined;
}

const IDLE: MinimapState = {
  visible: false,
  width: storedWidth(),
  mode: "overview",
  modeChosen: false,
  rowCount: 0,
  extent: 0,
  pictures: { a: undefined, b: undefined },
  status: "idle",
  progress: 0,
  problem: undefined,
};

export const minimapStore = createStore<MinimapState>(IDLE);

let nextJobId: JobId = 1;
/** The job each pane is waiting on, so a stale reply can be dropped. */
const currentJob: Record<PaneId, JobId | undefined> = { a: undefined, b: undefined };
/** What each pane's density was built for; an unchanged file is not rebuilt. */
const builtFor: Record<PaneId, string | undefined> = { a: undefined, b: undefined };
/** The density as it came back, kept so a mask change does not need a rebuild. */
const density: Record<PaneId, Uint8Array | undefined> = { a: undefined, b: undefined };

/**
 * One worker per pane, unlike the comparison and the search.
 *
 * Those ask a single question about the workspace, so a new request there
 * supersedes the one in flight and the worker is written to cancel itself. Two
 * maps are two independent questions about two files: sharing a worker made the
 * second pane's build cancel the first pane's, and one map came up blank. They
 * also have no reason to wait for each other — two 4 MB files build in the time
 * of one.
 */
const workers = new Map<PaneId, Worker>();

function workerFor(pane: PaneId): Worker {
  const existing = workers.get(pane);
  if (existing !== undefined) return existing;

  const worker = new Worker(new URL("../workers/minimap.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener("message", (event: MessageEvent<MinimapWorkerResponse>) => {
    const response = event.data;
    // A reply to a superseded job is an answer to an old question.
    if (currentJob[pane] !== response.id) return;

    switch (response.kind) {
      case "overviewProgress":
        minimapStore.update((state) => ({
          ...state,
          status: "building",
          progress: response.fraction,
        }));
        break;

      case "overviewDone":
        density[pane] = response.density;
        currentJob[pane] = undefined;
        minimapStore.update((state) => ({
          ...state,
          status: anyBuilding() ? "building" : "ready",
          progress: 1,
        }));
        void refreshMasks();
        break;

      case "cancelled":
        currentJob[pane] = undefined;
        break;

      case "error":
        currentJob[pane] = undefined;
        builtFor[pane] = undefined;
        minimapStore.update((state) => ({
          ...state,
          status: "failed",
          problem: response.message,
        }));
        break;
    }
  });
  workers.set(pane, worker);
  return worker;
}

/** True while either map is still being built. */
function anyBuilding(): boolean {
  return PANE_IDS.some((pane) => currentJob[pane] !== undefined);
}

const send = (pane: PaneId, request: MinimapWorkerRequest) => workerFor(pane).postMessage(request);

export function setMinimapVisible(visible: boolean): void {
  minimapStore.update((state) => (state.visible === visible ? state : { ...state, visible }));
  if (visible) void refreshMinimap();
}

/** Resizes the panel, clamped and remembered. */
export function setMinimapWidth(width: number): void {
  const next = clampMinimapWidth(width);
  if (minimapStore.getSnapshot().width === next) return;
  minimapStore.update((state) => ({ ...state, width: next }));
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(next));
  } catch {
    // A private window may refuse to store it; the width still applies here.
  }
}

export function toggleMinimap(): void {
  setMinimapVisible(!minimapStore.getSnapshot().visible);
}

export function setMinimapMode(mode: MinimapMode): void {
  minimapStore.update((state) =>
    state.mode === mode && state.modeChosen ? state : { ...state, mode, modeChosen: true }
  );
  void refreshMinimap();
}

/**
 * Tells the store how tall the panel is, in pixel rows.
 *
 * A resize changes how many rows the picture has, which changes the binning —
 * so a rebuild is the honest answer. The component debounces the call; drawing
 * the old picture stretched to the new height in the meantime is what "rescale
 * in hand" means.
 */
export function setMinimapRows(rowCount: number): void {
  if (minimapStore.getSnapshot().rowCount === rowCount) return;
  minimapStore.update((state) => ({ ...state, rowCount }));
  void refreshMinimap();
}

/** The file identity a density picture is valid for. */
function fingerprint(pane: PaneId, extent: number, rowCount: number): string | undefined {
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined) return undefined;
  return [slot.name, slot.file.size, slot.file.lastModified, extent, rowCount].join("|");
}

/**
 * Builds whatever is missing and refreshes what is not.
 *
 * Only the density picture can be missing: everything else is derived here and
 * recomputed unconditionally, because it is cheap enough that deciding whether
 * to would cost more than doing it.
 */
export async function refreshMinimap(): Promise<void> {
  const state = minimapStore.getSnapshot();
  if (!state.visible || state.rowCount <= 0) return;

  const panes = workspaceStore.getSnapshot().panes;
  const sizes = PANE_IDS.map((id) => panes[id]?.document.size ?? 0).filter((size) => size > 0);
  const extent = sizes.length === 0 ? 0 : Math.max(...sizes);

  if (extent !== state.extent) {
    // A new extent re-bins both maps, so neither picture is valid any more.
    for (const pane of PANE_IDS) {
      builtFor[pane] = undefined;
      density[pane] = undefined;
    }
  }

  const mode = state.modeChosen
    ? state.mode
    : preferredMode(sizes, state.rowCount * (1 / Math.max(1, devicePixelRatio())));
  minimapStore.update((current) => ({ ...current, extent, mode }));

  if (extent <= 0) {
    minimapStore.update((current) => ({
      ...current,
      status: "idle",
      pictures: { a: undefined, b: undefined },
    }));
    return;
  }

  for (const pane of PANE_IDS) {
    const slot = panes[pane];
    if (slot === undefined) {
      builtFor[pane] = undefined;
      density[pane] = undefined;
      continue;
    }
    const mark = fingerprint(pane, extent, state.rowCount);
    if (mark === builtFor[pane]) continue;
    builtFor[pane] = mark;

    // An edited document is not its file, so its density is built here against
    // the document rather than in the worker against the file — the same
    // division the comparison and the search make.
    const file = slot.file.source;
    if (slot.document.isDirty || !(file instanceof Blob)) {
      void buildHere(pane, extent, state.rowCount);
      continue;
    }

    const id = nextJobId++;
    const running = currentJob[pane];
    if (running !== undefined) send(pane, { kind: "cancel", id: running });
    currentJob[pane] = id;
    minimapStore.update((current) => ({ ...current, status: "building", progress: 0 }));
    send(pane, { kind: "overview", id, file, extent, rowCount: state.rowCount });
  }

  await refreshMasks();
}

/** The density picture for an edited document, built on this thread. */
async function buildHere(pane: PaneId, extent: number, rowCount: number): Promise<void> {
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined) return;
  const id = nextJobId++;
  currentJob[pane] = id;
  minimapStore.update((state) => ({ ...state, status: "building", progress: 0 }));

  try {
    const built = await buildOverviewRows(
      { size: slot.document.size, storage: slot.document },
      extent,
      rowCount,
      { from: 0, to: rowCount },
      { shouldCancel: () => currentJob[pane] !== id }
    );
    if (currentJob[pane] !== id || built === undefined) return;
    density[pane] = built.density;
    currentJob[pane] = undefined;
    minimapStore.update((state) => ({
      ...state,
      status: anyBuilding() ? "building" : "ready",
      progress: 1,
    }));
    await refreshMasks();
  } catch {
    // A cancelled build is a build whose inputs moved; the newer one publishes.
    if (currentJob[pane] === id) currentJob[pane] = undefined;
  }
}

/**
 * Recomputes the masks over the densities already built.
 *
 * Edits, differences and matches all land here. None of them reads the whole
 * file: the modified mask reads only the rows an edit can have reached, the
 * difference mask is arithmetic over the comparison's blocks, and the match
 * mask is arithmetic over the match set.
 */
export async function refreshMasks(): Promise<void> {
  const state = minimapStore.getSnapshot();
  if (!state.visible || state.rowCount <= 0 || state.extent <= 0) return;

  const workspace = workspaceStore.getSnapshot();
  const differences = diffStore.getSnapshot().index;
  const search = searchStore.getSnapshot();
  const pictures: Record<PaneId, OverviewPicture | undefined> = { a: undefined, b: undefined };

  for (const pane of PANE_IDS) {
    const slot = workspace.panes[pane];
    const built = density[pane];
    if (slot === undefined || built === undefined) continue;

    const overlay = slot.document.storage;
    const source: OverviewSource = {
      size: slot.document.size,
      storage: slot.document,
      saved: slot.saved,
      isUntitled: slot.saved === undefined,
      edited: overlay instanceof EditOverlayStorage ? overlay.changedRanges : [],
      differences:
        differences === undefined ? undefined : (start, end) => differences.blocksIn(start, end),
    };

    const masks = await buildOverviewRows(
      source,
      state.extent,
      state.rowCount,
      { from: 0, to: state.rowCount },
      { density: false }
    );
    if (masks === undefined) continue;

    const matches = matchMasks(pane, state.extent, state.rowCount, search);
    pictures[pane] = {
      extent: state.extent,
      fileSize: slot.document.size,
      rowCount: state.rowCount,
      density: built,
      modified: masks.modified,
      different: masks.different,
      ...matches,
    };
  }

  minimapStore.update((current) => ({ ...current, pictures }));
}

/**
 * The search's matches as the overview draws them.
 *
 * Marked by the *dump's* columns rather than the row's own bins: a row of the
 * overview is kilobytes, so its cells are slices of that span — right for a
 * density picture, and meaningless for a mark the eye is meant to line up with
 * the dump beside it.
 */
function matchMasks(
  pane: PaneId,
  extent: number,
  rowCount: number,
  search: ReturnType<typeof searchStore.getSnapshot>
): { matched?: Uint16Array; current?: Uint16Array } {
  const results = resultsFor(search, pane);
  if (results.status !== "found") return {};
  const binning = new OverviewBinning(extent, rowCount);
  const rows = { from: 0, to: rowCount };
  const result: { matched?: Uint16Array; current?: Uint16Array } = {};

  const matches = results.matches;
  if (matches?.isHighlightable === true) {
    const matched = new Uint16Array(rowCount);
    for (const range of matches.matchesIntersecting(0, extent)) {
      binning.markHexColumns(range.start, range.end, rows, matched);
    }
    result.matched = matched;
  }

  if (results.current !== undefined) {
    const current = new Uint16Array(rowCount);
    binning.markHexColumns(results.current.start, results.current.end, rows, current);
    result.current = current;
  }
  return result;
}

function devicePixelRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio;
}

/** How informative the overview would be — the switch is disabled where it is not. */
export function overviewWorthShowing(): boolean {
  const state = minimapStore.getSnapshot();
  const panes = workspaceStore.getSnapshot().panes;
  const sizes = PANE_IDS.map((id) => panes[id]?.document.size ?? 0).filter((size) => size > 0);
  return overviewIsInformative(sizes, state.rowCount);
}

/** Whether a file is small enough that detail is the more useful view. */
export function detailWorthShowing(): boolean {
  const panes = workspaceStore.getSnapshot().panes;
  const sizes = PANE_IDS.map((id) => panes[id]?.document.size ?? 0);
  return (sizes.length === 0 ? 0 : Math.max(...sizes)) <= DETAIL_PREFERRED_MAX_SIZE;
}

/** Rebuilds when the workspace changes, and re-masks when the overlays do. */
export function watchForMinimap(): () => void {
  const unsubscribes = [
    workspaceStore.subscribe(() => void refreshMinimap()),
    diffStore.subscribe(() => void refreshMasks()),
    searchStore.subscribe(() => void refreshMasks()),
  ];
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

/** Notes an edit, so the picture catches up without a full rebuild. */
let editTimer: ReturnType<typeof setTimeout> | undefined;

export function noteMinimapEdit(pane: PaneId): void {
  if (!minimapStore.getSnapshot().visible) return;
  if (editTimer !== undefined) clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    editTimer = undefined;
    // An edit changes the content, so the density is no longer the file's.
    builtFor[pane] = undefined;
    void refreshMinimap();
  }, EDIT_COALESCE_MS);
}

/** A fast typist produces one rebuild rather than one per keystroke. */
const EDIT_COALESCE_MS = 200;

/** Unused columns of a row, for tests that want the binning's own shape. */
export const MINIMAP_CELL_COUNT = MINIMAP_COLUMNS;
