import type { Bookmark } from "@/core/bookmarks/bookmarkStore";
import type { PartCodec } from "@/core/parts/partCodec";
import type { SessionId } from "@/core/session/sessionProtocol";
import type { PaneState } from "@/core/workspace/workspace";
import { desktopWindowFocus, windowLaunch } from "@/platform/desktop/desktopWindows";
import type { OpenedFile } from "@/platform/files/openedFile";
import { adoptBookmarks, bookmarksStore } from "@/state/bookmarksStore";
import { type CarriedOrigin, DocumentOrigin } from "@/state/documentOrigin";
import {
  beginPaneDrag,
  beginPartDrag,
  beginRemotePaneDrag,
  endDrag,
  paneDragStore,
} from "@/state/paneDragStore";
import { isSlot, type PaneId, type PartId, type SlotId } from "@/state/paneId";
import { adoptSources, type CarriedSources, carriedSources } from "@/state/segmentSources";
import { releaseSession, sessionsShared, showSession } from "@/state/sessions/pageSessions";
import { startParentLinks } from "@/state/workspace/parentLinks";
import { codecOf, type PartCodecState, partCodecState } from "@/state/workspace/partCodecState";
import { paneRecord } from "@/state/workspace/workspaceRecorder";
import { adoptMovedSession } from "@/state/workspace/workspaceRestorer";
import {
  closePane,
  closePart,
  copyName,
  openKeptUntitledInPane,
  type PaneState as PaneSlot,
  paneState,
  setActivePane,
} from "@/state/workspaceStore";

/**
 * A pane carried from one window of the desktop shell to another (`Design/DESKTOP_WINDOWS.md`,
 * D5): dropped on another window's pane, or torn off into a new window.
 *
 * Upstream moves the pane's object. Here the document is the session host's, which every window
 * reaches (`Design/FILE_SESSIONS.md`, S8), so a pane crosses as the name of its session and the
 * pane's own record around it — its file, where the reader was — over a `BroadcastChannel`, and
 * the window it left lets the pane go once it has handed it over; the session stays.
 *
 * The drag itself is announced on the same channel: a browser hides a drag's data from every
 * window until the drop, so the window the pointer reaches learns from the one it left what is in
 * flight, and its bands can say what they would do with it.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.tearOff
 * @upstream-differs the pane crosses as its session's name and its record; the window it reaches
 * shows the session itself
 */

/** A pane in flight from another window, as that window announced it. */
export interface RemotePane {
  /** The window it is in. */
  readonly from: string;
  /** One of its two panes, or one of its fragment panels (D6). */
  readonly slot: PaneId;
  readonly name: string;
  readonly size: number;
}

/** What a window hands over of one of its panes. */
export type TakenPane =
  /**
   * The pane itself, let go there: its session, which every window reaches in the session host
   * (`Design/FILE_SESSIONS.md`, S8) — the document, its changes, its history and its cuts are not
   * carried, only named — and the pane's own record around it.
   */
  | {
      readonly kind: "pane";
      readonly session: SessionId;
      /** Where the reader was in it; nothing for a fragment panel, whose place is its parent's. */
      readonly pane?: PaneState | undefined;
      readonly name: string;
      readonly file: OpenedFile;
      readonly untitled: boolean;
      readonly writable: boolean;
      /** Whether its file holds what it was last saved as — nothing does for a joined image. */
      readonly saved: boolean;
      /** The files its pieces' links name, under the ids the session's partition knows them by. */
      readonly sources: CarriedSources;
      readonly marks: readonly Bookmark[];
      /** A part's way home, which goes where the part goes. */
      readonly origin?:
        | {
            readonly link: CarriedOrigin;
            /** Its codec in words; nothing for one only this window can make again. */
            readonly codec: PartCodecState | undefined;
          }
        | undefined;
    }
  /** A copy of its content, the pane left as it was. */
  | {
      readonly kind: "copy";
      readonly content: Blob;
      readonly name: string;
      readonly marks: readonly Bookmark[];
    }
  /** Kept: it is gone, or the window holding it did not answer. */
  | {
      readonly kind: "refused";
      readonly reason: "gone" | "unanswered";
    };

/** What a new window is handed by the window it was torn off from. */
export type Handover =
  | { readonly kind: "pane"; readonly from: string; readonly slot: PaneId; readonly copy: boolean }
  | {
      readonly kind: "files";
      readonly from: string;
      readonly ask: string;
      /** The annotation whose place the files were opened to show, gone to once they are open. */
      readonly annotation?: string | undefined;
    };

