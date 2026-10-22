import { L } from "@/core/localization/localization";
import type { OverlayEdits } from "@/core/storage/editOverlayStorage";
import type { PaneState } from "@/core/workspace/workspace";
import { desktopWindowFocus } from "@/platform/desktop/desktopWindows";
import type { OpenedFile } from "@/platform/files/openedFile";
import { PANE_IDS, type SlotId } from "@/state/paneId";
import { partsLinkedTo } from "@/state/partUpdate";
import { paneParcel } from "@/state/workspace/workspaceRecorder";
import { adoptMovedPane } from "@/state/workspace/workspaceRestorer";
import { closePane, paneState, reportAlert, setActivePane } from "@/state/workspaceStore";

/**
 * A file is open in one place in the app at a time (`Design/DESKTOP_WINDOWS.md`, D4), across the
 * desktop shell's windows: before opening a file a window asks the others whether one of them has
 * it, and — when the answer is to bring it here — the one that has it hands its pane over, with
 * its place, its segments and its unsaved changes.
 *
 * The windows ask one another over a `BroadcastChannel`, because what names a file is not always
 * a path: a file the system's Open… panel or a drop handed over through a handle has none a page
 * can read, and handles cross between windows of one origin and compare with `isSameEntry` there.
 *
 * Within one window the two panes may hold the same file, as they may in a browser tab: two
 * documents over one file, one edited and compared with the other.
 *
 * @upstream ByteRipperApp/Documents/OpenDocumentRegistry.swift#OpenDocumentRegistry
 * @upstream-differs the windows answer for themselves, asked over a channel, where upstream keeps
 * one registry; across windows only, where upstream refuses a tab's other pane too
 */

/** What names a file between windows: its path, and its handle, whichever it has. */
export interface FileRef {
  readonly path?: string | undefined;
  readonly handle?: FileSystemFileHandle | undefined;
}

/** A pane handed over by the window that had its file open, or why it was not. */
export interface MovedPane {
  /** The pane's workspace record. */
  readonly pane?: PaneState | undefined;
  /** Its unsaved changes. */
  readonly edits?: OverlayEdits | undefined;
  /** Why the pane was not let go: `parts` for one with parts open over it. */
  readonly refused?: "parts" | "unanswered" | undefined;
  /** The file was no longer open there. */
  readonly gone?: boolean | undefined;
}

/** What a window answers for: its own panes. */
export interface OpenOnceWindow {
  /** The pane of this window holding the file, if one does. */
  holding(file: FileRef): Promise<SlotId | undefined>;
  /** Show in Its Window, this window's half: the pane made active, the window brought forward. */
  reveal(slot: SlotId): void;
  /** Move to This Window, this window's half: the pane handed over and let go. */
  release(slot: SlotId): Promise<MovedPane>;
}

/** The part of a `BroadcastChannel` this uses. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

type Message =
  | { readonly kind: "where"; readonly ask: string; readonly file: FileRef }
  | { readonly kind: "here"; readonly ask: string; readonly holder: string }
  | { readonly kind: "show"; readonly ask: string; readonly holder: string; readonly file: FileRef }
  | {
      readonly kind: "release";
      readonly ask: string;
      readonly holder: string;
      readonly file: FileRef;
    }
  | { readonly kind: "released"; readonly ask: string; readonly moved: MovedPane };

/** How long a window waits for another to say it holds the file. */
const WHERE_TIMEOUT_MS = 400;
/** How long it waits for a pane to be handed over. */
const RELEASE_TIMEOUT_MS = 10_000;

const token = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * One window's end of the conversation: it answers for its own panes, and asks the others.
 */
