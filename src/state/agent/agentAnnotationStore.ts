import {
  type AgentAnnotation,
  type AnnotationDecoded,
  type AnnotationSite,
  type DrawnAnnotation,
  type FileIdentity,
  sameFile,
} from "@/core/agent/agentAnnotation";
import { arranged, inCardOrder } from "@/core/agent/annotationOrder";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import { inDesktopShell } from "@/platform/desktop/desktopFiles";
import { desktopOwnWindows, ownWindowKind } from "@/platform/desktop/desktopWindows";
import { type KeyValueStore, openKeyValueStore } from "@/platform/storage/keyValueStore";
import { keptHandles, onFileReplaced, onHandlesChange, restoreHandles } from "@/state/fileReopen";
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
 * The annotations, for the whole app and — once `restoreAnnotations` has run — from one visit to
 * the next (`AgentAnnotationTools`): what the agent and the person said about places in files. A
 * pane draws the ones for its file whenever it shows it (`drawnIn`), and the Annotations panel
 * lists them in an order of its own — the newest first, then wherever the person drags a card.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.items
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.unseen
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.fresh
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.takeFresh
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.newIDs
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.order
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.generation
 * @upstream-differs a store the panes and the panel subscribe to, where upstream tells each pane;
 * `marked` and `chosen` are the panel's own state upstream (`AgentAnnotationCards.newIDs`, the
 * collection's selection), kept here because the offset menu and an undo select a card from outside
 */
export interface AgentAnnotationState {
  readonly items: readonly AgentAnnotation[];
  /** The agent's annotations made while the Annotations panel was not up, counted on its pill. */
  readonly unseen: ReadonlySet<string>;
  /**
   * Notes — the agent's or the person's — not yet marked new in the panel: it takes them at once
   * while it is up, and the next time it comes up otherwise.
   */
  readonly fresh: ReadonlySet<string>;
  /** The cards' order, first card first: a new one goes in front. */
  readonly order: readonly string[];
  /** The cards that wear the New tag: until the panel is folded, or the page left. */
  readonly marked: ReadonlySet<string>;
  /** The cards selected. */
  readonly chosen: ReadonlySet<string>;
  /** The card a Shift-click selects the run from: the one last clicked, or last selected alone. */
  readonly anchor: string | undefined;
  /** A card selected from outside the panel, for it to scroll to: a new object every time. */
  readonly reveal: { readonly id: string } | undefined;
  /** The number the next annotation's id is made with. */
  readonly nextId: number;
}

export const agentAnnotationStore = createStore<AgentAnnotationState>({
  items: [],
  unseen: new Set(),
  fresh: new Set(),
  order: [],
  marked: new Set(),
  chosen: new Set(),
  anchor: undefined,
  reveal: undefined,
  nextId: 1,
});

/**
 * Takes the id the next annotation is made with.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.nextID
 */
export function claimAnnotationId(): string {
  const id = agentAnnotationStore.getSnapshot().nextId;
  agentAnnotationStore.update((state) => ({ ...state, nextId: id + 1 }));
  return `a${id}`;
}

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
 * Every annotation in the cards' order: the newest first, then as the person arranged them.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.ordered
 */
export function orderedAnnotations(
  state: AgentAnnotationState = agentAnnotationStore.getSnapshot()
): readonly AgentAnnotation[] {
  return inCardOrder(allAnnotations(state), state.order);
}

/**
 * The person has dragged a card: the cards now stand as `ids` says.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.arrange
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.onArrange
 */
export function arrangeAnnotations(ids: readonly string[]): void {
  agentAnnotationStore.update((state) => {
    const order = arranged(state.order, ids);
    return order.join() === state.order.join() ? state : { ...state, order };
  });
}

/**
 * The cards `ids` name selected, and no others; with `anchor`, that card is where a Shift-click
 * selects the run from.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.select
 */
export function selectAnnotations(ids: Iterable<string>, anchor?: string): void {
  agentAnnotationStore.update((state) => ({
    ...state,
    chosen: new Set(ids),
    anchor: anchor ?? state.anchor,
  }));
}

/**
 * The cards `ids` name selected from outside the panel — the offset menu, a card's link to
 * another, an undo — and the panel scrolled to the first of them.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.select
 */
