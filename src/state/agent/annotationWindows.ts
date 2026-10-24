import type { AgentAnnotation, AnnotationFile, FileIdentity } from "@/core/agent/agentAnnotation";
import { sameFile } from "@/core/agent/agentAnnotation";
import {
  mergeAnnotations,
  NO_SHARED_ANNOTATIONS,
  type SharedAnnotation,
  type SharedAnnotations,
} from "@/core/agent/annotationMerge";
import type { SessionView } from "@/core/session/sessionView";
import {
  desktopOwnWindows,
  desktopWindowFocus,
  ownWindowKind,
} from "@/platform/desktop/desktopWindows";
import {
  type AgentAnnotationState,
  agentAnnotationStore,
  allAnnotations,
  fileIdentityOf,
  restoreAnnotations,
  showAnnotationCards,
} from "@/state/agent/agentAnnotationStore";
import { agentService } from "@/state/agent/agentService";
import { PANE_IDS, type PaneId } from "@/state/paneId";
import { paneState, workspaceStore } from "@/state/workspaceStore";

/**
 * The annotations as the app's, across the desktop shell's windows (`Design/DESKTOP_WINDOWS.md`,
 * D7c): every window's page holds the same annotations and tells the others of each change, which
 * they put together with their own (`mergeAnnotations`). The Annotations window is one more page
 * holding them, which shows the cards; what it is asked to do with a card — show its place —
 * goes to the window holding the document.
 *
 * An annotation on a document with no file lives in the window holding that document, and the
 * others know it as being there (`AnnotationFile` "elsewhere"): by that window and the pane.
 *
 * @web-only one set the app's windows each hold a copy of, where upstream's windows share one
 * object
 */

const CHANNEL = "byteripper-annotations";

/** This page among the app's windows, for as long as it is open. */
const me =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `w${Math.random().toString(36).slice(2)}`;

/** What a window says of itself: the files it holds, and when it was last in front. */
interface WindowInfo {
  readonly open: readonly FileIdentity[];
  readonly focusedAt: number;
  readonly own: string | undefined;
}

type Message =
  | { readonly type: "hello"; readonly from: string }
  | {
      readonly type: "state";
      readonly from: string;
      readonly state: SharedAnnotations;
      readonly info: WindowInfo;
    }
  | { readonly type: "info"; readonly from: string; readonly info: WindowInfo }
  | { readonly type: "gone"; readonly from: string }
  | { readonly type: "show"; readonly to: string; readonly id: string };

let channel: BroadcastChannel | undefined;
/** The version this window last agreed on with the others: what its changes are reckoned from. */
let agreed: SharedAnnotations = NO_SHARED_ANNOTATIONS;
const windows = new Map<string, WindowInfo>();
let focusedAt = 0;

/** The pane holding `document` in this window, if any does. */
function paneOf(document: SessionView): PaneId | undefined {
  const state = workspaceStore.getSnapshot();
  for (const slot of PANE_IDS) if (state.panes[slot]?.document === document) return slot;
  for (const [part, held] of Object.entries(state.parts)) {
    if (held.document === document) return part as PaneId;
  }
  return undefined;
}

function sharedFile(file: AnnotationFile): SharedAnnotation["file"] | undefined {
  if (file.kind === "disk") return file;
  if (file.kind === "elsewhere") return file;
  const document = file.document.deref();
  const pane = document === undefined ? undefined : paneOf(document);
  return pane === undefined ? undefined : { kind: "elsewhere", window: me, pane, name: file.name };
}

/** The annotations as this window tells the others of them. */
export function sharedFrom(
  state: AgentAnnotationState = agentAnnotationStore.getSnapshot()
): SharedAnnotations {
  const items: SharedAnnotation[] = [];
  for (const one of allAnnotations(state)) {
    const file = sharedFile(one.file);
    if (file === undefined) continue;
    items.push({
      id: one.id,
      file,
      range: one.range,
      node: one.node,
      title: one.title,
      note: one.note,
      decoded: one.decoded,
      relatedTo: one.relatedTo,
      site: one.site,
      author: one.author,
    });
  }
  const ids = new Set(items.map((one) => one.id));
  const kept = (list: Iterable<string>) => [...list].filter((id) => ids.has(id));
  return {
    items,
    order: kept(state.order),
    fresh: kept(state.fresh).sort(),
    unseen: kept(state.unseen).sort(),
    nextId: state.nextId,
  };
}

