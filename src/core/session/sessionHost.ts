import type { DiffEdit } from "@/core/diff/diffEngine";
import { BinaryDocument } from "@/core/document/binaryDocument";
import { caretAt } from "@/core/document/selectionModel";
import type { UndoOperation } from "@/core/edit/undoHistory";
import { SessionActs } from "@/core/session/sessionActs";
import { CutHistory, partitionData, partitionFrom } from "@/core/session/sessionCuts";
import type {
  HostMessage,
  JoinSource,
  OperationSpan,
  SessionEvent,
  SessionFailure,
  SessionId,
  SessionLine,
  SessionRequest,
  SessionResult,
  SessionState,
  ViewMessage,
} from "@/core/session/sessionProtocol";
import { operationSpan } from "@/core/session/sessionProtocol";
import type { ByteStorage, EditableByteStorage } from "@/core/storage/byteStorage";

/** A window's line as the host holds it: which sessions it shows, and how far it has been heard. */
interface Connection {
  readonly line: SessionLine<HostMessage, ViewMessage>;
  readonly shown: Set<SessionId>;
  /** The sessions it hears without showing them: a part's parent shown in another window. */
  readonly watched: Set<SessionId>;
  /** The last of this window's requests the host began to apply. */
  acked: number;
}

/**
 * What a session is made of: the document, the partition its cuts make and their history, and the
 * order of its acts across the two.
 *
 * @web-only see {@link SessionHost}
 */
export interface SessionParts {
  readonly id: SessionId;
  /** What an agent calls it, once a window has named it. */
  agentId?: string | undefined;
  readonly document: BinaryDocument;
  readonly cuts: CutHistory;
  readonly acts: SessionActs;
}

interface Session extends SessionParts {
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
  /**
   * Everything the host says, in the order it happened: an edit's news reaches a window before the
   * edit's answer even when the news waits for its bytes to be read out of the journal.
   */
  private outbox: Promise<void> = Promise.resolve();
  private readonly sessionOperations = new Map<string, SessionOperation>();
  private readonly hostOperations = new Map<string, HostOperation>();
  /** The bytes of a join from outside the host's sessions: a `File`, a path, by the platform. */
  private readonly external: (reference: unknown) => Promise<ByteStorage>;
  /** The storage a window's `open` names, made by the platform: a file's overlay, an empty one. */
  private readonly storage: (source: unknown) => EditableByteStorage;

  constructor(
    options: {
      readonly external?: ((reference: unknown) => Promise<ByteStorage>) | undefined;
      readonly storage?: ((source: unknown) => EditableByteStorage) | undefined;
    } = {}
  ) {
    this.external =
      options.external ?? (() => Promise.reject(new Error("No outside source can be read here.")));
    this.storage =
      options.storage ??
      (() => {
        throw new Error("No document can be opened from a window here.");
      });
  }

  /**
   * Teaches the host something the platform does to a session in its turn: a save written, a
   * history put back. `operation` is handed the session and the request's data, and answers plain
   * data.
   */
  defineSessionOperation(name: string, operation: SessionOperation): void {
    this.sessionOperations.set(name, operation);
  }

  /** Teaches the host something it does on no one session's account. */
  defineHostOperation(name: string, operation: HostOperation): void {
    this.hostOperations.set(name, operation);
  }

