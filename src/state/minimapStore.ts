import type { MatchSet } from "@/core/search/matchSet";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { currentMatchMarks, matchOverlayMarks } from "@/render/minimap/matchOverlay";
import {
  DETAIL_PREFERRED_MAX_SIZE,
  type MinimapMode,
  overviewIsInformative,
  preferredMode,
} from "@/render/minimap/minimapGeometry";
import type { OverviewPicture } from "@/render/minimap/minimapRenderer";
import { MINIMAP_COLUMNS } from "@/render/minimap/overviewBinning";
import { buildOverviewRows, type OverviewSource } from "@/render/minimap/overviewBuild";
import { diffStore } from "@/state/diffStore";
import { resultsFor, searchStore } from "@/state/searchStore";
import { createStore } from "@/state/store";
import {
  frontSurface,
  isSlot,
  PANE_IDS,
  type PaneId,
  paneIn,
  paneState,
  type SurfaceId,
  surfaceOf,
  WORKSPACE_SURFACE,
  workspaceStore,
} from "@/state/workspaceStore";
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
/*
 * Upstream's own band, unchanged.
 *
 * It was widened for a while to pay for what a map carried down its sides — a
 * margin, a strip and a gutter, all reserved whether or not the file had
 * anything to put in them. They are conditional now, so an uncut file nobody is
 * parsing keeps nearly the whole width for its sixteen columns and the original
 * band fits again. It matters beyond the width: the gutter between two maps is
 * a fraction of the panel, so a panel kept artificially wide held them
 * artificially far apart.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapMinPanelWidth
 */
export const MIN_MINIMAP_WIDTH = 120;
/** @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapMaxPanelWidth */
export const MAX_MINIMAP_WIDTH = 240;
/**
 * Upstream opens at the minimum when the user has never chosen a width.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapPreferredPanelWidth
 */
export const DEFAULT_MINIMAP_WIDTH = MIN_MINIMAP_WIDTH;

/** @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapWidthDefaultsKey */
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
  /** @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.renderMode */
  readonly mode: MinimapMode;
  /** True once the user has chosen a mode, which then survives opening a file. */
  readonly modeChosen: boolean;
  /** How many pixel rows the panel can show; 0 until it has been measured. */
  readonly rowCount: number;
  /** The longest open file — the axis both maps share. */
  readonly extent: number;
  /**
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.overviewSummaries
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.matchOverlays
   */
  readonly pictures: Readonly<Partial<Record<PaneId, OverviewPicture | undefined>>>;
  readonly status: MinimapStatus;
  /**
   * In `[0, 1]` while a picture is being built.
   *
   * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.progressBar
   * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.progressLabel
   * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.setRebuildProgress
   * @upstream-differs a <progress> element under the switch
   * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.OverviewProgressSink
   * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.beginOverviewProgress
   * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.reportOverviewProgress
   * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.hideOverviewProgress
   */
  readonly progress: number;
  readonly problem: string | undefined;
}

/**
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.OverviewSummary.empty
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.MatchOverlay.empty
 */
const IDLE: MinimapState = {
  visible: false,
  width: storedWidth(),
  mode: "overview",
  modeChosen: false,
  rowCount: 0,
  extent: 0,
  pictures: {},
  status: "idle",
  progress: 0,
  problem: undefined,
};

/**
 * One map per surface: the workspace's two panes share theirs — they are a
 * comparison, binned over the longer of the two — and every part opened over
 * them has a map of its own, of its own bytes and its own length (`Design/
 * GAPS.md` G50). Upstream's minimap state left the window for exactly this.
 *
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController
 * @upstream ByteRipperApp/Window/DocumentSurface.swift#DocumentSurface.minimap
 */
export interface MinimapsState {
  readonly surfaces: Readonly<Record<string, MinimapState>>;
}

export const minimapStore = createStore<MinimapsState>({ surfaces: {} });

/**
 * The map `surface` has.
 *
 * A surface nothing has touched yet answers with the workspace's own visibility,
 * mode and width and nothing else — which is how a panel opens with the map the
 * workspace has. The moment anything about that panel's map is changed it
 * becomes the panel's own.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.prepareFragmentMinimap
 * @upstream-differs upstream prepares a panel's map as the panel opens; here the
 * default answers for a surface nobody has touched, which is the same rule
 * without a copy to keep in step
 */
export function mapOn(state: MinimapsState, surface: SurfaceId): MinimapState {
  const held = state.surfaces[surface];
  if (held !== undefined) return held;
  if (surface === WORKSPACE_SURFACE) return IDLE;
  const workspace = state.surfaces[WORKSPACE_SURFACE] ?? IDLE;
  return { ...IDLE, visible: workspace.visible, mode: workspace.mode, width: workspace.width };
}