/** `shared` as this window holds it: its own documents' annotations on its documents again. */
function adopt(shared: SharedAnnotations): void {
  agentAnnotationStore.update((state) => {
    const held = new Map(state.items.map((one) => [one.id, one]));
    const items: AgentAnnotation[] = [];
    for (const one of shared.items) {
      let file: AnnotationFile | undefined;
      if (one.file.kind === "elsewhere" && one.file.window === me) {
        // One of this window's documents: the document itself, as this window holds it.
        const before = held.get(one.id)?.file;
        const document =
          before?.kind === "document"
            ? before.document.deref()
            : paneState(one.file.pane as PaneId)?.document;
        file =
          document === undefined
            ? undefined
            : { kind: "document", document: new WeakRef(document), name: one.file.name };
      } else {
        file = one.file as AnnotationFile;
      }
      if (file === undefined) continue;
      items.push({ ...(one as unknown as AgentAnnotation), file });
    }
    // A document closed here keeps no annotation, and is not told anyone either.
    const ids = new Set(items.map((one) => one.id));
    const kept = (list: Iterable<string>) => new Set([...list].filter((id) => ids.has(id)));
    return {
      ...state,
      items,
      order: shared.order.filter((id) => ids.has(id)),
      fresh: kept(shared.fresh),
      unseen: kept(shared.unseen),
      chosen: kept(state.chosen),
      marked: kept(state.marked),
      nextId: Math.max(state.nextId, shared.nextId),
    };
  });
}

const same = (one: SharedAnnotations, other: SharedAnnotations) =>
  JSON.stringify(one) === JSON.stringify(other);

/** What this window says of itself. */
function info(): WindowInfo {
  const open: FileIdentity[] = [];
  for (const slot of PANE_IDS) {
    const identity = fileIdentityOf(slot);
    if (identity !== undefined) open.push(identity);
  }
  return { open, focusedAt, own: ownWindowKind() };
}

function post(message: Message): void {
  channel?.postMessage(message);
}

let sendScheduled = false;
/** Tells the others of a change once the change in hand is done. */
function scheduleSend(): void {
  if (sendScheduled || channel === undefined) return;
  sendScheduled = true;
  queueMicrotask(() => {
    sendScheduled = false;
    send(false);
  });
}

function send(always: boolean): void {
  const now = sharedFrom();
  if (!always && same(now, agreed)) return;
  agreed = now;
  post({ type: "state", from: me, state: now, info: info() });
}

let lastInfo = "";
/** Tells the others which files this window holds, when that has changed. */
function sendInfo(): void {
  const now = info();
  const text = JSON.stringify(now);
  if (text === lastInfo) return;
  lastInfo = text;
  post({ type: "info", from: me, info: now });
}

function receive(message: Message): void {
  switch (message.type) {
    case "hello":
      windows.delete(message.from);
      send(true);
      return;
    case "state": {
      windows.set(message.from, message.info);
      const mine = sharedFrom();
      const { merged } = mergeAnnotations(agreed, mine, message.state);
      agreed = message.state;
      if (!same(merged, mine)) adopt(merged);
      // Whatever this window holds that the other has not got goes back to it.
      scheduleSend();
      return;
    }
    case "info":
      windows.set(message.from, message.info);
      for (const listener of notesListeners) listener();
      return;
    case "gone": {
      windows.delete(message.from);
      const gone = (shared: SharedAnnotations): SharedAnnotations => {
        const items = shared.items.filter(
          (one) => !(one.file.kind === "elsewhere" && one.file.window === message.from)
        );
        const ids = new Set(items.map((one) => one.id));
        return {
          ...shared,
          items,
          order: shared.order.filter((id) => ids.has(id)),
          fresh: shared.fresh.filter((id) => ids.has(id)),
          unseen: shared.unseen.filter((id) => ids.has(id)),
        };
      };
      agreed = gone(agreed);
      adopt(gone(sharedFrom()));
      for (const listener of notesListeners) listener();
      return;
    }
    case "show":
      if (message.to !== me) return;
      desktopWindowFocus()?.();
      void agentService.annotationTools.show(message.id, true);
      return;
  }
}

/**
 * Starts sharing the annotations with the app's other windows, once this page has read what was
 * kept: in the desktop shell only, where the windows are one app. A browser's tabs are workspaces
 * of their own.
 */
export function shareAnnotationsAcrossWindows(): void {
  if (channel !== undefined || typeof BroadcastChannel === "undefined") return;
  if (desktopOwnWindows() === undefined) return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<Message>) => receive(event.data);
  // What this page read from the database is what the others read too: the version agreed.
  agreed = sharedFrom();
  agentAnnotationStore.subscribe(scheduleSend);
  workspaceStore.subscribe(() => {
    // A document opened or closed here changes what the others are told.
    scheduleSend();
    sendInfo();
  });
  if (typeof window !== "undefined") {
    const front = () => {
      focusedAt = Date.now();
      sendInfo();
    };
    if (document.hasFocus()) focusedAt = Date.now();
    window.addEventListener("focus", front);
    window.addEventListener("pagehide", () => post({ type: "gone", from: me }));
  }
  post({ type: "hello", from: me });
  sendInfo();
}

