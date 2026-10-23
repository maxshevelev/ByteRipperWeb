import type {
  HostMessage,
  JoinSource,
  SessionId,
  SessionLine,
  ViewMessage,
} from "@/core/session/sessionProtocol";
import { SessionStorage } from "@/core/session/sessionStorage";
import { SessionClient, type SessionView } from "@/core/session/sessionView";
import type { ByteStorage } from "@/core/storage/byteStorage";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { OpfsKeptFolder } from "@/platform/files/opfsJournalStore";
import { type DocumentSource, sizeOf } from "@/platform/sessions/documentSource";
import { portLine } from "@/platform/sessions/portLine";
import { makeSessionHost } from "@/state/sessions/hostSetup";
import { currentProject } from "@/state/workspace/projectRecords";

/**
 * This window's line to the session host, and the sessions it shows (`Design/FILE_SESSIONS.md`).
 *
 * The host is one `SharedWorker` for every window of the app — the shell's windows, a browser's
 * tabs — so a session is the same object whichever window shows it. Where there is no such worker
 * — the single-file build opened from disk, whose page has no origin; a test — the host runs in the
 * page itself, over a `MessageChannel`, and the page's sessions are its own.
 *
 * @web-only upstream's panes hold their documents
 */

/**
 * The bytes of joins from outside the sessions that are not a `Blob` — what a test hands in — by
 * the number a join names them by; only a host in this page can take them.
 */
const externals = new Map<number, ByteStorage>();
let externalCount = 0;

/** What tells this window's sessions from another's: their ids are chosen here. */
const windowTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Whether the host lives in a `SharedWorker`, rather than in this page. */
let shared = false;

function connect(): SessionLine<ViewMessage, HostMessage> {
  const canShare =
    typeof SharedWorker !== "undefined" &&
    globalThis.origin !== "null" &&
    typeof navigator !== "undefined";
  if (canShare) {
    try {
      const worker = new SharedWorker(
        new URL("../../workers/sessionHost.worker.ts", import.meta.url),
        { type: "module", name: "byteripper-sessions" }
      );
      shared = true;
      holdWhileAlive(worker.port);
      handShellPort(worker.port);
      return portLine<ViewMessage, HostMessage>(worker.port);
    } catch {
      // No worker after all: the host runs here.
    }
  }
  const host = makeSessionHost({
    folderOf: (ref) => {
      if (ref.kind === "session") {
        return OpfsKeptFolder.isAvailable() ? new OpfsKeptFolder(ref.workspace) : undefined;
      }
      const project = currentProject();
      return project?.id === ref.project ? project.folder.kept : undefined;
    },
    removeAllKept: (except) => OpfsKeptFolder.removeAll(except),
    otherExternal: (reference) => {
      const storage = externals.get(reference as number);
      externals.delete(reference as number);
      return storage;
    },
  });
  const channel = new MessageChannel();
  host.connect(portLine<HostMessage, ViewMessage>(channel.port2));
  return portLine<ViewMessage, HostMessage>(channel.port1);
}

/**
 * Holds a Web Lock for as long as this window lives, and tells the host its name once held: the
 * host waits on it, and hears that the window went when the browser lets it go.
 */
function holdWhileAlive(port: MessagePort): void {
  const lock = `byteripper-window:${windowTag}`;
  void navigator.locks?.request(
    lock,
    () =>
      new Promise<void>(() => {
        port.postMessage({ kind: "alive", lock });
      })
  );
}

/**
 * In the shell, a port to the main process for the host's disk: asked of the preload, which hands
 * it to the page as a message, and handed on to the host on this window's line.
 */
function handShellPort(port: MessagePort): void {
  const bridge = (globalThis as { byteripperDesktop?: { askHostPort?: () => void } })
    .byteripperDesktop;
  if (bridge?.askHostPort === undefined || typeof window === "undefined") return;
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window || event.data !== "byteripper:host-port") return;
    const shell = event.ports[0];
    if (shell !== undefined) port.postMessage({ kind: "shellPort", port: shell }, [shell]);
  });
  bridge.askHostPort();
}

const client = new SessionClient(connect());

let opened = 0;

/**
 * Whether this window's sessions are in the host every tab and window shares — what lets a pane go
 * on in another tab. Not where the page runs its host itself: the single-file build, a test.
 */
export function sessionsShared(): boolean {
  return shared;
}

/** Asks the host for something it does on no one session's account — the kept content. */
export function operateHost(name: string, args: unknown): Promise<unknown> {
  return client.operate(name, args);
}

/** Opens a new session from `source` in the host, and shows it here at once. */
export function openSession(source: DocumentSource): SessionView {
  const id: SessionId = `${windowTag}-${++opened}`;
  return client.open(id, source, sizeOf(source));
}

/** What a join names its bytes by: a session's own, a file's, or bytes this page holds. */
export function joinSourceOf(source: ByteStorage): JoinSource {
  if (source instanceof SessionStorage) return { kind: "session", session: source.session };
  if (source instanceof FileBackedStorage && source.byteSource instanceof Blob) {
    return { kind: "external", reference: source.byteSource };
  }
  if (shared) throw new Error("Those bytes cannot reach the session host.");
  const reference = ++externalCount;
  externals.set(reference, source);
  return { kind: "external", reference };
}

const closedListeners = new Set<(session: SessionId) => void>();

/** Hears of every session this window stops showing, for what the page keeps beside one. */
export function onSessionClosed(listener: (session: SessionId) => void): () => void {
  closedListeners.add(listener);
  return () => closedListeners.delete(listener);
}

/** Sessions this window let go to another, which are not to end when it stops showing them. */
const carried = new Set<SessionId>();

/**
 * A session this window hands to another: when its pane goes here, the session does not — the
 * other window shows it next (`Design/FILE_SESSIONS.md`, S8).
 */
export function releaseSession(view: SessionView): void {
  carried.add(view.id);
}

/** Shows here a session another window let go. */
export function showSession(id: SessionId): Promise<SessionView> {
  return client.show(id);
}

/**
 * Hears a session without showing it — a part's parent, here or in another window — until
 * `unwatchSession`. Its view, the same one a pane here shows it through.
 */
export function watchSession(id: SessionId): Promise<SessionView> {
  return client.watch(id);
}

/** Ends one `watchSession`. */
export function unwatchSession(id: SessionId): void {
  client.unwatch(id);
}

/**
 * Whether this window ended `id` itself — stopped showing it with no other window to show it next.
 * Known here at once, where the host's word that the session closed is a round trip away.
 */
export function endedHere(id: SessionId): boolean {
  return ended.has(id);
}
const ended = new Set<SessionId>();

/**
 * Stops showing a session no pane here shows any more. The host ends it once no window shows it —
 * unless it was handed to another window, which shows it next.
 */
export function closeSession(view: SessionView): void {
  client.hide(view.id);
  if (!carried.delete(view.id)) {
    ended.add(view.id);
    void client.operate("session.closeUnshown", { session: view.id });
  }
  for (const listener of closedListeners) listener(view.id);
}