export function openOnceBroker(channel: ChannelLike, own: OpenOnceWindow) {
  const me = token();
  const listener = (event: { data: unknown }) => {
    const message = event.data as Message;
    if (message.kind === "where") {
      void own.holding(message.file).then((slot) => {
        if (slot !== undefined) channel.postMessage({ kind: "here", ask: message.ask, holder: me });
      });
    } else if (message.kind === "show" && message.holder === me) {
      void own.holding(message.file).then((slot) => {
        if (slot !== undefined) own.reveal(slot);
      });
    } else if (message.kind === "release" && message.holder === me) {
      void own.holding(message.file).then(async (slot) => {
        const moved: MovedPane = slot === undefined ? { gone: true } : await own.release(slot);
        channel.postMessage({ kind: "released", ask: message.ask, moved });
      });
    }
  };
  channel.addEventListener("message", listener);

  /** The first answer to `ask` of `kind`, or nothing within `timeout`. */
  function answer<K extends Message["kind"]>(
    kind: K,
    ask: string,
    timeout: number
  ): Promise<Extract<Message, { kind: K }> | undefined> {
    return new Promise((resolve) => {
      const done = (value: Extract<Message, { kind: K }> | undefined) => {
        clearTimeout(timer);
        channel.removeEventListener("message", on);
        resolve(value);
      };
      const on = (event: { data: unknown }) => {
        const message = event.data as Message;
        if (message.kind === kind && message.ask === ask) {
          done(message as Extract<Message, { kind: K }>);
        }
      };
      const timer = setTimeout(() => done(undefined), timeout);
      channel.addEventListener("message", on);
    });
  }

  return {
    /** The window other than this one that holds `file`, by its token, if any. */
    async where(file: FileRef): Promise<string | undefined> {
      const ask = token();
      const reply = answer("here", ask, WHERE_TIMEOUT_MS);
      channel.postMessage({ kind: "where", ask, file });
      return (await reply)?.holder;
    },
    show(holder: string, file: FileRef): void {
      channel.postMessage({ kind: "show", ask: token(), holder, file });
    },
    async move(holder: string, file: FileRef): Promise<MovedPane> {
      const ask = token();
      const reply = answer("released", ask, RELEASE_TIMEOUT_MS);
      channel.postMessage({ kind: "release", ask, holder, file });
      return (await reply)?.moved ?? { refused: "unanswered" };
    },
    close(): void {
      channel.removeEventListener("message", listener);
      channel.close();
    },
  };
}

/** What the person chose when the file was open elsewhere. */
export type OpenElsewhereChoice = "show" | "move" | "cancel";

/** How the question is put to the person: the window's own dialog, which the shell registers. */
export const openOnceHooks: {
  ask: ((name: string) => Promise<OpenElsewhereChoice>) | undefined;
} = { ask: undefined };

/** This window's own panes, as the other windows ask about them. */
const thisWindow: OpenOnceWindow = {
  async holding(file) {
    for (const slot of PANE_IDS) {
      const pane = paneState(slot);
      if (pane === undefined || pane.untitled) continue;
      if (file.path !== undefined && pane.file.path === file.path) return slot;
      const handle = pane.file.handle;
      if (file.handle !== undefined && handle !== undefined) {
        if (await handle.isSameEntry(file.handle).catch(() => false)) return slot;
      }
    }
    return undefined;
  },
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revealOpenFile
  reveal(slot) {
    setActivePane(slot);
    desktopWindowFocus()?.();
  },
  // A pane with parts open over it stays: their way home is this pane. Otherwise it goes without
  // a question — nothing of it is lost, it goes on in the other window.
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.releasePane
  async release(slot) {
    if (partsLinkedTo(slot).length > 0) return { refused: "parts" };
    const parcel = await paneParcel(slot);
    if (parcel === undefined) return { gone: true };
    closePane(slot);
    return parcel;
  },
};

let broker: ReturnType<typeof openOnceBroker> | undefined;

/** Joins the other windows of the desktop shell. Answers the means to leave. */
export function startOpenOnce(): () => void {
  if (desktopWindowFocus() === undefined || typeof BroadcastChannel === "undefined") {
    return () => {};
  }
  broker = openOnceBroker(new BroadcastChannel("byteripper-open-once"), thisWindow);
  return () => {
    broker?.close();
    broker = undefined;
  };
}

/** Stands `stand` in for this window's broker, or with nothing removes it. */
export function installOpenOnceForTesting(stand?: ReturnType<typeof openOnceBroker>): void {
  broker = stand;
}

/**
 * Before `file` opens into `slot`: when another window has it open, the question — show it there,
 * bring it here, or neither. Answers whether the caller is to open it itself: false when it was
 * shown elsewhere, brought here, or cancelled.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.askAboutFileOpenElsewhere
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.movePaneHere
 */
export async function openOnce(slot: SlotId, file: OpenedFile): Promise<boolean> {
  if (broker === undefined) return true;
  const ref: FileRef = { path: file.path, handle: file.handle };
  if (ref.path === undefined && ref.handle === undefined) return true;
  const holder = await broker.where(ref);
  if (holder === undefined) return true;
  const choice = (await openOnceHooks.ask?.(file.name)) ?? "cancel";
  if (choice === "show") {
    broker.show(holder, ref);
    return false;
  }
  if (choice !== "move") return false;
  const moved = await broker.move(holder, ref);
  // Gone from there meanwhile: nothing stands in the way of opening it here.
  if (moved.gone === true) return true;
  if (moved.refused !== undefined || moved.pane === undefined) {
    if (moved.refused === "parts") {
      reportAlert(
        L("“%1$@” could not be moved", file.name),
        L("Parts are open over it in its window. Close them there first.")
      );
    }
    return false;
  }
  await adoptMovedPane(slot, file, moved.pane, moved.edits);
  return false;
}