export function showAnnotationCards(ids: readonly string[]): void {
  // One card selected alone is the run's start, as a click on it would be.
  selectAnnotations(ids, ids.length === 1 ? ids[0] : undefined);
  const wanted = new Set(ids);
  const first = orderedAnnotations().find((one) => wanted.has(one.id));
  if (first !== undefined) {
    agentAnnotationStore.update((state) => ({ ...state, reveal: { id: first.id } }));
  }
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
      order: [annotation.id, ...state.order],
      fresh: new Set(state.fresh).add(annotation.id),
      unseen,
    };
  });
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
 * Annotations removed, kept so the removal can be undone: each with where it stood — among the
 * annotations as they were made, and among the cards — and the relations the others lost with them.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.Removed
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.Removed.annotation
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.Removed.made
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.Removed.card
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.removed
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.relations
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.Removal.ids
 */
export interface AnnotationRemoval {
  /** In the order they stood, first first. */
  readonly removed: readonly {
    readonly annotation: AgentAnnotation;
    readonly made: number;
    readonly card: number | undefined;
  }[];
  /** The relations of the annotations that named a removed one, as they were. */
  readonly relations: ReadonlyMap<string, readonly string[]>;
  readonly ids: readonly string[];
}

/**
 * Removes the annotations `doomed` picks, drops relations to them, and returns what puts them back:
 * the panel's ✕ and Delete, which Ctrl/⌘ Z undoes.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.removal
 */
export function removalOf(
  doomed: (annotation: AgentAnnotation) => boolean
): AnnotationRemoval | undefined {
  const all = allAnnotations();
  const gone = new Set(all.filter(doomed).map((one) => one.id));
  if (gone.size === 0) return undefined;
  const { order } = agentAnnotationStore.getSnapshot();
  const cards = new Map<string, number>();
  order.forEach((id, index) => {
    if (!cards.has(id)) cards.set(id, index);
  });
  const removed = all.flatMap((annotation, made) =>
    gone.has(annotation.id) ? [{ annotation, made, card: cards.get(annotation.id) }] : []
  );
  const relations = new Map<string, readonly string[]>();
  for (const one of all) {
    if (!gone.has(one.id) && one.relatedTo.some((id) => gone.has(id))) {
      relations.set(one.id, one.relatedTo);
    }
  }
  const without = (ids: ReadonlySet<string>) => new Set([...ids].filter((id) => !gone.has(id)));
  agentAnnotationStore.update((state) => ({
    ...state,
    items: state.items
      .filter((one) => !gone.has(one.id))
      .map((one) => ({ ...one, relatedTo: one.relatedTo.filter((id) => !gone.has(id)) })),
    order: state.order.filter((id) => !gone.has(id)),
    unseen: without(state.unseen),
    fresh: without(state.fresh),
    marked: without(state.marked),
    chosen: without(state.chosen),
  }));
  return { removed, relations, ids: removed.map((one) => one.annotation.id) };
}

/**
 * Removes the annotations `doomed` picks, drops relations to them, and returns their ids.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.remove
 */
export function removeAnnotations(doomed: (annotation: AgentAnnotation) => boolean): string[] {
  return [...(removalOf(doomed)?.ids ?? [])];
}

/**
 * Puts back what `removalOf` removed: each annotation where it stood, its card in its place among
 * the cards, and the relations as they were — to the annotations there still are. Ones put back
 * already are left.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.restore
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.relating
 */
