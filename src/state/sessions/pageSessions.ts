import { BinaryDocument } from "@/core/document/binaryDocument";
import { SessionHost, stateOf } from "@/core/session/sessionHost";
import type {
  HostMessage,
  JoinSource,
  SessionId,
  ViewMessage,
} from "@/core/session/sessionProtocol";
import { SessionStorage } from "@/core/session/sessionStorage";
import { SessionClient, type SessionView } from "@/core/session/sessionView";
import type { ByteStorage, EditableByteStorage } from "@/core/storage/byteStorage";
import { OpfsKeptFolder } from "@/platform/files/opfsJournalStore";
import { portLine } from "@/platform/sessions/portLine";
import { installSessionOperations } from "@/platform/sessions/sessionOperations";
import { installKeeperOperations } from "@/state/sessions/keeperOperations";
import { currentProject } from "@/state/workspace/projectRecords";

/**
 * The file sessions of this window, and the host they live in (`Design/FILE_SESSIONS.md`).
 *
 * The host runs in the page for now, over a `MessageChannel`, so that everything the panes do with
 * their documents already goes through a `SessionView` — requests, operations, the mirror —
 * before the host moves to a `SharedWorker` (S7) and a second window can show the same session.
 * Nothing in the page reaches the host's documents but through the line.
 *
 * @web-only upstream's panes hold their documents
 */

/**
 * The bytes of joins from outside the sessions — a file picked or dropped — by the number a join
 * names them by. A storage does not cross a port, and the host shares this page's realm for now,
 * so it takes them from here; in a `SharedWorker` a join will name the `File` itself (S7).
 */
const externals = new Map<number, ByteStorage>();
let externalCount = 0;

const host = new SessionHost({
  external: async (reference) => {
    const storage = externals.get(reference as number);
    externals.delete(reference as number);
    if (storage === undefined) throw new Error("The bytes to join are gone.");
    return storage;
  },
});
const channel = new MessageChannel();
host.connect(portLine<HostMessage, ViewMessage>(channel.port2));
installSessionOperations(host);
installKeeperOperations(host, (ref) => {
  if (ref.kind === "session") {
    return OpfsKeptFolder.isAvailable() ? new OpfsKeptFolder(ref.workspace) : undefined;
  }
  const project = currentProject();
  return project?.id === ref.project ? project.folder.kept : undefined;
});
const client = new SessionClient(portLine<ViewMessage, HostMessage>(channel.port1));

let opened = 0;

/** Asks the host for something it does on no one session's account — the kept content. */
export function operateHost(name: string, args: unknown): Promise<unknown> {
  return client.operate(name, args);
}

/** Opens `storage` as a new session and shows it here. */
export function openSession(storage: EditableByteStorage): SessionView {
  const id: SessionId = `s${++opened}`;
  const document = new BinaryDocument(storage);
  host.open(id, document);
  const parts = host.session(id);
  if (parts === undefined) throw new Error(`Session ${id} did not open.`);
  return client.adopt(id, stateOf(parts));
}

/** What a join names its bytes by: a session's own, or bytes from outside them. */
export function joinSourceOf(source: ByteStorage): JoinSource {
  return source instanceof SessionStorage
    ? { kind: "session", session: source.session }
    : { kind: "external", reference: externalOf(source) };
}

function externalOf(source: ByteStorage): number {
  const reference = ++externalCount;
  externals.set(reference, source);
  return reference;
}

const closedListeners = new Set<(session: SessionId) => void>();

/** Hears of every session this window ends, for what the page keeps beside one. */
export function onSessionClosed(listener: (session: SessionId) => void): () => void {
  closedListeners.add(listener);
  return () => closedListeners.delete(listener);
}

/** Ends a session no pane shows any more. */
export function closeSession(view: SessionView): void {
  client.hide(view.id);
  host.close(view.id);
  for (const listener of closedListeners) listener(view.id);
}
