import {
  type AgentAnnotation,
  type DrawnAnnotation,
  type FileIdentity,
  sameFile,
} from "@/core/agent/agentAnnotation";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import { type KeyValueStore, openKeyValueStore } from "@/platform/storage/keyValueStore";
import { createStore } from "@/state/store";
import { UEFIPartCodec } from "@/state/uefiPartCodec";
import {
  notesPanelIsUp,
  type PaneId,
  paneState,
  syncNotesPanel,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * The annotations, for the whole app, and from one launch to the next (`keepAnnotations`): what
 * the agent and the person said about places in files. A pane draws the ones for its file
 * whenever it shows it (`drawnIn`), and the Annotations panel lists them in an order of its own —
 * the newest first, then wherever the person drags a card.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.items
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.unseen
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.generation
 * @upstream-differs a store the panes and the panel subscribe to, where upstream tells each pane
 */
export interface AgentAnnotationState {
  /** In the order they were made, oldest first — the order an agent lists them in. */
  readonly items: readonly AgentAnnotation[];
  /** The agent's annotations made while the Annotations panel was not up, counted on its pill. */
  readonly unseen: ReadonlySet<string>;
  /**
   * Notes — the agent's or the person's — not yet marked new in the Annotations panel: it takes
   * them at once while it is up, and the next time it comes up otherwise.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.fresh
   */
  readonly fresh: ReadonlySet<string>;
  /**
   * The cards' order in the Annotations panel, first card first: a new one goes in front, and a
   * card dragged stays where it was put.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.order
   */
  readonly order: readonly string[];
  /**
   * The number the next annotation's id is made with — `a1`, `a2`…, one counter for the app, kept
   * with the annotations so an id kept from another launch is never made again.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.nextID
   */
  readonly nextId: number;
}

const EMPTY: AgentAnnotationState = {
  items: [],
  unseen: new Set(),
  fresh: new Set(),
  order: [],
  nextId: 1,
};

export const agentAnnotationStore = createStore<AgentAnnotationState>(EMPTY);

/** Whether `document` is still held by a pane — what an annotation on a document lives as long as. */
function documentIsOpen(document: BinaryDocument): boolean {
  const state = workspaceStore.getSnapshot();
  return (
    Object.values(state.panes).some((one) => one?.document === document) ||
    Object.values(state.parts).some((one) => one?.document === document)
  );
}

/**
 * Every annotation, in the order they were made — without those on a document that has closed.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.all
 */
export function allAnnotations(
  state: AgentAnnotationState = agentAnnotationStore.getSnapshot()
): readonly AgentAnnotation[] {
  return state.items.filter((one) => {
    if (one.file.kind !== "document") return true;
    const document = one.file.document.deref();
    return document !== undefined && documentIsOpen(document);
  });
}

/**
 * What the page can tell of the file a pane holds whole — its name, size and date, and in the
 * desktop shell its full path — nothing for a part or a new document.
 */
export function fileIdentityOf(pane: PaneId): FileIdentity | undefined {
  const held = paneState(pane);
  if (held === undefined || held.untitled || held.origin !== undefined) return undefined;
  const { name, size, lastModified, path } = held.file;
  return path === undefined
    ? { name, size, modified: lastModified }
    : { name, size, modified: lastModified, path };
}

/** Whether `annotation` is about the file `identity` names. */
export const isOnFile = (annotation: AgentAnnotation, identity: FileIdentity): boolean =>
  annotation.file.kind === "disk" && sameFile(annotation.file.identity, identity);

/**
 * The annotations `pane` draws, at its own addresses: those of its document, and — for a part
 * that keeps its parent's addresses all the way to a file — those of that file over the stretch
 * the part is. A body decompressed from a file, opened from the file's own pane, shows the
 * annotations found in it at its own addresses.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.annotations
 */
export function drawnIn(
  pane: PaneId,
  state: AgentAnnotationState = agentAnnotationStore.getSnapshot()
): DrawnAnnotation[] {
  const held = paneState(pane);
  if (held === undefined) return [];
  const all = allAnnotations(state);
  const drawn: DrawnAnnotation[] = [];
  for (const one of all) {
    if (one.file.kind !== "document" || one.file.document.deref() !== held.document) continue;
    if (one.range !== undefined)
      drawn.push({ annotation: one, start: one.range[0], end: one.range[1] });
  }
  const origin = held.origin;
  if (origin !== undefined && !origin.codec.keepsOffsets) {
    const codec = origin.codec;
    const root = fileIdentityOf(origin.parent);
    if (
      !(codec instanceof UEFIPartCodec) ||
      codec.target.space.length === 0 ||
      root === undefined
    ) {
      return drawn;
    }
    const start = codec.target.range?.start ?? 0;
    const end = start + held.document.size;
    for (const one of all) {
      const decoded = one.decoded;
      if (!isOnFile(one, root) || decoded?.space === undefined) continue;
      if (
        decoded.space.join(".") !== codec.target.space.join(".") ||
        decoded.source[0] !== origin.sourceRange[0] ||
        decoded.source[1] !== origin.sourceRange[1] ||
        decoded.range[0] < start ||
        decoded.range[1] > end
      ) {
        continue;
      }
      drawn.push({
        annotation: one,
        start: decoded.range[0] - start,
        end: decoded.range[1] - start,
      });
    }
    return drawn;
  }
  // Out through the parts to a file on disk, adding up where each one starts in the next.
  let shift = 0;
  let windowStart = 0;
  let windowEnd = held.document.size;
  let current: PaneId = pane;
  for (let origin = paneState(current)?.origin; origin !== undefined; ) {
    if (!origin.codec.keepsOffsets) return drawn;
    shift += origin.sourceRange[0];
    windowStart += origin.sourceRange[0];
    windowEnd += origin.sourceRange[0];
    current = origin.parent;
    origin = paneState(current)?.origin;
  }
  const identity = fileIdentityOf(current);
  if (identity === undefined) return drawn;
  for (const one of all) {
    if (!isOnFile(one, identity) || one.range === undefined) continue;
    if (one.range[0] < windowStart || one.range[1] > windowEnd) continue;
    drawn.push({ annotation: one, start: one.range[0] - shift, end: one.range[1] - shift });
  }
  return drawn;
}

/**
 * Every annotation in the cards' order: the newest first, then as the person arranged them.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.ordered
 */
export function orderedAnnotations(
  state: AgentAnnotationState = agentAnnotationStore.getSnapshot()
): readonly AgentAnnotation[] {
  const rank = new Map<string, number>();
  state.order.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  return [...allAnnotations(state)].sort(
    (left, right) => (rank.get(left.id) ?? -1) - (rank.get(right.id) ?? -1)
  );
}

/**
 * The id the next annotation is made with, taken: `a1`, `a2`… — one counter for the app.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.nextID
 */
export function takeAnnotationId(): string {
  const id = agentAnnotationStore.getSnapshot().nextId;
  agentAnnotationStore.update((state) => ({ ...state, nextId: state.nextId + 1 }));
  return `a${id}`;
}

/**
 * Adds `annotation`, its card first and marked new. An agent's annotation made while the
 * Annotations panel is not up also waits on its pill as unseen.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.add
 */
export function addAnnotation(annotation: AgentAnnotation, panelIsUp: boolean): void {
  agentAnnotationStore.update((state) => {
    const unseen = new Set(state.unseen);
    if (annotation.author === "agent" && !panelIsUp) unseen.add(annotation.id);
    return {
      ...state,
      items: [...state.items, annotation],
      unseen,
      order: [annotation.id, ...state.order],
      fresh: new Set([...state.fresh, annotation.id]),
    };
  });
}

/**
 * The person has dragged a card: the cards now stand as `ids` says.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.arrange
 */
export function arrangeAnnotations(ids: readonly string[]): void {
  const state = agentAnnotationStore.getSnapshot();
  const known = new Set(state.order);
  const arranged = ids.filter((id) => known.has(id));
  const placed = new Set(arranged);
  const order = [...arranged, ...state.order.filter((id) => !placed.has(id))];
  if (
    order.length === state.order.length &&
    order.every((id, index) => id === state.order[index])
  ) {
    return;
  }
  agentAnnotationStore.update((current) => ({ ...current, order }));
}

/**
 * The notes made since the panel was last up, which it marks new now that it is; from here on
 * they are not new.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.takeFresh
 */
export function takeFreshAnnotations(): ReadonlySet<string> {
  const taken = agentAnnotationStore.getSnapshot().fresh;
  if (taken.size === 0) return taken;
  agentAnnotationStore.update((state) => ({ ...state, fresh: new Set() }));
  return taken;
}

/**
 * The person's edit of annotation `id`: its title and note, the place kept.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.update
 */
// help: window.notes.edit
export function updateAnnotation(id: string, title: string, note: string): void {
  if (title === "") return;
  agentAnnotationStore.update((state) => ({
    ...state,
    items: state.items.map((one) => (one.id === id ? { ...one, title, note } : one)),
  }));
}

/**
 * Removes the annotations `doomed` picks, drops relations to them, and returns their ids.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.remove
 */
export function removeAnnotations(doomed: (annotation: AgentAnnotation) => boolean): string[] {
  return annotationRemoval(doomed)?.removed.map((one) => one.annotation.id) ?? [];
}

/**
 * Annotations removed, kept so the removal can be undone: each with where it stood — among the
 * annotations as they were made, and among the cards — and the relations the others lost with
 * them.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal
 */
export interface AnnotationRemoval {
  /**
   * In the order they stood, first first.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.removed
   */
  readonly removed: readonly {
    /** @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.Removed.annotation */
    readonly annotation: AgentAnnotation;
    /** @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.Removed.made */
    readonly made: number;
    /** @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.Removed.card */
    readonly card: number | undefined;
  }[];
  /**
   * The relations of the annotations that named a removed one, as they were.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.relations
   */
  readonly relations: ReadonlyMap<string, readonly string[]>;
}

/**
 * Removes the annotations `doomed` picks, as `removeAnnotations` does, and returns what puts them
 * back: the Annotations panel's ✕ and Delete, which ⌘Z undoes.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.removal
 */
export function annotationRemoval(
  doomed: (annotation: AgentAnnotation) => boolean
): AnnotationRemoval | undefined {
  const state = agentAnnotationStore.getSnapshot();
  const all = allAnnotations(state);
  const gone = new Set(all.filter(doomed).map((one) => one.id));
  if (gone.size === 0) return undefined;
  const cards = new Map<string, number>();
  state.order.forEach((id, index) => {
    if (!cards.has(id)) cards.set(id, index);
  });
  const removed = all.flatMap((annotation, made) =>
    gone.has(annotation.id) ? [{ annotation, made, card: cards.get(annotation.id) }] : []
  );
  const relations = new Map<string, readonly string[]>();
  for (const annotation of all) {
    if (gone.has(annotation.id)) continue;
    if (annotation.relatedTo.some((id) => gone.has(id))) {
      relations.set(annotation.id, annotation.relatedTo);
    }
  }
  agentAnnotationStore.update((current) => ({
    ...current,
    items: current.items
      .filter((one) => !gone.has(one.id))
      .map((one) => ({ ...one, relatedTo: one.relatedTo.filter((id) => !gone.has(id)) })),
    order: current.order.filter((id) => !gone.has(id)),
    unseen: new Set([...current.unseen].filter((id) => !gone.has(id))),
    fresh: new Set([...current.fresh].filter((id) => !gone.has(id))),
  }));
  return { removed, relations };
}

/**
 * Puts back what `removal` removed: each annotation where it stood, its card in its place among
 * the cards, and the relations as they were — to the annotations there still are. Ones put back
 * already are left.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.restore
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.relating
 */
export function restoreAnnotations(removal: AnnotationRemoval): void {
  const present = new Set(allAnnotations().map((one) => one.id));
  const returning = removal.removed.filter((one) => !present.has(one.annotation.id));
  if (returning.length === 0) return;
  agentAnnotationStore.update((state) => {
    const items = [...state.items];
    for (const entry of [...returning].sort((left, right) => left.made - right.made)) {
      items.splice(Math.min(entry.made, items.length), 0, entry.annotation);
    }
    const order = [...state.order];
    const byCard = [...returning].sort(
      (left, right) =>
        (left.card ?? Number.MAX_SAFE_INTEGER) - (right.card ?? Number.MAX_SAFE_INTEGER)
    );
    for (const entry of byCard) {
      order.splice(Math.min(entry.card ?? order.length, order.length), 0, entry.annotation.id);
    }
    const known = new Set(items.map((one) => one.id));
    return {
      ...state,
      items: items.map((one) => ({
        ...one,
        relatedTo: (removal.relations.get(one.id) ?? one.relatedTo).filter((id) => known.has(id)),
      })),
      order,
    };
  });
}

/**
 * The annotations have been looked at: the count on the pill goes.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.markSeen
 */
export function markAnnotationsSeen(): void {
  if (agentAnnotationStore.getSnapshot().unseen.size === 0) return;
  agentAnnotationStore.update((state) => ({ ...state, unseen: new Set() }));
}

// MARK: - Kept between launches

/**
 * One annotation as it is kept: an annotation on a file, its file by its name, size, date and —
 * in the desktop shell — its path. One on a document never saved is not kept: it goes with the
 * document.
 *
 * @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.Stored
 * @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.Stored.init
 * @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.Stored.annotation
 */
type StoredAnnotation = AgentAnnotation & { readonly file: { readonly kind: "disk" } };

/**
 * What is kept: the annotations in the order they were made, the cards' order, the new and the
 * unseen ones, and the next id.
 *
 * @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.Contents
 */
interface KeptAnnotations {
  /** @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.Contents.annotations */
  readonly annotations: readonly StoredAnnotation[];
  /** @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.Contents.order */
  readonly order: readonly string[];
  /** @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.Contents.fresh */
  readonly fresh: readonly string[];
  /** @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.Contents.unseen */
  readonly unseen: readonly string[];
  /** @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.Contents.nextID */
  readonly nextId: number;
}

/**
 * Where the annotations are kept between launches: this browser's IndexedDB, beside the
 * favourites — nothing carries them to another machine. A test installs a store of its own, or
 * none, which keeps them for the run alone.
 *
 * @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile
 * @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.url
 * @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.defaultURL
 * @upstream-differs IndexedDB, where upstream writes Annotations.json in Application Support
 */
let storage: KeyValueStore | undefined;
const KEPT = "annotations";
let saveScheduled = false;

/**
 * Reads what was kept, and from now on writes there after every change. Nothing kept — the first
 * launch — is no annotations. A launch reads it once, before anything is annotated.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.keep
 * @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.read
 */
export async function keepAnnotations(
  store: KeyValueStore = openKeyValueStore("byteripper-annotations")
): Promise<void> {
  storage = store;
  const kept = await store.get<KeptAnnotations>(KEPT).catch(() => undefined);
  if (kept === undefined || !Array.isArray(kept.annotations)) return;
  agentAnnotationStore.update((state) => {
    // Anything annotated while the kept ones were being read stays, after them.
    const keptIds = new Set(kept.annotations.map((one) => one.id));
    const items = [...kept.annotations, ...state.items.filter((one) => !keptIds.has(one.id))];
    const ids = new Set(items.map((one) => one.id));
    const order = [...state.order, ...kept.order].filter(
      (id, index, all) => ids.has(id) && all.indexOf(id) === index
    );
    const placed = new Set(order);
    order.push(
      ...items
        .map((one) => one.id)
        .filter((id) => !placed.has(id))
        .reverse()
    );
    const numbers = items
      .map((one) => Number.parseInt(one.id.slice(1), 10))
      .filter((number) => Number.isFinite(number));
    return {
      items,
      order,
      fresh: new Set([...kept.fresh, ...state.fresh].filter((id) => ids.has(id))),
      unseen: new Set([...kept.unseen, ...state.unseen].filter((id) => ids.has(id))),
      nextId: Math.max(kept.nextId, state.nextId, Math.max(0, ...numbers) + 1),
    };
  });
}

/**
 * Writes the annotations once the change in hand is done: a survey that makes fifty writes the
 * store once, not fifty times.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.scheduleSave
 */
function scheduleSave(): void {
  if (storage === undefined || saveScheduled) return;
  saveScheduled = true;
  queueMicrotask(() => void saveAnnotationsNow());
}

/**
 * Writes the annotations now. Ones on a document never saved are left out: they go with the
 * document.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.saveNow
 * @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.write
 */
export async function saveAnnotationsNow(): Promise<void> {
  saveScheduled = false;
  if (storage === undefined) return;
  const state = agentAnnotationStore.getSnapshot();
  const stored = allAnnotations(state).filter(
    (one): one is StoredAnnotation => one.file.kind === "disk"
  );
  const ids = new Set(stored.map((one) => one.id));
  const kept: KeptAnnotations = {
    annotations: stored,
    order: state.order.filter((id) => ids.has(id)),
    fresh: [...state.fresh].filter((id) => ids.has(id)).sort(),
    unseen: [...state.unseen].filter((id) => ids.has(id)).sort(),
    nextId: state.nextId,
  };
  await storage.put(KEPT, kept);
}

agentAnnotationStore.subscribe(scheduleSave);

// The Annotations panel is there while there is an annotation, and goes with the last one; while
// it is up, the agent's new ones count as seen.
// @upstream ByteRipperApp/Notes/MainViewController+Notes.swift#MainViewController.notesChanged
let synced = false;
function syncPanel(): void {
  if (synced) return;
  synced = true;
  try {
    syncNotesPanel(allAnnotations().length > 0);
    if (notesPanelIsUp(workspaceStore.getSnapshot())) markAnnotationsSeen();
  } finally {
    synced = false;
  }
}
agentAnnotationStore.subscribe(syncPanel);
workspaceStore.subscribe(syncPanel);

/**
 * Forgets every annotation, for a test that leaves none behind for the next.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.discardForTesting
 */
export function discardAnnotationsForTesting(): void {
  storage = undefined;
  agentAnnotationStore.update(() => EMPTY);
}
