import { BinaryDocument } from "@/core/document/binaryDocument";
import { SessionHost, type SessionParts, stateOf } from "@/core/session/sessionHost";
import type {
  HostMessage,
  JoinSource,
  SessionId,
  ViewMessage,
} from "@/core/session/sessionProtocol";
import { SessionStorage } from "@/core/session/sessionStorage";
import { SessionClient, type SessionView } from "@/core/session/sessionView";
import type { ByteSource, ByteStorage, EditableByteStorage } from "@/core/storage/byteStorage";
import type { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import type { ScratchStore } from "@/core/storage/scratchStore";
import { portLine } from "@/platform/sessions/portLine";

/**
 * The file sessions of this window, and the host they live in (`Design/FILE_SESSIONS.md`, S2).
 *
 * The host runs in the page for now, over a `MessageChannel`, so that everything the panes do with
 * their documents already goes through a `SessionView` — requests, answers, the mirror — before
 * the host moves to a `SharedWorker` (S7) and a second window can show the same session.
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
const client = new SessionClient(portLine<ViewMessage, HostMessage>(channel.port1));

let opened = 0;

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

/**
 * Works on the document behind a session in its turn among the window's requests, the windows told
 * how it stands after: what the page still does to a document itself — laying kept changes over
 * it, putting a history back, reverting — until each moves into the host (S3–S6).
 *
 * @web-only see the module's comment
 */
export function onHostDocument<T>(
  view: SessionView,
  work: (document: BinaryDocument) => T | Promise<T>
): Promise<T> {
  return onHostSession(view, (session) => work(session.document));
}

/**
 * The same over the whole session — its cuts and the order of its acts with the document: what
 * the workspace's record puts back.
 *
 * @web-only see the module's comment
 */
export function onHostSession<T>(
  view: SessionView,
  work: (session: SessionParts) => T | Promise<T>
): Promise<T> {
  // Settled once this window has heard how the session stands after it, as an edit is.
  return host.run(view.id, work).then(async (done) => {
    await view.settled();
    return done;
  });
}

/** The session's content as it stands, written once to `scratch`: what a worker or a join reads. */
export function contentSnapshot(view: SessionView, scratch: ScratchStore): Promise<ByteSource> {
  return onHostDocument(view, (document) =>
    (document.storage as EditOverlayStorage).contentSnapshot(scratch)
  );
}

/**
 * The document behind a session, for the page code that still works on it directly — saving,
 * reverting, the kept content, the cut history, the undo router — until each moves into the host
 * (S3–S6). Every caller is one more thing the move to a `SharedWorker` has to take along: none may
 * be added.
 *
 * @web-only see the module's comment
 */
export function hostDocument(view: SessionView): BinaryDocument {
  return hostSession(view).document;
}

/** The session behind a view, for what the workspace writes down of its cuts and acts. */
export function hostSession(view: SessionView): SessionParts {
  const session = host.session(view.id);
  if (session === undefined) throw new Error(`Session ${view.id} is not open.`);
  return session;
}