const notesListeners = new Set<() => void>();
/** Hears when what the other windows hold has changed: a card's dot says whether it is open. */
export function onWindowsChanged(listener: () => void): () => void {
  notesListeners.add(listener);
  return () => notesListeners.delete(listener);
}

/** Whether the annotation's document is open in some window of the app. */
export function annotationIsOpen(annotation: AgentAnnotation): boolean {
  if (ownWindowKind() !== "notes") {
    return agentService.annotationTools.placeOf(annotation) !== undefined;
  }
  const file = annotation.file;
  if (file.kind === "elsewhere") return windows.has(file.window);
  if (file.kind !== "disk") return false;
  return [...windows.values()].some((one) =>
    one.open.some((identity) => sameFile(identity, file.identity))
  );
}

/**
 * Shows annotation `id`'s place — the card's double-click and Return. In the Annotations window
 * the window holding the document is asked, or, for a file no window holds, the window last in
 * front, which opens it.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.show
 * @upstream-differs the window to show it in is asked across the shell, where upstream calls it
 */
export function showAnnotation(id: string): void {
  if (ownWindowKind() !== "notes") {
    void agentService.annotationTools.show(id, true);
    return;
  }
  const annotation = allAnnotations().find((one) => one.id === id);
  if (annotation === undefined) return;
  const file = annotation.file;
  const workspaceWindows = [...windows.entries()].filter(([, one]) => one.own === undefined);
  const latest = (list: typeof workspaceWindows) =>
    list.sort(([, one], [, other]) => other.focusedAt - one.focusedAt)[0]?.[0];
  const to =
    file.kind === "elsewhere"
      ? file.window
      : file.kind === "disk"
        ? (latest(
            workspaceWindows.filter(([, one]) =>
              one.open.some((identity) => sameFile(identity, file.identity))
            )
          ) ?? latest(workspaceWindows))
        : undefined;
  if (to !== undefined) post({ type: "show", to, id });
}

/** How long a window opened for an annotation waits for the annotation to reach it. */
const HANDED_ANNOTATION_WAIT_MS = 5_000;

/**
 * Goes to annotation `id`'s place in a window opened to show it, once the window holds the
 * annotation: what it has kept is read as it comes up, and what the other windows hold is told to
 * it after that.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.show
 * @upstream-differs the window that opened the file goes to the place there; here the new window
 * is another page, and goes to it itself
 */
export async function showHandedAnnotation(id: string): Promise<void> {
  await restoreAnnotations();
  const here = () => allAnnotations().some((one) => one.id === id);
  if (!here()) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        stop();
        resolve();
      };
      const timer = setTimeout(done, HANDED_ANNOTATION_WAIT_MS);
      const stop = agentAnnotationStore.subscribe(() => {
        if (here()) done();
      });
    });
  }
  await agentService.annotationTools.show(id, true);
}

/**
 * Selects the cards `ids` in the Annotations window and brings it forward — the offset menu's
 * Show Annotation, a step back to the window. In the window itself, the cards are selected there.
 */
export function revealAnnotationCards(ids: readonly string[]): void {
  if (ownWindowKind() === "notes" || desktopOwnWindows() === undefined) {
    showAnnotationCards(ids);
    return;
  }
  desktopOwnWindows()?.open("notes", { cards: ids });
}

/**
 * The Annotations window's own half: the cards another window asked for — by opening it, or
 * asking again — selected once they are here, which a window just opened waits for.
 */
export function startNotesWindow(first: unknown): () => void {
  let stopWaiting: (() => void) | undefined;
  const show = (message: unknown) => {
    const ids = (message as { cards?: unknown } | undefined)?.cards;
    if (!Array.isArray(ids) || ids.length === 0) return;
    const wanted = ids.filter((id): id is string => typeof id === "string");
    stopWaiting?.();
    const here = () => allAnnotations().some((one) => wanted.includes(one.id));
    if (here()) {
      showAnnotationCards(wanted);
      return;
    }
    stopWaiting = agentAnnotationStore.subscribe(() => {
      if (!here()) return;
      stopWaiting?.();
      stopWaiting = undefined;
      showAnnotationCards(wanted);
    });
  };
  show(first);
  const stop = desktopOwnWindows()?.onShow(show);
  return () => {
    stopWaiting?.();
    stop?.();
  };
}
