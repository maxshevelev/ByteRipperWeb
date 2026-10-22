import type { BinaryDocument } from "@/core/document/binaryDocument";
import type {
  HostMessage,
  JoinSource,
  SessionEvent,
  SessionId,
  SessionLine,
  SessionRequest,
  SessionResult,
  SessionState,
  ViewMessage,
} from "@/core/session/sessionProtocol";
import { operationSpan } from "@/core/session/sessionProtocol";
import type { ByteStorage } from "@/core/storage/byteStorage";

/** A window's line as the host holds it: which sessions it shows, and how far it has been heard. */
interface Connection {
  readonly line: SessionLine<HostMessage, ViewMessage>;
  readonly shown: Set<SessionId>;
  /** The last of this window's requests the host began to apply. */
  acked: number;
}

interface Session {
  readonly document: BinaryDocument;
  /** The tail of the session's requests: each runs once the one before it has settled. */
  queue: Promise<void>;
  readonly stop: () => void;
}

/**
 * Where the file sessions live: every window's line ends here, and a session is the same object
 * whichever window shows it (`Design/FILE_SESSIONS.md`).
 *
 * The host runs in a `SharedWorker`; this class is the part of it that knows nothing of one — it is
 * handed documents and lines, and tested with both in one process. What opens a file into a
 * session, keeps its content and saves it is the platform's, around this.
 *
 * @web-only upstream's windows share one process and hold the documents themselves
 */
export class SessionHost {
  private readonly sessions = new Map<SessionId, Session>();
  private readonly connections = new Set<Connection>();
  /** The bytes of a join from outside the host's sessions: a `File`, a path, by the platform. */
  private readonly external: (reference: unknown) => Promise<ByteStorage>;

  constructor(
    options: { readonly external?: ((reference: unknown) => Promise<ByteStorage>) | undefined } = {}
  ) {
    this.external =
      options.external ?? (() => Promise.reject(new Error("No outside source can be read here.")));
  }

  /** Makes `document` the session `id`. */
  open(id: SessionId, document: BinaryDocument): void {
    if (this.sessions.has(id)) throw new Error(`Session ${id} is already open.`);
    const tell = (event: SessionEvent) => this.tell(id, event);
    const stops = [
      document.onContentChanged((change) =>
        tell({ kind: "content", spans: change.ops.map(operationSpan), restoring: change.restoring })
      ),
      document.onSelectionChanged(() => tell({ kind: "selection" })),
      document.onTransactionCommitted(() => tell({ kind: "committed" })),
    ];
    this.sessions.set(id, {
      document,
      queue: Promise.resolve(),
      stop: () => {
        for (const stop of stops) stop();
      },
    });
  }

  /** Ends the session; every window showing it hears that it is gone. */
  close(id: SessionId): void {
    const session = this.sessions.get(id);
    if (session === undefined) return;
    this.tell(id, { kind: "closed" });
    session.stop();
    this.sessions.delete(id);
    for (const connection of this.connections) connection.shown.delete(id);
  }

  document(id: SessionId): BinaryDocument | undefined {
    return this.sessions.get(id)?.document;
  }

  get sessionIds(): readonly SessionId[] {
    return [...this.sessions.keys()];
  }

  /** The sessions some window shows — what a closing window leaves for the others. */
  shownSessions(): ReadonlySet<SessionId> {
    const shown = new Set<SessionId>();
    for (const connection of this.connections) for (const id of connection.shown) shown.add(id);
    return shown;
  }

  /** Takes a window's line; it is heard from until it is let go. */
  connect(line: SessionLine<HostMessage, ViewMessage>): () => void {
    const connection: Connection = { line, shown: new Set(), acked: 0 };
    this.connections.add(connection);
    line.listen((message) => this.receive(connection, message));
    return () => {
      this.connections.delete(connection);
      line.close();
    };
  }

  private receive(connection: Connection, message: ViewMessage): void {
    switch (message.kind) {
      case "show":
        connection.shown.add(message.session);
        return;
      case "hide":
        connection.shown.delete(message.session);
        return;
      case "request":
        this.enqueue(connection, message.seq, message.session, message.request);
        return;
    }
  }