/** The map of the surface in front — what the toolbar's toggle means. */
export const frontMap = (state: MinimapsState): MinimapState => mapOn(state, frontSurface());

/** Writes one surface's map back, leaving every other surface alone. */
function updateMap(surface: SurfaceId, change: (map: MinimapState) => MinimapState): void {
  minimapStore.update((state) => ({
    surfaces: { ...state.surfaces, [surface]: change(mapOn(state, surface)) },
  }));
}

/** The map of a surface, off the store's current snapshot. */
const mapFor = (surface: SurfaceId): MinimapState => mapOn(minimapStore.getSnapshot(), surface);

/** The panes a surface draws: the workspace's two, or the part itself. */
const panesOf = (surface: SurfaceId): readonly PaneId[] =>
  surface === WORKSPACE_SURFACE ? PANE_IDS : [surface];

/** A part's map goes when the part does. */
export function forgetPartMinimap(pane: PaneId): void {
  if (isSlot(pane)) return;
  currentJob[pane] = undefined;
  builtFor[pane] = undefined;
  density[pane] = undefined;
  workers.get(pane)?.terminate();
  workers.delete(pane);
  minimapStore.update((state) => {
    if (state.surfaces[pane] === undefined) return state;
    const surfaces = { ...state.surfaces };
    delete surfaces[pane];
    return { surfaces };
  });
}

let nextJobId: JobId = 1;
/** The job each pane is waiting on, so a stale reply can be dropped. */
const currentJob: Partial<Record<PaneId, JobId | undefined>> = {};
/** What each pane's density was built for; an unchanged file is not rebuilt. */
const builtFor: Partial<Record<PaneId, string | undefined>> = {};
/** The density as it came back, kept so a mask change does not need a rebuild. */
const density: Partial<Record<PaneId, Uint8Array | undefined>> = {};

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
        updateMap(surfaceOf(pane), (map) => ({
          ...map,
          status: "building",
          progress: response.fraction,
        }));
        break;

      case "overviewDone":
        density[pane] = response.density;
        currentJob[pane] = undefined;
        updateMap(surfaceOf(pane), (map) => ({
          ...map,
          status: anyBuilding(surfaceOf(pane)) ? "building" : "ready",
          progress: 1,
        }));
        void refreshMasks(surfaceOf(pane));
        break;

      case "cancelled":
        currentJob[pane] = undefined;
        break;

      case "error":
        currentJob[pane] = undefined;
        builtFor[pane] = undefined;
        updateMap(surfaceOf(pane), (map) => ({
          ...map,
          status: "failed",
          problem: response.message,
        }));
        break;
    }
  });
  workers.set(pane, worker);
  return worker;
}

/** True while any of a surface's maps is still being built. */
function anyBuilding(surface: SurfaceId): boolean {
  return panesOf(surface).some((pane) => currentJob[pane] !== undefined);
}

const send = (pane: PaneId, request: MinimapWorkerRequest) => workerFor(pane).postMessage(request);

/**
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.setPanelVisible
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.isPanelVisible
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.panelVisibilityChanged
 */
export function setMinimapVisible(surface: SurfaceId, visible: boolean): void {
  updateMap(surface, (map) => (map.visible === visible ? map : { ...map, visible }));
  if (visible) void refreshMinimap(surface);
}

/**
 * Resizes the panel, clamped and remembered.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.setMinimapPanelWidth
 * @upstream ByteRipperApp/Window/DocumentSurface.swift#DocumentSurface.persistMinimapPanelWidth
 * @upstream ByteRipperApp/Window/DocumentSurface.swift#DocumentSurface.currentMinimapWidth
 */
export function setMinimapWidth(surface: SurfaceId, width: number): void {
  const next = clampMinimapWidth(width);
  if (mapFor(surface).width === next) return;
  updateMap(surface, (map) => ({ ...map, width: next }));
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(next));
  } catch {
    // A private window may refuse to store it; the width still applies here.
  }
}

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.toggleMinimap
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.togglePanel
 */
export function toggleMinimap(surface: SurfaceId = frontSurface()): void {
  setMinimapVisible(surface, !mapFor(surface).visible);
}

/**
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.setRenderMode
 * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.onModeChange
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.setRenderMode
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.toggleMinimapOverview
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.applyPreferredMinimapMode
 */
export function setMinimapMode(surface: SurfaceId, mode: MinimapMode): void {
  updateMap(surface, (map) =>
    map.mode === mode && map.modeChosen ? map : { ...map, mode, modeChosen: true }
  );
  void refreshMinimap(surface);
}

/**
 * Tells the store how tall the panel is, in pixel rows.
 *
 * A resize changes how many rows the picture has, which changes the binning —
 * so a rebuild is the honest answer. The component debounces the call; drawing
 * the old picture stretched to the new height in the meantime is what "rescale
 * in hand" means.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.onOverviewRowCountChanged
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.overviewBinsAreStale
 * @upstream-differs the old picture is stretched by CSS until the new one lands
 */