type Message =
  | { readonly kind: "drag"; readonly pane: RemotePane }
  | { readonly kind: "drag-end"; readonly from: string }
  | {
      readonly kind: "take";
      readonly ask: string;
      readonly holder: string;
      readonly slot: PaneId;
      readonly copy: boolean;
    }
  | { readonly kind: "taken"; readonly ask: string; readonly taken: TakenPane }
  | { readonly kind: "collect"; readonly ask: string; readonly holder: string }
  | {
      readonly kind: "collected";
      readonly ask: string;
      readonly files: readonly OpenedFile[];
      readonly marks: readonly Bookmark[];
    };

/** The part of a `BroadcastChannel` this uses. */
export interface PaneChannel {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

/** What a window answers for: its own panes. */
export interface PaneHolder {
  take(pane: PaneId, copy: boolean): Promise<TakenPane>;
  /** The marks a pane or files carried to a new window bring with them. */
  marks(): readonly Bookmark[];
}

/** How long a window waits for another to hand a pane over. */
const TAKE_TIMEOUT_MS = 15_000;

const token = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * One window's end of the conversation: it announces its own drags, hears the others', hands its
 * panes over when asked, and asks for theirs.
 */
export function paneTransferPeer(channel: PaneChannel, holder: PaneHolder) {
  const me = token();
  let remote: RemotePane | undefined;
  const offered = new Map<string, readonly OpenedFile[]>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };

  const listener = (event: { data: unknown }) => {
    const message = event.data as Message;
    switch (message.kind) {
      case "drag":
        remote = message.pane;
        changed();
        return;
      case "drag-end":
        if (remote?.from === message.from) {
          remote = undefined;
          changed();
        }
        return;
      case "take":
        if (message.holder !== me) return;
        void holder
          .take(message.slot, message.copy)
          .catch((): TakenPane => ({ kind: "refused", reason: "gone" }))
          .then((taken) => channel.postMessage({ kind: "taken", ask: message.ask, taken }));
        return;
      case "collect": {
        if (message.holder !== me) return;
        const files = offered.get(message.ask) ?? [];
        offered.delete(message.ask);
        channel.postMessage({
          kind: "collected",
          ask: message.ask,
          files,
          marks: holder.marks(),
        });
        return;
      }
      default:
        return;
    }
  };
  channel.addEventListener("message", listener);

  function answer<K extends Message["kind"]>(
    kind: K,
    ask: string
  ): Promise<Extract<Message, { kind: K }> | undefined> {
    return new Promise((resolve) => {
      const done = (value: Extract<Message, { kind: K }> | undefined) => {
        clearTimeout(timer);
        channel.removeEventListener("message", on);
        resolve(value);
      };
      const on = (event: { data: unknown }) => {
        const message = event.data as Message;
        if (message.kind === kind && "ask" in message && message.ask === ask) {
          done(message as Extract<Message, { kind: K }>);
        }
      };
      const timer = setTimeout(() => done(undefined), TAKE_TIMEOUT_MS);
      channel.addEventListener("message", on);
    });
  }