  private enqueue(
    connection: Connection,
    seq: number,
    id: SessionId,
    request: SessionRequest
  ): void {
    const session = this.sessions.get(id);
    if (session === undefined) {
      connection.line.post({
        kind: "answer",
        seq,
        session: id,
        failure: { name: "SessionClosed", message: `Session ${id} is not open.` },
      });
      return;
    }
    session.queue = session.queue.then(async () => {
      connection.acked = Math.max(connection.acked, seq);
      try {
        const result = await this.apply(session.document, request);
        const transfer = result.kind === "bytes" ? [result.bytes.buffer] : [];
        connection.line.post(
          { kind: "answer", seq, session: id, state: stateOf(session.document), result },
          transfer
        );
      } catch (error) {
        connection.line.post({
          kind: "answer",
          seq,
          session: id,
          state: stateOf(session.document),
          failure: {
            name: error instanceof Error ? error.name : "Error",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });
  }

  private async apply(document: BinaryDocument, request: SessionRequest): Promise<SessionResult> {
    const none: SessionResult = { kind: "none" };
    switch (request.kind) {
      case "state":
        return none;
      case "read":
        return {
          kind: "bytes",
          bytes: (await document.read(request.at, request.length)).slice(),
          generation: document.contentGeneration,
        };
      case "overwrite":
        await document.overwrite(request.at, request.bytes);
        return none;
      case "insert":
        await document.insert(request.at, request.bytes);
        return none;
      case "delete":
        await document.delete(request.start, request.end);
        return none;
      case "fill":
        await document.fill(request.pattern, request.start, request.end, request.caretAfter);
        return none;
      case "replace":
        await document.replace(request.start, request.end, request.bytes);
        return none;
      case "join":
        return {
          kind: "serial",
          serial: await document.join(await this.source(request.source), request.position),
        };
      case "undo": {
        const applied = await document.undo(request.batch);
        return { kind: "applied", spans: applied?.map(operationSpan) };
      }
      case "redo": {
        const applied = await document.redo();
        return { kind: "applied", spans: applied?.map(operationSpan) };
      }
      case "beginEditGroup":
        document.beginEditGroup(request.label);
        return none;
      case "endEditGroup":
        document.endEditGroup();
        return none;
      case "cancelEditGroup":
        await document.cancelEditGroup();
        return none;
      case "beginSeries":
        document.beginSeries(request.id);
        return none;
      case "endSeries":
        document.endSeries();
        return none;
      case "setSelection":
        document.setSelection(request.selection);
        return none;
      case "noteSelectionAfterEdit":
        document.noteSelectionAfterEdit();
        return none;
      case "markSaved":
        document.markSaved();
        return none;
      case "clearKeepingDirty":
        document.undoHistory.clearKeepingDirty();
        return none;
    }
  }

  private async source(source: JoinSource): Promise<ByteStorage> {
    if (source.kind === "external") return this.external(source.reference);
    const document = this.sessions.get(source.session)?.document;
    if (document === undefined) throw new Error(`Session ${source.session} is not open.`);
    return document.storage;
  }

  private tell(id: SessionId, event: SessionEvent): void {
    const document = this.sessions.get(id)?.document;
    if (document === undefined) return;
    const state = stateOf(document);
    for (const connection of this.connections) {
      if (!connection.shown.has(id)) continue;
      connection.line.post({ kind: "event", session: id, event, state, acked: connection.acked });
    }
  }
}

/** @web-only see {@link SessionHost} */
export function stateOf(document: BinaryDocument): SessionState {
  const history = document.undoHistory;
  return {
    size: document.size,
    dirty: document.isDirty,
    canUndo: document.canUndo,
    canRedo: document.canRedo,
    undoLabel: history.undoLabel,
    redoLabel: history.redoLabel,
    selection: document.selection,
    contentGeneration: document.contentGeneration,
    lastCommittedSerial: history.lastCommittedSerial,
  };
}