export function restoreRemoval(removal: AnnotationRemoval): void {
  const present = new Set(allAnnotations().map((one) => one.id));
  const returning = removal.removed.filter((one) => !present.has(one.annotation.id));
  if (returning.length === 0) return;
  agentAnnotationStore.update((state) => {
    const items = [...state.items];
    for (const entry of [...returning].sort((one, other) => one.made - other.made)) {
      items.splice(Math.min(entry.made, items.length), 0, entry.annotation);
    }
    const order = [...state.order];
    const byCard = [...returning].sort(
      (one, other) =>
        (one.card ?? Number.MAX_SAFE_INTEGER) - (other.card ?? Number.MAX_SAFE_INTEGER)
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

// The Annotations panel is there while there is an annotation, and goes with the last one; while
// it is up, the agent's new ones count as seen and every note made since it was last up wears the
// New tag — the tags staying while it is up and going when it is folded.
// @upstream ByteRipperApp/Notes/MainViewController+Notes.swift#MainViewController.notesChanged
// @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.noteLookedAt
// @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.leftView
let synced = false;
function syncPanel(): void {
  if (synced) return;
  synced = true;
  try {
    // The panel stays up, empty, while the removal that emptied it can be taken back: with it gone
    // there would be nowhere to press Undo.
    // The desktop shell's annotations are a window of their own (D7c): no pill in a window of the
    // workspace, and the window counts as up while it is in front of the person.
    const own = ownWindowKind();
    const shell = own !== undefined || desktopOwnWindows() !== undefined;
    if (!shell) {
      const up = notesPanelIsUp(workspaceStore.getSnapshot());
      syncNotesPanel(allAnnotations().length > 0 || (up && canUndoRemoval()));
    }
    const up = own === "notes" ? notesWindowInView() : notesPanelIsUp(workspaceStore.getSnapshot());
    if (up) {
      markAnnotationsSeen();
      agentAnnotationStore.update((state) =>
        state.fresh.size === 0
          ? state
          : { ...state, fresh: new Set(), marked: new Set([...state.marked, ...state.fresh]) }
      );
    } else if (agentAnnotationStore.getSnapshot().marked.size > 0) {
      agentAnnotationStore.update((state) => ({ ...state, marked: new Set() }));
    }
  } finally {
    synced = false;
  }
}
agentAnnotationStore.subscribe(syncPanel);
workspaceStore.subscribe(syncPanel);

/**
 * Whether the Annotations window is in front of the person: on screen, and the window with the
 * keyboard.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.isInView
 */
function notesWindowInView(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()
  );
}
if (typeof window !== "undefined" && ownWindowKind() === "notes") {
  // Coming into view takes the count and marks the notes made meanwhile; going out of it takes
  // the marks off.
  for (const event of ["focus", "blur", "visibilitychange"]) {
    window.addEventListener(event, syncPanel);
  }
}

/**
 * Forgets every annotation, for a test that leaves none behind for the next.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.discardForTesting
 */
export function discardAnnotationsForTesting(): void {
  keeping = false;
  restoring = undefined;
  lastWritten = undefined;
  undoable = [];
  redoable = [];
  agentAnnotationStore.update(() => ({
    items: [],
    unseen: new Set(),
    fresh: new Set(),
    order: [],
    marked: new Set(),
    chosen: new Set(),
    anchor: undefined,
    reveal: undefined,
    nextId: 1,
  }));
}

// MARK: - Undo

/**
 * The removals made in the panel, the last last: Ctrl/⌘ Z puts the cards back where they stood,
 * Shift Ctrl/⌘ Z removes them again. Kept while the page is open, not from one visit to the next.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.removals
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.recordRemoval
 * @upstream-differs two stacks of the page's, where upstream gives the window an UndoManager of its own
 */
let undoable: AnnotationRemoval[] = [];
let redoable: AnnotationRemoval[] = [];

/**
 * The panel's removal of the cards `ids`, which it can take back.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.wireCards
 */
export function removeFromPanel(ids: ReadonlySet<string>): void {
  const removal = removing(() => removalOf((one) => ids.has(one.id)));
  if (removal === undefined) return;
  undoable.push(removal);
  redoable = [];
}

/** Whether a removal made in the panel is under way: one that will be there to take back. */
let removingInPanel = false;
function removing<T>(remove: () => T): T {
  removingInPanel = true;
  try {
    return remove();
  } finally {
    removingInPanel = false;
  }
}

/** Whether the panel has a removal to take back. */
export const canUndoRemoval = (): boolean => undoable.length > 0 || removingInPanel;
/** Whether the panel has a removal taken back to make again. */
export const canRedoRemoval = (): boolean => redoable.length > 0;

/**
 * Undo: the last removal made in the panel undone — the cards back where they stood, selected.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.putBack
 */
export function undoRemoval(): void {
  const removal = undoable.pop();
  if (removal === undefined) return;
  restoreRemoval(removal);
  redoable.push(removal);
  showAnnotationCards(removal.ids);
}

/**
 * Redo: the removal undone made again.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.removeAgain
 */
export function redoRemoval(): void {
  const undone = redoable.pop();
  if (undone === undefined) return;
  const ids = new Set(undone.ids);
  const removal = removing(() => removalOf((one) => ids.has(one.id)));
  if (removal !== undefined) undoable.push(removal);
}

// MARK: - Kept between visits

/**
 * What is kept: the annotations on files on disk — one on a document with no file goes with the
 * document — and with them the order of the cards, which are not yet marked new, and which the
 * pill still counts.
 *
 * @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.Contents
 * @upstream ByteRipperApp/Notes/AnnotationsFile.swift#AnnotationsFile.Stored
 * @upstream-differs kept in the browser's database, where upstream writes a JSON file in
 * Application Support; the file is known by its identity, which the shell's full path makes exact
 */
export interface StoredAnnotations {
  readonly annotations: readonly {
    readonly id: string;
    readonly identity: FileIdentity;
    readonly range: readonly [number, number] | undefined;
    readonly node: string | undefined;
    readonly title: string;
    readonly note: string;
    readonly decoded: AnnotationDecoded | undefined;
    readonly relatedTo: readonly string[];
    readonly site: AnnotationSite | undefined;
    readonly author: "agent" | "person";
  }[];
  readonly order: readonly string[];
  readonly fresh: readonly string[];
  readonly unseen: readonly string[];
  readonly nextId: number;
}

const DATABASE = "byteripper-annotations";
const KEY = "annotations";
// The handles the files were opened with, which Open Recent keeps the same way: a file opened by the
// picker has no path a page can see, so a handle is the only way back to it after a restart.
const HANDLES_KEY = "handles";
let storage: KeyValueStore | undefined;
let keeping = false;
let saveScheduled = false;

/** Points the annotations at another store: a test's memory one. */
export function setAnnotationsStorage(store: KeyValueStore): void {
  storage = store;
  restoring = undefined;
  lastWritten = undefined;
}

/** What the store holds now, as it is written. */
export function annotationsToStore(
  state: AgentAnnotationState = agentAnnotationStore.getSnapshot()
): StoredAnnotations {
  const annotations = allAnnotations(state).flatMap((one) =>
    one.file.kind === "disk"
      ? [
          {
            id: one.id,
            identity: one.file.identity,
            range: one.range,
            node: one.node,
            title: one.title,
            note: one.note,
            decoded: one.decoded,
            relatedTo: one.relatedTo,
            site: one.site,
            author: one.author,
          },
        ]
      : []
  );
  const ids = new Set(annotations.map((one) => one.id));
  const kept = (list: Iterable<string>) => [...list].filter((id) => ids.has(id));
  return {
    annotations,
    order: kept(state.order),
    fresh: kept(state.fresh).sort(),
    unseen: kept(state.unseen).sort(),
    nextId: state.nextId,
  };
}

/**
 * Reads what the last visit kept, and from here on writes after every change. Nothing kept — the
 * first visit — is no annotations.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.keep
 */
export function restoreAnnotations(): Promise<void> {
  // Once a visit: StrictMode mounts the shell twice, and a second read would add every kept
  // annotation again under a fresh id.
  restoring ??= readKept();
  return restoring;
}
let restoring: Promise<void> | undefined;

async function readKept(): Promise<void> {
  storage ??= openKeyValueStore(DATABASE);
  const heldHandles = await storage
    .get<Parameters<typeof restoreHandles>[0]>(HANDLES_KEY)
    .catch(() => undefined);
  // A file's handle is kept from one visit to the next in the desktop shell only; a browser opens
  // a kept handle again only as far as it allows at the time (`inDesktopShell`).
  if (Array.isArray(heldHandles) && inDesktopShell()) restoreHandles(heldHandles);
  const kept = await storage.get<StoredAnnotations>(KEY).catch(() => undefined);
  if (kept !== undefined && Array.isArray(kept.annotations)) {
    const items: AgentAnnotation[] = kept.annotations.map((one) => ({
      id: one.id,
      file: { kind: "disk", identity: one.identity },
      range: one.range,
      node: one.node,
      title: one.title,
      note: one.note,
      decoded: one.decoded,
      relatedTo: one.relatedTo,
      site: one.site,
      author: one.author,
    }));
    agentAnnotationStore.update((state) => {
      const { added, renamed, nextId } = mergedKept(state.items, items, kept.nextId);
      const ids = new Set(added.map((one) => one.id));
      const rename = (list: readonly string[]) =>
        list.map((id) => renamed.get(id) ?? id).filter((id) => ids.has(id));
      const order = rename(kept.order);
      // Ones with no place in the order stand in front, the newest of them first.
      order.push(
        ...added
          .map((one) => one.id)
          .filter((id) => !order.includes(id))
          .reverse()
      );
      return {
        ...state,
        items: [...added, ...state.items],
        order: [...state.order, ...order],
        fresh: new Set([...state.fresh, ...rename(kept.fresh)]),
        unseen: new Set([...state.unseen, ...rename(kept.unseen)]),
        nextId: Math.max(state.nextId, nextId),
      };
    });
  }
  keeping = true;
  // What came of putting the two together — a kept card given a new id — is written at once.
  scheduleSave();
  // What was opened before the last visit's handles were read is written with them.
  if (!inDesktopShell()) void storage.remove(HANDLES_KEY).catch(() => undefined);
  else if (keptHandles().length > 0)
    void storage.put(HANDLES_KEY, [...keptHandles()]).catch(() => undefined);
}

/**
 * The kept annotations beside the ones made before they were read — by an agent that reconnected
 * the moment the page came back, given ids from 1 again. Those keep the ids the agent was told;
 * a kept one whose id is taken gets a new one, and the kept ones that point at it follow it.
 *
 * @web-only the desktop reads what it kept before anything can annotate; a page reads its
 * database while an agent may already be at work
 */
export function mergedKept(
  present: readonly AgentAnnotation[],
  kept: readonly AgentAnnotation[],
  keptNextId: number
): { added: AgentAnnotation[]; renamed: Map<string, string>; nextId: number } {
  const number = (id: string) => Number(id.slice(1)) || 0;
  const taken = new Set(present.map((one) => one.id));
  let nextId = Math.max(keptNextId, ...[...present, ...kept].map((one) => number(one.id) + 1), 1);
  const renamed = new Map<string, string>();
  for (const one of kept) if (taken.has(one.id)) renamed.set(one.id, `a${nextId++}`);
  const added = kept.map((one) => ({
    ...one,
    id: renamed.get(one.id) ?? one.id,
    relatedTo: one.relatedTo.map((id) => renamed.get(id) ?? id),
  }));
  return { added, renamed, nextId };
}

/**
 * Writes the annotations once the change in hand is done: a survey that makes fifty writes the
 * database once, not fifty times.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.scheduleSave
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.saveNow
 */
function scheduleSave(): void {
  if (!keeping || saveScheduled) return;
  saveScheduled = true;
  queueMicrotask(() => {
    saveScheduled = false;
    // A click on a card, a tag coming or going, changes nothing that is kept: nothing is written.
    const kept = annotationsToStore();
    const written = JSON.stringify(kept);
    if (written === lastWritten) return;
    lastWritten = written;
    void storage?.put(KEY, kept).catch(() => undefined);
  });
}
/** What was written last, as text, to tell a change worth writing from one that is not. */
let lastWritten: string | undefined;
agentAnnotationStore.subscribe(scheduleSave);
// A save in place gave the file a new date: what is on it stays on it.
onFileReplaced((from, to) => {
  agentAnnotationStore.update((state) =>
    state.items.some((one) => one.file.kind === "disk" && sameFile(one.file.identity, from))
      ? {
          ...state,
          items: state.items.map((one) =>
            one.file.kind === "disk" && sameFile(one.file.identity, from)
              ? { ...one, file: { kind: "disk", identity: to } }
              : one
          ),
        }
      : state
  );
});
onHandlesChange(() => {
  if (keeping && inDesktopShell()) {
    void storage?.put(HANDLES_KEY, [...keptHandles()]).catch(() => undefined);
  }
});