  return {
    me,
    /** The pane another window has in flight, if one has announced one. */
    remote: () => remote,
    /** Hears a drag elsewhere begin or end. Answers the means to stop. */
    onRemoteChange(callback: () => void): () => void {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    /** A pane of this window picked up: the others are told what is in flight. */
    announce(pane: Omit<RemotePane, "from">): void {
      channel.postMessage({ kind: "drag", pane: { ...pane, from: me } });
    },
    announceEnd(): void {
      channel.postMessage({ kind: "drag-end", from: me });
    },
    /** Asks `from` for its pane in `slot`: the pane itself, or with `copy` a copy of its content. */
    async take(from: string, slot: PaneId, copy: boolean): Promise<TakenPane> {
      const ask = token();
      const reply = answer("taken", ask);
      channel.postMessage({ kind: "take", ask, holder: from, slot, copy });
      return (await reply)?.taken ?? { kind: "refused", reason: "unanswered" };
    },
    /** Files dropped on the New Window strip, kept for the new window to collect. */
    offerFiles(files: readonly OpenedFile[]): string {
      const ask = token();
      offered.set(ask, files);
      return ask;
    },
    /** Files offered for a window that never came — a tab the browser would not open. */
    withdrawFiles(ask: string): void {
      offered.delete(ask);
    },
    async collect(from: string, ask: string) {
      const reply = answer("collected", ask);
      channel.postMessage({ kind: "collect", ask, holder: from });
      return (await reply) ?? { files: [] as readonly OpenedFile[], marks: [] as Bookmark[] };
    },
    close(): void {
      channel.removeEventListener("message", listener);
      channel.close();
    },
  };
}

/** The content of a pane, as another window can read it once this one has let it go. */
async function contentOf(pane: PaneSlot): Promise<Blob> {
  // A file read as it is on disk is the file itself; anything else is read out whole, since a
  // snapshot in this page's private storage is swept with this page.
  if (!pane.untitled && !pane.document.isDirty && pane.file.source instanceof Blob) {
    return pane.file.source;
  }
  const bytes = await pane.document.storage.read(0, pane.document.size);
  return new Blob([bytes.slice()]);
}

/** This window's own panes, as the other windows — or a drop in this one — ask for them. */
export const thisWindow: PaneHolder = {
  /**
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.releasePane
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.copyPane
   * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.release
   */
  async take(slot, copy) {
    const pane = paneState(slot);
    if (pane === undefined) return { kind: "refused", reason: "gone" };
    const marks = isSlot(slot) ? bookmarksStore.getSnapshot().bookmarks : [];
    if (copy) return { kind: "copy", content: await contentOf(pane), name: pane.name, marks };
    if (!isSlot(slot)) return releasePart(slot, pane);
    // A pane with parts open over it goes as any other: their way home is its session, which
    // they find wherever it is shown.
    const record = await paneRecord(slot);
    if (record === undefined) return { kind: "refused", reason: "gone" };
    // The pane being handed over may be the one this window is dragging: its header goes with it,
    // and a header taken out of the page hears no `dragend`, so the drag ends here.
    if (localDrag === slot) endLocalPaneDrag();
    const taken = released(slot, pane, record, marks);
    closePane(slot);
    return taken;
  },
  marks: () => bookmarksStore.getSnapshot().bookmarks,
};

/**
 * A fragment panel let go: its document, and its way home with it — the link names the parent's
 * session, which the window it reaches finds wherever it is shown — and the panel closed.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.release
 * @upstream-differs the link crosses as a record, its parent by its session's name, where
 * upstream's pane carries its origin object along
 */
function releasePart(part: PartId, pane: PaneSlot): TakenPane {
  const origin = pane.origin;
  if (localDrag === part) endLocalPaneDrag();
  const taken = released(part, { ...pane, untitled: true, writable: false }, undefined, []);
  closePart(part);
  if (origin === undefined || taken.kind !== "pane") return taken;
  // A part let go on a pane of this same window takes its codec as it is.
  leavingCodecs.set(pane.document.id, origin.codec);
  return {
    ...taken,
    origin: { link: origin.carry(), codec: partCodecState(origin.codec) },
  };
}

/** The codecs of the parts this window has let go, by session, for a pane here that takes one. */
const leavingCodecs = new Map<SessionId, PartCodec>();

/** A pane let go: its session named, and handed over so that its going here does not end it. */
function released(
  slot: PaneId,
  pane: PaneSlot,
  record: PaneState | undefined,
  marks: readonly Bookmark[]
): TakenPane {
  releaseSession(pane.document);
  return {
    kind: "pane",
    session: pane.document.id,
    ...(record === undefined ? {} : { pane: record }),
    name: pane.name,
    file: pane.file,
    untitled: pane.untitled,
    writable: pane.writable,
    saved: pane.saved !== undefined,
    sources: carriedSources(slot),
    marks,
  };
}

let peer: ReturnType<typeof paneTransferPeer> | undefined;

/** This window's peer, in the desktop shell. */
export const panePeer = () => peer;

/** Stands `stand` in for this window's peer, or with nothing removes it. */
export function installPanePeerForTesting(stand?: ReturnType<typeof paneTransferPeer>): void {
  peer = stand;
}

/**
 * Joins the other windows of the desktop shell, and follows a drag that comes in from one of them.
 * Answers the means to leave.
 */
export function startPaneTransfer(): () => void {
  // The shell's windows, or the browser's tabs where they share the session host: a pane crosses
  // as its session's name, so there is nothing to carry it between pages that do not.
  const joins = desktopWindowFocus() !== undefined || sessionsShared();
  if (!joins || typeof BroadcastChannel === "undefined") return () => {};
  // One membership for the page, however often a component starts and stops it: a stop followed
  // at once by a start — React's development mount does exactly that — keeps it, and with it an
  // answer still on its way, such as the pane a new tab asked for as it came up.
  if (membership !== undefined) {
    clearTimeout(membership.leaving);
    membership.leaving = undefined;
    membership.starts++;
    return () => leaveSoon();
  }
  const joined = paneTransferPeer(new BroadcastChannel("byteripper-panes"), thisWindow);
  peer = joined;
  // The parts linked across windows are heard on a line of their own.
  const leaveLinks = startParentLinks();
  // A pane of this window picked up: the other windows are told, until the header's own `dragend`
  // says it is over (`endLocalPaneDrag`).
  const stopWatching = paneDragStore.subscribe(() => {
    const { inFlight, paneId, partId, remote } = paneDragStore.getSnapshot();
    const dragged = paneId ?? partId;
    if (inFlight !== "pane" || dragged === undefined || remote !== undefined) return;
    if (localDrag !== undefined) return;
    const pane = paneState(dragged);
    if (pane === undefined) return;
    localDrag = dragged;
    joined.announce({ slot: dragged, name: pane.name, size: pane.document.size });
  });
  // A drag from another window over: its bands here come down with it.
  const stopHearing = joined.onRemoteChange(() => {
    if (joined.remote() === undefined && paneDragStore.getSnapshot().remote !== undefined) {
      endDrag();
    }
  });
  membership = {
    starts: 1,
    leaving: undefined,
    leave: () => {
      leaveLinks();
      stopWatching();
      stopHearing();
      joined.close();
      if (peer === joined) peer = undefined;
    },
  };
  return () => leaveSoon();
}

/** This page's membership of the windows' conversation, while it has one. */
let membership:
  | {
      starts: number;
      leaving: ReturnType<typeof setTimeout> | undefined;
      readonly leave: () => void;
    }
  | undefined;

/** Leaves once nothing has started the membership again by the next task. */
function leaveSoon(): void {
  const held = membership;
  if (held === undefined) return;
  held.starts--;
  if (held.starts > 0) return;
  held.leaving = setTimeout(() => {
    if (membership !== held || held.starts > 0) return;
    membership = undefined;
    held.leave();
  });
}

/** The pane of this window being dragged, from pick-up to the source's own `dragend`. */
let localDrag: PaneId | undefined;

/**
 * The source's own `dragend`: the drag is over everywhere, whichever window it ended in.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.draggingEnded
 */
export function endLocalPaneDrag(): void {
  endDrag();
  if (localDrag === undefined) return;
  localDrag = undefined;
  peer?.announceEnd();
}

/**
 * A pane drag over this window that its own store does not know about: one of this window's own
 * panes coming back after leaving it, or one from another window. Answers whether it is either.
 */
export function followPaneDrag(): boolean {
  if (paneDragStore.getSnapshot().inFlight !== undefined) return true;
  if (localDrag !== undefined) {
    if (isSlot(localDrag)) beginPaneDrag(localDrag);
    else beginPartDrag(localDrag);
    return true;
  }
  const remote = peer?.remote();
  if (remote === undefined) return false;
  beginRemotePaneDrag(remote);
  return true;
}

/**
 * The pane `from` had in `slot`, brought into this window's `slot`: moved, or with `copy` copied
 * as a document never saved. Answers whether it arrived.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.movePaneHere
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.copyPane
 */
export async function bringPane(
  from: string | undefined,
  fromSlot: PaneId,
  into: SlotId,
  copy: boolean
): Promise<TakenPane> {
  // Nothing to ask across: a fragment panel of this very window let go on one of its panes.
  const taken = (from === undefined
    ? await thisWindow.take(fromSlot, copy)
    : await peer?.take(from, fromSlot, copy)) ?? {
    kind: "refused" as const,
    reason: "unanswered" as const,
  };
  await adoptTaken(into, taken);
  return taken;
}

/** What `taken` holds, put into `slot`. */
export async function adoptTaken(slot: SlotId, taken: TakenPane): Promise<void> {
  if (taken.kind === "copy") {
    await openKeptUntitledInPane(slot, taken.content, copyName(taken.name), true);
    setActivePane(slot);
  } else if (taken.kind === "pane") {
    const view = await showSession(taken.session);
    const carried = taken.origin;
    const live = leavingCodecs.get(taken.session);
    leavingCodecs.delete(taken.session);
    const codec =
      live ??
      (carried?.codec === undefined
        ? undefined
        : codecOf(carried.codec, { session: carried.link.session }));
    const origin =
      carried === undefined || codec === undefined
        ? undefined
        : await DocumentOrigin.carried({ ...carried.link, codec });
    await adoptMovedSession(
      slot,
      view,
      {
        name: taken.name,
        file: taken.file,
        untitled: taken.untitled,
        writable: taken.writable,
        saved: taken.saved,
        origin,
      },
      taken.pane
    );
    adoptSources(slot, taken.sources);
  }
}

/** What a new window was handed: files to open, and the annotation to go to once they are. */
export interface Handed {
  readonly files: readonly OpenedFile[];
  readonly annotation?: string | undefined;
}

/**
 * A new window's launch, torn off from another: the pane it was made for, or the files dropped on
 * that window's New Window strip — or opened to show an annotation's place — taken up with that
 * window's marks, which then go their own way. Answers the files to open, if that is what was
 * handed over, and the annotation to go to once they are.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.tearOffPaneToNewTab
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openFilesInNewTab
 */
export async function receiveHandover(): Promise<Handed> {
  const handover = (windowLaunch()?.handover as Handover | undefined) ?? tabHandover();
  if (handover === undefined || peer === undefined) return { files: [] };
  if (handover.kind === "pane") {
    const taken = await peer.take(handover.from, handover.slot, handover.copy);
    if (taken.kind === "refused") return { files: [] };
    adoptBookmarks(taken.marks);
    await adoptTaken("a", taken);
    return { files: [] };
  }
  const { files, marks } = await peer.collect(handover.from, handover.ask);
  adoptBookmarks(marks);
  return { files, annotation: handover.annotation };
}

/** The address fragment a tab opened for a pane carries its handover in. */
const HANDOVER_KEY = "handover";

/**
 * Opens a new browser tab that takes up `slot` of this one — a pane, or a fragment panel — as the
 * shell's Open in New Window does with a window. The tab is opened while the click that asked for
 * it is still going on, which is the one moment a browser lets a page open one; it then asks for
 * the pane itself.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openPaneInNewTab
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.tearOffFragment
 * @upstream-differs a tab of the browser, which the page opens and the pane goes on in
 */
export function paneToNewTab(slot: PaneId): void {
  if (peer === undefined) return;
  const handover: Handover = { kind: "pane", from: peer.me, slot, copy: false };
  const url = new URL(location.href);
  url.hash = handoverHash(handover);
  window.open(url.href, "_blank", "noopener");
}

/**
 * Opens a new browser tab that opens `files` — with `annotation`, goes to its place — as the
 * shell's new window does for files handed to it. False when the browser would not open one: a
 * tab is opened only while a click is going on, and a click answered long after is not.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.openInNewTab
 * @upstream-differs a tab of the browser, which collects the files from this one as it comes up
 */
export function filesToNewTab(files: readonly OpenedFile[], annotation?: string): boolean {
  if (peer === undefined) return false;
  const ask = peer.offerFiles(files);
  const handover: Handover = { kind: "files", from: peer.me, ask, annotation };
  const url = new URL(location.href);
  url.hash = handoverHash(handover);
  const tab = window.open(url.href, "_blank");
  if (tab === null) {
    peer.withdrawFiles(ask);
    return false;
  }
  tab.opener = null;
  return true;
}

/** The handover this tab was opened with, if it was opened for a pane; the address forgets it. */
function tabHandover(): Handover | undefined {
  if (typeof location === "undefined") return undefined;
  const handover = handoverOfHash(location.hash);
  if (handover !== undefined) history.replaceState(null, "", location.pathname + location.search);
  return handover;
}

/** A pane's handover as an address fragment. */
export function handoverHash(handover: Handover): string {
  return `#${HANDOVER_KEY}=${encodeURIComponent(JSON.stringify(handover))}`;
}

/** The handover an address fragment carries — a pane, or files — or nothing for anything else. */
export function handoverOfHash(hash: string): Handover | undefined {
  const match = new RegExp(`^#${HANDOVER_KEY}=(.+)$`).exec(hash);
  if (match === null) return undefined;
  try {
    const handover = JSON.parse(decodeURIComponent(match[1] ?? "")) as {
      [key: string]: unknown;
    };
    if (typeof handover.from !== "string") return undefined;
    if (handover.kind === "pane") {
      return typeof handover.slot === "string" && typeof handover.copy === "boolean"
        ? (handover as unknown as Handover)
        : undefined;
    }
    return handover.kind === "files" &&
      typeof handover.ask === "string" &&
      (handover.annotation === undefined || typeof handover.annotation === "string")
      ? (handover as unknown as Handover)
      : undefined;
  } catch {
    return undefined;
  }
}
