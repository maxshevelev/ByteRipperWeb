import {
  type AgentAnnotation,
  type DrawnAnnotation,
  type FileIdentity,
  sameFile,
} from "@/core/agent/agentAnnotation";
import type { BinaryDocument } from "@/core/document/binaryDocument";
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
 * The annotations, for the whole app and for as long as it runs (`AgentAnnotationTools`): what the
 * agent and the person said about places in files. A pane draws the ones for its file whenever it
 * shows it (`drawnIn`), and the Annotations panel lists them.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.items
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.unseen
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.generation
 * @upstream-differs a store the panes and the panel subscribe to, where upstream tells each pane
 */
export interface AgentAnnotationState {
  readonly items: readonly AgentAnnotation[];
  /** The agent's annotations made while the Annotations panel was not up, counted on its pill. */
  readonly unseen: ReadonlySet<string>;
}

export const agentAnnotationStore = createStore<AgentAnnotationState>({
  items: [],
  unseen: new Set(),
});

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

/** What the page can tell of the file a pane holds whole; nothing for a part or a new document. */
export function fileIdentityOf(pane: PaneId): FileIdentity | undefined {
  const held = paneState(pane);
  if (held === undefined || held.untitled || held.origin !== undefined) return undefined;
  return { name: held.file.name, size: held.file.size, modified: held.file.lastModified };
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
 * Adds `annotation`. An agent's annotation made while the Annotations panel is not up waits on
 * its pill as unseen.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.add
 */
export function addAnnotation(annotation: AgentAnnotation, panelIsUp: boolean): void {
  agentAnnotationStore.update((state) => {
    const unseen = new Set(state.unseen);
    if (annotation.author === "agent" && !panelIsUp) unseen.add(annotation.id);
    return { items: [...state.items, annotation], unseen };
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
 * Removes the annotations `doomed` picks, drops relations to them, and returns their ids.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.remove
 */
export function removeAnnotations(doomed: (annotation: AgentAnnotation) => boolean): string[] {
  const removed = allAnnotations()
    .filter(doomed)
    .map((one) => one.id);
  if (removed.length === 0) return [];
  const gone = new Set(removed);
  agentAnnotationStore.update((state) => ({
    items: state.items
      .filter((one) => !gone.has(one.id))
      .map((one) => ({ ...one, relatedTo: one.relatedTo.filter((id) => !gone.has(id)) })),
    unseen: new Set([...state.unseen].filter((id) => !gone.has(id))),
  }));
  return removed;
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
  agentAnnotationStore.update(() => ({ items: [], unseen: new Set() }));
}