  /** Makes `document` the session `id`. */
  open(id: SessionId, document: BinaryDocument): void {
    if (this.sessions.has(id)) throw new Error(`Session ${id} is already open.`);
    const tell = (event: SessionEvent) => this.tell(id, event);
    const cuts = new CutHistory(document.size);
    const acts = new SessionActs(document, cuts);
    const stops = [
      document.onContentChanged((change) => {
        moveCuts(cuts, change.ops, document.size);
        this.tellContent(id, change.ops, change.restoring);
      }),
      document.onSelectionChanged(() => tell({ kind: "selection" })),
      document.onTransactionCommitted(() => {
        acts.noteDocument();
        tell({ kind: "committed" });
      }),
    ];
    this.sessions.set(id, {
      id,
      document,
      cuts,
      acts,
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
    for (const connection of this.connections) {
      connection.shown.delete(id);
      connection.watched.delete(id);
    }
  }

  /**
   * Runs `work` on a session's document in its turn — after every request already sent, before
   * any sent later — and tells the windows how the session stands after it. For what the host
   * does to a session on its own account: a kept history put back, a save's checkpoint.
   */
  run<T>(id: SessionId, work: (session: SessionParts) => T | Promise<T>): Promise<T> {
    const session = this.sessions.get(id);
    if (session === undefined) return Promise.reject(new Error(`Session ${id} is not open.`));
    const done = session.queue.then(() => work(session));
    session.queue = done.then(
      () => this.tell(id, { kind: "state" }),
      () => this.tell(id, { kind: "state" })
    );
    return done;
  }

  /** Ends every session no window shows: what a window that went leaves behind. */
  closeUnshown(): void {
    const shown = this.shownSessions();
    for (const id of [...this.sessions.keys()]) if (!shown.has(id)) this.close(id);
  }

  document(id: SessionId): BinaryDocument | undefined {
    return this.sessions.get(id)?.document;
  }

  /** The session's parts, for the platform code around the host that reads them. */
  session(id: SessionId): SessionParts | undefined {
    return this.sessions.get(id);
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
    const connection: Connection = { line, shown: new Set(), watched: new Set(), acked: 0 };
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
      case "watch":
        if (this.sessions.has(message.session)) connection.watched.add(message.session);
        return;
      case "unwatch":
        connection.watched.delete(message.session);
        return;
      case "request":
        this.enqueue(connection, message.seq, message.session, message.request);
        return;
      case "operate":
        void this.operate(connection, message.seq, message.name, message.args);
        return;
      case "open":
        connection.shown.add(message.session);
        try {
          this.open(message.session, new BinaryDocument(this.storage(message.source)));
          this.tell(message.session, { kind: "state" });
        } catch (error) {
          const failure = failureOf(error);
          this.send(() =>
            connection.line.post({
              kind: "event",
              session: message.session,
              event: { kind: "closed", reason: failure.message },
              state: CLOSED_STATE,
              acked: connection.acked,
            })
          );
        }
        return;
    }
  }

  private async operate(
    connection: Connection,
    seq: number,
    name: string,
    args: unknown
  ): Promise<void> {
    try {
      const operation = this.hostOperations.get(name);
      if (operation === undefined) throw new Error(`The host does not know “${name}”.`);
      const value = await operation(args, this);
      this.send(() =>
        connection.line.post({ kind: "answer", seq, session: "", result: { kind: "value", value } })
      );
    } catch (error) {
      this.send(() =>
        connection.line.post({ kind: "answer", seq, session: "", failure: failureOf(error) })
      );
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
      this.send(() =>
        connection.line.post({
          kind: "answer",
          seq,
          session: id,
          failure: { name: "SessionClosed", message: `Session ${id} is not open.` },
        })
      );
      return;
    }
    session.queue = session.queue.then(async () => {
      connection.acked = Math.max(connection.acked, seq);
      try {
        const result = await this.apply(session, request);
        const transfer = result.kind === "bytes" ? [result.bytes.buffer] : [];
        const state = stateOf(session);
        this.send(() =>
          connection.line.post({ kind: "answer", seq, session: id, state, result }, transfer)
        );
      } catch (error) {
        const state = stateOf(session);
        this.send(() =>
          connection.line.post({
            kind: "answer",
            seq,
            session: id,
            state,
            failure: failureOf(error),
          })
        );
      }
      // The request is done when what it says has gone: the next one's news comes after it.
      await this.outbox;
    });
  }

  private async apply(session: Session, request: SessionRequest): Promise<SessionResult> {
    const { document, cuts, acts } = session;
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
        const applied = await acts.undo(request.batch);
        return { kind: "applied", spans: applied?.map(operationSpan) };
      }
      case "redo": {
        const applied = await acts.redo();
        return { kind: "applied", spans: applied?.map(operationSpan) };
      }
      case "applyCuts": {
        const changed = cuts.apply(partitionFrom(request.partition));
        if (changed) acts.noteCuts();
        return { kind: "changed", changed };
      }
      case "resetCuts":
        cuts.reset(document.size);
        acts.forget();
        return none;
      case "beginActs":
        acts.beginGroup();
        return none;
      case "endActs":
        acts.endGroup();
        return none;
      case "operate": {
        const operation = this.sessionOperations.get(request.name);
        if (operation === undefined) throw new Error(`The host does not know “${request.name}”.`);
        const value = await operation(session, request.args, this);
        // What an operation did is not an edit the document told of: the state goes out anyway.
        this.tell(session.id, { kind: "state" });
        return { kind: "value", value };
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

  /** The windows that hear a session's news: those that show it, and those that watch it. */
  private hearing(id: SessionId): Connection[] {
    return [...this.connections].filter(
      (connection) => connection.shown.has(id) || connection.watched.has(id)
    );
  }

  /** Says something once everything said before it has gone. */
  private send(post: () => void | Promise<void>): void {
    this.outbox = this.outbox.then(post).catch(() => undefined);
  }

  private tell(id: SessionId, event: SessionEvent): void {
    const session = this.sessions.get(id);
    if (session === undefined) return;
    const state = stateOf(session);
    const heard = this.hearing(id);
    const acked = heard.map((connection) => connection.acked);
    this.send(() => {
      heard.forEach((connection, index) => {
        connection.line.post({
          kind: "event",
          session: id,
          event,
          state,
          acked: acked[index] ?? 0,
        });
      });
    });
  }

  /**
   * An edit's news, with the bytes it left where they are few enough to send: a window lays them
   * over what it has read rather than reading again, so a typed byte is painted from the news of
   * it and not after a second round trip.
   */
  private tellContent(id: SessionId, ops: readonly UndoOperation[], restoring: boolean): void {
    const session = this.sessions.get(id);
    if (session === undefined) return;
    const state = stateOf(session);
    const heard = this.hearing(id);
    const acked = heard.map((connection) => connection.acked);
    this.send(async () => {
      const spans = await spansWithBytes(ops);
      heard.forEach((connection, index) => {
        connection.line.post({
          kind: "event",
          session: id,
          event: { kind: "content", spans, restoring },
          state,
          acked: acked[index] ?? 0,
        });
      });
    });
  }
}

/** @web-only see {@link SessionHost} */
export function stateOf(session: SessionParts): SessionState {
  const { document, cuts, acts } = session;
  const history = document.undoHistory;
  return {
    size: document.size,
    dirty: document.isDirty,
    canUndo: acts.canUndo,
    canRedo: acts.canRedo,
    undoLabel: acts.undoLabel,
    redoLabel: acts.redoLabel,
    selection: document.selection,
    contentGeneration: document.contentGeneration,
    lastCommittedSerial: history.lastCommittedSerial,
    baseSerial: history.baseSerial,
    historyVersion: history.version,
    agentId: session.agentId,
    cuts: { version: cuts.version, partition: partitionData(cuts.partition) },
  };
}

/**
 * An edit landed: the cuts move with the bytes, one operation at a time, each at the size it left.
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.apply
 * @upstream-differs the session moves its cuts on every edit; upstream's pane tells its store
 */
function moveCuts(cuts: CutHistory, ops: readonly UndoOperation[], sizeAfter: number): void {
  let size = sizeAfter;
  for (const op of ops) {
    if (op.kind === "insert") size -= op.bytes.count;
    else if (op.kind === "delete") size += op.bytes.count;
  }
  for (const op of ops) {
    const count = op.kind === "overwrite" ? op.after.count : op.bytes.count;
    if (op.kind === "insert") size += count;
    else if (op.kind === "delete") size -= count;
    const edit: DiffEdit =
      op.kind === "overwrite"
        ? { kind: "overwrite", start: op.at, end: op.at + count }
        : op.kind === "insert"
          ? { kind: "insert", at: op.at, length: count }
          : { kind: "delete", start: op.at, end: op.at + count };
    cuts.noteEdit(edit, size);
  }
}

/**
 * How many bytes of an edit its news carries. A typed byte, a paste, a patch: carried. A fill of a
 * region, a join: the window reads again what it shows.
 */
const NEWS_BYTES = 256 * 1024;

/** The operations as stretches, the first of them carrying what they wrote while it stays small. */
async function spansWithBytes(ops: readonly UndoOperation[]): Promise<OperationSpan[]> {
  let budget = NEWS_BYTES;
  const spans: OperationSpan[] = [];
  for (const op of ops) {
    const span = operationSpan(op);
    const written =
      op.kind === "overwrite" ? op.after : op.kind === "insert" ? op.bytes : undefined;
    if (written !== undefined && written.count <= budget) {
      try {
        const bytes = (await written.load()).slice();
        budget -= bytes.length;
        spans.push({ ...span, bytes });
        continue;
      } catch {
        // Not readable now: the window reads the stretch again instead.
      }
    }
    if (written !== undefined) budget = 0;
    spans.push(span);
  }
  return spans;
}

/** @web-only see {@link SessionHost.defineSessionOperation} */
export type SessionOperation = (
  session: SessionParts,
  args: unknown,
  host: SessionHost
) => unknown | Promise<unknown>;

/** @web-only see {@link SessionHost.defineHostOperation} */
export type HostOperation = (args: unknown, host: SessionHost) => unknown | Promise<unknown>;

function failureOf(error: unknown): SessionFailure {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

/** What a session that could not be opened says of itself: nothing in it. */
const CLOSED_STATE: SessionState = {
  size: 0,
  dirty: false,
  canUndo: false,
  canRedo: false,
  selection: caretAt(0, 0),
  contentGeneration: 0,
  baseSerial: 0,
  historyVersion: { epoch: 0, serial: 0 },
  cuts: { version: 0, partition: { contentSize: 0, pieces: [{ start: 0, name: "" }] } },
};
