import type { Bookmark } from "@/core/bookmarks/bookmarkStore";
import { L } from "@/core/localization/localization";
import type { OverlayEdits } from "@/core/storage/editOverlayStorage";
import type { PaneState } from "@/core/workspace/workspace";
import { desktopWindowFocus, windowLaunch } from "@/platform/desktop/desktopWindows";
import type { OpenedFile } from "@/platform/files/openedFile";
import { adoptBookmarks, bookmarksStore } from "@/state/bookmarksStore";
import {
  beginPaneDrag,
  beginPartDrag,
  beginRemotePaneDrag,
  endDrag,
  paneDragStore,
} from "@/state/paneDragStore";
import { isSlot, type PaneId, type PartId, type SlotId } from "@/state/paneId";
import { partsLinkedTo } from "@/state/partUpdate";
import { paneParcel } from "@/state/workspace/workspaceRecorder";
import { adoptMovedPane, adoptMovedUntitled } from "@/state/workspace/workspaceRestorer";
import {
  closePane,
  closePart,
  copyName,
  openKeptUntitledInPane,
  type PaneState as PaneSlot,
  paneState,
  reportAlert,
  setActivePane,
} from "@/state/workspaceStore";

/**
 * A pane carried from one window of the desktop shell to another (`Design/DESKTOP_WINDOWS.md`,
 * D5): dropped on another window's pane, or torn off into a new window.
 *
 * Upstream moves the pane's object; two windows here share no objects, so a pane crosses as what
 * the workspace knows how to write and read back — its record, its file (a `File` and its handle
 * cross between windows of one origin), its unsaved changes, or an untitled document's bytes —
 * over a `BroadcastChannel`, and the window it left closes it only once it has handed it over.
 *
 * The drag itself is announced on the same channel: a browser hides a drag's data from every
 * window until the drop, so the window the pointer reaches learns from the one it left what is in
 * flight, and its bands can say what they would do with it.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.tearOff
 * @upstream-differs the pane crosses as its workspace record, its undo history staying behind
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
  /** The pane itself, let go there: a file's, with its unsaved changes, or an untitled one's bytes. */
  | {
      readonly kind: "pane";
      /** Where the reader was in it; nothing for a fragment panel, whose place is its parent's. */
      readonly pane?: PaneState | undefined;
      readonly file?: OpenedFile | undefined;
      readonly edits?: OverlayEdits | undefined;
      readonly untitled?:
        | { readonly content: Blob; readonly name: string; readonly dirty: boolean }
        | undefined;
      readonly marks: readonly Bookmark[];
    }
  /** A copy of its content, the pane left as it was. */
  | {
      readonly kind: "copy";
      readonly content: Blob;
      readonly name: string;
      readonly marks: readonly Bookmark[];
    }
  /**
   * Kept: parts are open over it there, it is a part holding changes its parent has not got back,
   * or it is gone.
   */
  | {
      readonly kind: "refused";
      readonly reason: "parts" | "unreturned" | "gone" | "unanswered";
    };

/** What a new window is handed by the window it was torn off from. */
export type Handover =
  | { readonly kind: "pane"; readonly from: string; readonly slot: PaneId; readonly copy: boolean }
  | { readonly kind: "files"; readonly from: string; readonly ask: string };

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
    // A pane with parts open over it stays: their way home is this pane.
    if (partsLinkedTo(slot).length > 0) return { kind: "refused", reason: "parts" };
    const parcel = await paneParcel(slot);
    if (parcel === undefined) return { kind: "refused", reason: "gone" };
    // The pane being handed over may be the one this window is dragging: its header goes with it,
    // and a header taken out of the page hears no `dragend`, so the drag ends here.
    if (localDrag === slot) endLocalPaneDrag();
    if (pane.untitled) {
      const content = await contentOf(pane);
      closePane(slot);
      return {
        kind: "pane",
        pane: parcel.pane,
        untitled: { content, name: pane.name, dirty: pane.document.isDirty },
        marks,
      };
    }
    closePane(slot);
    return { kind: "pane", pane: parcel.pane, file: pane.file, edits: parcel.edits, marks };
  },
  marks: () => bookmarksStore.getSnapshot().bookmarks,
};

/**
 * A fragment panel let go: its bytes, as a document of their own, and the panel closed. Its way
 * home stays behind — a link to a parent does not cross between windows, nor survive becoming a
 * pane — so a part holding changes its parent has not got back is kept, for them to be put back
 * first or copied.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.release
 * @upstream-differs the part arrives without its way home, where upstream's keeps it: a pane here
 * is a slot of its window, and Update in Parent is a fragment panel's
 */
async function releasePart(part: PartId, pane: PaneSlot): Promise<TakenPane> {
  if (pane.origin !== undefined && (await pane.origin.hasChanges(pane.document))) {
    return { kind: "refused", reason: "unreturned" };
  }
  const content = await contentOf(pane);
  if (localDrag === part) endLocalPaneDrag();
  closePart(part);
  return { kind: "pane", untitled: { content, name: pane.name, dirty: true }, marks: [] };
}

/**
 * Says why a pane stayed where it was, in the window that asked for it.
 */
export function reportRefusal(taken: TakenPane, name?: string): void {
  if (taken.kind !== "refused") return;
  const title =
    name === undefined ? L("The pane could not be moved") : L("“%1$@” could not be moved", name);
  if (taken.reason === "parts") {
    reportAlert(title, L("Parts are open over it in its window. Close them there first."));
  } else if (taken.reason === "unreturned") {
    reportAlert(
      title,
      L(
        "It holds changes the document it came out of has not got back. Put them back with Update in Parent first, or hold Alt to make a copy."
      )
    );
  }
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
  if (desktopWindowFocus() === undefined || typeof BroadcastChannel === "undefined") {
    return () => {};
  }
  const joined = paneTransferPeer(new BroadcastChannel("byteripper-panes"), thisWindow);
  peer = joined;
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
  return () => {
    stopWatching();
    stopHearing();
    joined.close();
    if (peer === joined) peer = undefined;
  };
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
    openKeptUntitledInPane(slot, taken.content, copyName(taken.name), true);
    setActivePane(slot);
  } else if (taken.kind === "pane") {
    if (taken.untitled !== undefined) {
      const { content, name, dirty } = taken.untitled;
      if (taken.pane === undefined) {
        openKeptUntitledInPane(slot, content, name, dirty);
        setActivePane(slot);
      } else await adoptMovedUntitled(slot, content, name, dirty, taken.pane);
    } else if (taken.file !== undefined && taken.pane !== undefined) {
      await adoptMovedPane(slot, taken.file, taken.pane, taken.edits);
    }
  }
}

/**
 * A new window's launch, torn off from another: the pane it was made for, or the files dropped on
 * that window's New Window strip, taken up with that window's marks — which then go their own way.
 * Answers the files to open, if that is what was handed over.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.tearOffPaneToNewTab
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openFilesInNewTab
 */
export async function receiveHandover(): Promise<readonly OpenedFile[]> {
  const handover = windowLaunch()?.handover as Handover | undefined;
  if (handover === undefined || peer === undefined) return [];
  if (handover.kind === "pane") {
    const taken = await peer.take(handover.from, handover.slot, handover.copy);
    if (taken.kind === "refused") {
      reportRefusal(taken);
      return [];
    }
    adoptBookmarks(taken.marks);
    await adoptTaken("a", taken);
    return [];
  }
  const { files, marks } = await peer.collect(handover.from, handover.ask);
  adoptBookmarks(marks);
  return files;
}