export function setMinimapRows(surface: SurfaceId, rowCount: number): void {
  if (mapFor(surface).rowCount === rowCount) return;
  updateMap(surface, (map) => ({ ...map, rowCount }));
  void refreshMinimap(surface);
}

/** The file identity a density picture is valid for. */
function fingerprint(pane: PaneId, extent: number, rowCount: number): string | undefined {
  const slot = paneState(pane);
  if (slot === undefined) return undefined;
  return [slot.name, slot.file.size, slot.file.lastModified, extent, rowCount].join("|");
}

/**
 * Builds whatever is missing and refreshes what is not.
 *
 * Only the density picture can be missing: everything else is derived here and
 * recomputed unconditionally, because it is cheap enough that deciding whether
 * to would cost more than doing it.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.setOverviewSummaries
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.rebuildOverview
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.scheduleOverviewRebuild
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.overviewSummary
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.refreshMaps
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.overviewSources
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.followIndexChange
 */
export async function refreshMinimap(surface: SurfaceId = frontSurface()): Promise<void> {
  const state = mapFor(surface);
  if (!state.visible || state.rowCount <= 0) return;

  const drawn = panesOf(surface);
  const sizes = drawn.map((id) => paneState(id)?.document.size ?? 0).filter((size) => size > 0);
  const extent = sizes.length === 0 ? 0 : Math.max(...sizes);

  if (extent !== state.extent) {
    // A new extent re-bins this surface's maps, so none of its pictures is
    // valid any more.
    for (const pane of drawn) {
      builtFor[pane] = undefined;
      density[pane] = undefined;
    }
  }

  const mode = state.modeChosen
    ? state.mode
    : preferredMode(sizes, state.rowCount * (1 / Math.max(1, devicePixelRatio())));
  updateMap(surface, (map) => ({ ...map, extent, mode }));

  if (extent <= 0) {
    updateMap(surface, (map) => ({ ...map, status: "idle", pictures: {} }));
    return;
  }

  for (const pane of drawn) {
    const slot = paneState(pane);
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
    updateMap(surface, (map) => ({ ...map, status: "building", progress: 0 }));
    send(pane, { kind: "overview", id, file, extent, rowCount: state.rowCount });
  }

  await refreshMasks(surface);
}

/** The density picture for an edited document, built on this thread. */
async function buildHere(pane: PaneId, extent: number, rowCount: number): Promise<void> {
  const slot = paneState(pane);
  if (slot === undefined) return;
  const surface = surfaceOf(pane);
  const id = nextJobId++;
  currentJob[pane] = id;
  updateMap(surface, (map) => ({ ...map, status: "building", progress: 0 }));

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
    updateMap(surface, (map) => ({
      ...map,
      status: anyBuilding(surface) ? "building" : "ready",
      progress: 1,
    }));
    await refreshMasks(surface);
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
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.setMatchOverlays
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.syncMatchOverlays
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.scheduleMatchSync
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.syncedMatchPicture
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.MatchPicture
 */
export function refreshMasks(surface: SurfaceId = frontSurface()): Promise<void> {
  // One refresh at a time *per surface*, and any number of requests during it
  // make one more: a search publishes every hundred milliseconds, and each
  // publish starting its own pass over the file stacked them up behind each
  // other. Per surface rather than in one queue, because two surfaces are two
  // questions about two files and neither should wait on the other.
  const running = masksRunning.get(surface);
  if (running !== undefined) {
    masksAgain.add(surface);
    return running;
  }
  const pass = (async () => {
    try {
      do {
        masksAgain.delete(surface);
        await refreshMasksOnce(surface);
      } while (masksAgain.has(surface));
    } finally {
      masksRunning.delete(surface);
    }
  })();
  masksRunning.set(surface, pass);
  return pass;
}

const masksRunning = new Map<SurfaceId, Promise<void>>();
const masksAgain = new Set<SurfaceId>();

async function refreshMasksOnce(surface: SurfaceId): Promise<void> {
  const state = mapFor(surface);
  if (!state.visible || state.rowCount <= 0 || state.extent <= 0) return;

  const workspace = workspaceStore.getSnapshot();
  const differences = diffStore.getSnapshot().index;
  const search = searchStore.getSnapshot();
  const pictures: Partial<Record<PaneId, OverviewPicture | undefined>> = {};

  for (const pane of panesOf(surface)) {
    const slot = paneIn(workspace, pane);
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

  updateMap(surface, (map) => ({ ...map, pictures }));
}

/**
 * The search's matches as the overview draws them.
 *
 * Marked by the *dump's* columns rather than the row's own bins: a row of the
 * overview is kilobytes, so its cells are slices of that span — right for a
 * density picture, and meaningless for a mark the eye is meant to line up with
 * the dump beside it.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.matchRanges
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.currentMatchRange
 */
function matchMasks(
  pane: PaneId,
  extent: number,
  rowCount: number,
  search: ReturnType<typeof searchStore.getSnapshot>
): { matched?: Uint16Array; current?: Uint16Array } {
  const results = resultsFor(search, pane);
  if (results.status !== "found") return {};
  const matched = matchOverlayMarks(results.matches, extent, rowCount);
  const current = currentMatchMarks(results.current, extent, rowCount);
  return {
    ...(matched === undefined ? {} : { matched }),
    ...(current === undefined ? {} : { current }),
  };
}

/**
 * Whether the search changed anything the map draws. The store also changes as
 * the query is typed and the options are set, none of which moves a mark.
 */
function matchesMoved(search: ReturnType<typeof searchStore.getSnapshot>): boolean {
  let moved = false;
  for (const pane of PANE_IDS) {
    const results = resultsFor(search, pane);
    const drawn = results.status === "found" ? results : undefined;
    const last = drawnMatches[pane];
    if (last.matches !== drawn?.matches || last.current !== drawn?.current) moved = true;
    drawnMatches[pane] = { matches: drawn?.matches, current: drawn?.current };
  }
  return moved;
}

const drawnMatches: Record<
  PaneId,
  { matches: MatchSet | undefined; current: { start: number; end: number } | undefined }
> = {
  a: { matches: undefined, current: undefined },
  b: { matches: undefined, current: undefined },
};

function devicePixelRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio;
}

/**
 * How informative the overview would be — the switch is disabled where it is not.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.onOverviewUsefulnessChanged
 * @upstream ByteRipperApp/Minimap/MinimapPanelView.swift#MinimapPanelView.setOverviewAvailable
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.updateOverviewAvailability
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.preferredMinimapMode
 */
export function overviewWorthShowing(surface: SurfaceId = WORKSPACE_SURFACE): boolean {
  const sizes = sizesOn(surface).filter((size) => size > 0);
  return overviewIsInformative(sizes, mapFor(surface).rowCount);
}

/** Whether a file is small enough that detail is the more useful view. */
export function detailWorthShowing(surface: SurfaceId = WORKSPACE_SURFACE): boolean {
  const sizes = sizesOn(surface);
  return (sizes.length === 0 ? 0 : Math.max(...sizes)) <= DETAIL_PREFERRED_MAX_SIZE;
}

/** What a surface's panes hold, in bytes. */
const sizesOn = (surface: SurfaceId): number[] =>
  panesOf(surface).map((pane) => paneState(pane)?.document.size ?? 0);

/** Rebuilds when the workspace changes, and re-masks when the overlays do. */
export function watchForMinimap(): () => void {
  // Every surface that has a map: the workspace's, and one per part in the
  // dock. A part's map answers to the same news its parent's does — its file
  // changed length, its search moved — and nothing else would tell it.
  const everyMap = (act: (surface: SurfaceId) => void): void => {
    act(WORKSPACE_SURFACE);
    for (const surface of Object.keys(minimapStore.getSnapshot().surfaces)) {
      if (surface !== WORKSPACE_SURFACE) act(surface as SurfaceId);
    }
  };
  const unsubscribes = [
    workspaceStore.subscribe(() => everyMap((surface) => void refreshMinimap(surface))),
    diffStore.subscribe(() => everyMap((surface) => void refreshMasks(surface))),
    searchStore.subscribe(() => {
      if (matchesMoved(searchStore.getSnapshot())) {
        everyMap((surface) => void refreshMasks(surface));
      }
    }),
  ];
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

/**
 * The coalesced rebuild, one per surface: an edit on another surface must not
 * cancel this one's pending refresh.
 */
const editTimers = new Map<SurfaceId, ReturnType<typeof setTimeout>>();

/**
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.updateOverviewRows
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.invalidateBytes
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.patchOverviewRows
 */
export function noteMinimapEdit(pane: PaneId): void {
  const surface = surfaceOf(pane);
  if (!mapFor(surface).visible) return;
  // An edit changes the content, so the density is no longer the file's. Cleared
  // now, for the pane edited, so a burst across panes drops each one's picture.
  builtFor[pane] = undefined;
  const pending = editTimers.get(surface);
  if (pending !== undefined) clearTimeout(pending);
  editTimers.set(
    surface,
    setTimeout(() => {
      editTimers.delete(surface);
      void refreshMinimap(surface);
    }, EDIT_COALESCE_MS)
  );
}

/** A fast typist produces one rebuild rather than one per keystroke. */
const EDIT_COALESCE_MS = 200;

/** Unused columns of a row, for tests that want the binning's own shape. */
export const MINIMAP_CELL_COUNT = MINIMAP_COLUMNS;
