import { JoinEmpty, type JoinPosition } from "@/core/document/binaryDocument";
import {
  caretAt,
  clampedSelection,
  type Selection,
  selectionIsEmpty,
} from "@/core/document/selectionModel";
import { type Segmentation, wholeFile } from "@/core/segments/segmentation";
import { partitionData, partitionFrom } from "@/core/session/sessionCuts";
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
import { SessionStorage } from "@/core/session/sessionStorage";
import type { Bytes } from "@/core/storage/byteStorage";

type Unsubscribe = () => void;

/**
 * What changed in a session's bytes, as a window hears it: the stretches touched, in the order
 * they were applied, and whether an undo or a redo did it.
 *
 * @web-only the `DocumentContentChange` of a window, whose operations crossed as stretches
 */
export interface SessionContentChange {
  readonly spans: readonly OperationSpan[];
  readonly restoring: boolean;
}

interface Waiting {
  readonly resolve: (result: SessionResult | undefined) => void;
  readonly reject: (error: Error) => void;
}

/**
 * A window's line to the session host, shared by every session the window shows: it numbers the
 * window's requests, matches the answers to them, and hands each session's news to its view.
 *
 * @web-only see {@link SessionView}
 */
export class SessionClient {
  private seq = 0;
  private readonly waiting = new Map<number, Waiting>();
  private readonly views = new Map<SessionId, SessionView>();
  private readonly line: SessionLine<ViewMessage, HostMessage>;

  constructor(line: SessionLine<ViewMessage, HostMessage>) {
    this.line = line;
    line.listen((message) => this.receive(message));
  }

  /**
   * Shows the session `id` in this window: its view, once the host has said how the session
   * stands. A session already shown here gives the view it has.
   */
  async show(id: SessionId): Promise<SessionView> {
    const shown = this.views.get(id);
    if (shown !== undefined) return shown;
    this.line.post({ kind: "show", session: id });
    const view = new SessionView(this, id);
    this.views.set(id, view);
    try {
      await view.ask({ kind: "state" });
    } catch (error) {
      this.views.delete(id);
      this.line.post({ kind: "hide", session: id });
      throw error;
    }
    return view;
  }

  /**
   * Shows a session whose state the caller already knows — one it has just opened — without
   * waiting for the host to say it.
   */
  adopt(id: SessionId, state: SessionState): SessionView {
    const shown = this.views.get(id);
    if (shown !== undefined) return shown;
    this.line.post({ kind: "show", session: id });
    const view = new SessionView(this, id);
    view.answered(state, 0);
    this.views.set(id, view);
    return view;
  }

  /**
   * Opens a session in the host from `source` — what the platform's host makes a document of —
   * under the id `id`, and shows it here at once: as an empty document of `size` bytes would stand,
   * until the host says how it does. Everything sent after this comes after it.
   */
  open(id: SessionId, source: unknown, size: number): SessionView {
    this.line.post({ kind: "open", session: id, source });
    const view = new SessionView(this, id);
    view.answered(
      {
        size,
        dirty: false,
        canUndo: false,
        canRedo: false,
        selection: caretAt(0, size),
        contentGeneration: 0,
        baseSerial: 0,
        historyVersion: { epoch: 0, serial: 0 },
        cuts: { version: -1, partition: partitionData(wholeFile(size)) },
      },
      0
    );
    this.views.set(id, view);
    return view;
  }

  /** Stops showing a session here; the view hears nothing more. */
  hide(id: SessionId): void {
    if (!this.views.delete(id)) return;
    this.line.post({ kind: "hide", session: id });
  }

  close(): void {
    for (const waiting of this.waiting.values()) waiting.reject(new Error("The host is gone."));
    this.waiting.clear();
    this.views.clear();
    this.line.close();
  }

  /** Asks the host for something it does on no one session's account; its answer. */
  async operate(name: string, args: unknown): Promise<unknown> {
    const seq = ++this.seq;
    const answer = new Promise<SessionResult | undefined>((resolve, reject) =>
      this.waiting.set(seq, { resolve, reject })
    );
    this.line.post({ kind: "operate", seq, name, args });
    const result = await answer;
    return result?.kind === "value" ? result.value : undefined;
  }

  /** @internal Sends a request; the number it went under, and its answer. */
  send(
    session: SessionId,
    request: SessionRequest,
    transfer: readonly unknown[] = []
  ): { readonly seq: number; readonly answer: Promise<SessionResult | undefined> } {
    const seq = ++this.seq;
    const answer = new Promise<SessionResult | undefined>((resolve, reject) =>
      this.waiting.set(seq, { resolve, reject })
    );
    this.line.post({ kind: "request", seq, session, request }, transfer);
    return { seq, answer };
  }

  private receive(message: HostMessage): void {
    const view = this.views.get(message.session);
    if (message.kind === "event") {
      view?.heard(message.event, message.state, message.acked);
      return;
    }
    if (message.state !== undefined) view?.answered(message.state, message.seq);
    const waiting = this.waiting.get(message.seq);
    if (waiting === undefined) return;
    this.waiting.delete(message.seq);
    if (message.failure === undefined) waiting.resolve(message.result);
    else waiting.reject(errorOf(message.failure));
  }
}

/**
 * A session as a window sees it (`Design/FILE_SESSIONS.md`): the mirror of its state the host keeps
 * current, and every change sent to the host as a request.
 *
 * It answers to the names a `BinaryDocument` does, so what drew and edited a document in the page
 * draws and edits a session through this. What it does not do is change anything itself: an edit's
 * effect is seen when the host's answer comes, which is when the edit's promise settles. The one
 * exception is the selection — a window moves the caret and reads it back in the same breath — so
 * a selection set here is this window's own until the host has applied it, and news of an older
 * selection does not take it back.
 *
 * @web-only upstream's window holds the `BinaryDocument` itself
 */
export class SessionView {
  private state: SessionState;
  /** The last selection this window set, by the number of its request; 0 for none outstanding. */
  private ownSelectionSeq = 0;
  /** The partition as this window has it, and the host's count it was built from. */
  private partitionValue: Segmentation = wholeFile(0);
  private partitionVersion = -1;
  /** The last partition this window set, by the number of its request; 0 for none outstanding. */
  private ownCutsSeq = 0;
  private readonly cutsListeners = new Set<(partition: Segmentation) => void>();
  private closedValue = false;
  /** Why the session ended before it began, when it did: its bytes could not be read. */
  closedReason: string | undefined;

  private readonly contentListeners = new Set<(change: SessionContentChange) => void>();
  private readonly selectionListeners = new Set<(selection: Selection) => void>();
  private readonly commitListeners = new Set<() => void>();
  private readonly closeListeners = new Set<() => void>();

  readonly id: SessionId;
  /**
   * The session's bytes as this window reads them: chunks from the host, cached here, forgotten
   * where the host says they changed — what the renderer peeks at and a save streams from.
   */
  readonly storage: SessionStorage;
  private readonly client: SessionClient;

  constructor(client: SessionClient, id: SessionId) {
    this.client = client;
    this.id = id;
    const mirror = () => this.state;
    this.storage = new SessionStorage(id, {
      get size() {
        return mirror().size;
      },
      get contentGeneration() {
        return mirror().contentGeneration;
      },
      readChunk: (at, length) => this.readChunk(at, length),
    });
    this.state = {
      size: 0,
      dirty: false,
      canUndo: false,
      canRedo: false,
      selection: caretAt(0, 0),
      contentGeneration: 0,
      baseSerial: 0,
      historyVersion: { epoch: 0, serial: 0 },
      cuts: { version: -1, partition: { contentSize: 0, pieces: [{ start: 0, name: "" }] } },
    };
  }

  // MARK: - The mirror

  get size(): number {
    return this.state.size;
  }

  get isDirty(): boolean {
    return this.state.dirty;
  }

  get canUndo(): boolean {
    return this.state.canUndo;
  }

  get canRedo(): boolean {
    return this.state.canRedo;
  }

  get undoLabel(): string | undefined {
    return this.state.undoLabel;
  }

  get redoLabel(): string | undefined {
    return this.state.redoLabel;
  }

  get selection(): Selection {
    return this.state.selection;
  }

  get caret(): number {
    return this.state.selection.start;
  }

  get hasSelection(): boolean {
    return !selectionIsEmpty(this.state.selection);
  }

  get contentGeneration(): number {
    return this.state.contentGeneration;
  }

  get lastCommittedSerial(): number | undefined {
    return this.state.lastCommittedSerial;
  }

  /** The partition the session's cuts make. */
  get partition(): Segmentation {
    return this.partitionValue;
  }

  onCutsChanged(listener: (partition: Segmentation) => void): Unsubscribe {
    this.cutsListeners.add(listener);
    return () => this.cutsListeners.delete(listener);
  }

  /** Where the session's history stands. */
  get historyVersion(): { readonly epoch: number; readonly serial: number } {
    return this.state.historyVersion;
  }

  get baseSerial(): number {
    return this.state.baseSerial;
  }

  /** Whether the host has ended the session. */
  get closed(): boolean {
    return this.closedValue;
  }

  // MARK: - Events

  onContentChanged(listener: (change: SessionContentChange) => void): Unsubscribe {
    this.contentListeners.add(listener);
    return () => this.contentListeners.delete(listener);
  }

  onSelectionChanged(listener: (selection: Selection) => void): Unsubscribe {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  onTransactionCommitted(listener: () => void): Unsubscribe {
    this.commitListeners.add(listener);
    return () => this.commitListeners.delete(listener);
  }

  onClosed(listener: () => void): Unsubscribe {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  // MARK: - Reading

  read(at: number, length: number): Promise<Bytes> {
    return this.storage.read(at, length);
  }

  peek(at: number, length: number): Bytes | undefined {
    return this.storage.peek(at, length);
  }

  prefetch(at: number, length: number): Promise<void> {
    return this.storage.prefetch(at, length);
  }

  private async readChunk(
    at: number,
    length: number
  ): Promise<{ bytes: Bytes; generation: number }> {
    const result = await this.ask({ kind: "read", at, length });
    return result?.kind === "bytes"
      ? { bytes: result.bytes, generation: result.generation }
      : { bytes: new Uint8Array(0), generation: -1 };
  }

  // MARK: - Edits, each a request

  async overwrite(at: number, bytes: Uint8Array): Promise<void> {
    await this.ask({ kind: "overwrite", at, bytes: bytes.slice() });
  }

  async insert(at: number, bytes: Uint8Array): Promise<void> {
    await this.ask({ kind: "insert", at, bytes: bytes.slice() });
  }

  async delete(start: number, end: number): Promise<void> {
    await this.ask({ kind: "delete", start, end });
  }

  fillZero(start: number, end: number, caretAfter?: number): Promise<void> {
    return this.fill(new Uint8Array([0]), start, end, caretAfter);
  }

  async fill(pattern: Uint8Array, start: number, end: number, caretAfter?: number): Promise<void> {
    await this.ask({ kind: "fill", pattern: pattern.slice(), start, end, caretAfter });
  }

  async replace(start: number, end: number, bytes: Uint8Array): Promise<void> {
    await this.ask({ kind: "replace", start, end, bytes: bytes.slice() });
  }

  /** The serial of the join's step, as `BinaryDocument.join` answers it. */
  async join(source: JoinSource, position: JoinPosition): Promise<number | undefined> {
    const result = await this.ask({ kind: "join", source, position });
    return result?.kind === "serial" ? result.serial : undefined;
  }

  /** The stretches the undo applied, or nothing when there was nothing to undo. */
  async undo(batch = false): Promise<readonly OperationSpan[] | undefined> {
    const result = await this.ask({ kind: "undo", batch });
    return result?.kind === "applied" ? result.spans : undefined;
  }

  async redo(): Promise<readonly OperationSpan[] | undefined> {
    const result = await this.ask({ kind: "redo" });
    return result?.kind === "applied" ? result.spans : undefined;
  }

  // MARK: - Grouping, series, the saved state: told, not awaited — the host keeps their order

  beginEditGroup(label?: string): void {
    this.tellHost({ kind: "beginEditGroup", label });
  }

  /** Settles once the host has closed the group — when its step is in the history. */
  endEditGroup(): Promise<void> {
    return this.tellHost({ kind: "endEditGroup" });
  }

  async cancelEditGroup(): Promise<void> {
    await this.ask({ kind: "cancelEditGroup" });
  }

  beginSeries(id: number): void {
    this.tellHost({ kind: "beginSeries", id });
  }

  endSeries(): void {
    this.tellHost({ kind: "endSeries" });
  }

  noteSelectionAfterEdit(): void {
    this.tellHost({ kind: "noteSelectionAfterEdit" });
  }

  markSaved(): Promise<void> {
    return this.tellHost({ kind: "markSaved" });
  }

  // MARK: - The cuts: this window's at once, the host's once applied

  /**
   * A cut, a merge, a rename: the partition it leaves, an undoable step of its own. Answers whether
   * anything changed; the partition is this window's at once, as a selection is.
   */
  applyCuts(next: Segmentation | undefined): boolean {
    if (next === undefined || next === this.partitionValue) return false;
    const { seq, answer } = this.client.send(this.id, {
      kind: "applyCuts",
      partition: partitionData(next),
    });
    answer.catch(() => undefined);
    this.ownCutsSeq = seq;
    this.takePartition(next);
    return true;
  }

  /** The content was replaced wholesale: one piece over its `size` bytes, nothing to take back. */
  resetCuts(size: number): Promise<void> {
    const { seq, answer } = this.client.send(this.id, { kind: "resetCuts" });
    this.ownCutsSeq = seq;
    this.takePartition(wholeFile(size));
    return answer.then(
      () => undefined,
      () => undefined
    );
  }

  /** Everything until {@link endActs} is one act, one press of Undo. */
  beginActs(): void {
    void this.tellHost({ kind: "beginActs" });
  }

  endActs(): Promise<void> {
    return this.tellHost({ kind: "endActs" });
  }

  clearKeepingDirty(): Promise<void> {
    return this.tellHost({ kind: "clearKeepingDirty" });
  }

  /**
   * Asks the host to do what the platform taught it under `name` to this session, in its turn
   * among the requests; its answer.
   */
  async operate(name: string, args: unknown): Promise<unknown> {
    const result = await this.ask({ kind: "operate", name, args });
    return result?.kind === "value" ? result.value : undefined;
  }

  /** Waits until the host has applied everything this window has told it so far. */
  async settled(): Promise<void> {
    await this.ask({ kind: "state" });
  }

  // MARK: - Selection: this window's at once, the host's once applied

  setSelection(selection: Selection): void {
    const clamped = clampedSelection(selection, this.state.size);
    const { seq, answer } = this.client.send(this.id, { kind: "setSelection", selection: clamped });
    answer.catch(() => undefined);
    this.ownSelectionSeq = seq;
    this.takeSelection(clamped);
  }

  // MARK: - What the host says

  /** @internal */
  async ask(request: SessionRequest): Promise<SessionResult | undefined> {
    if (this.closedValue) throw new Error(`Session ${this.id} is closed.`);
    const transfer = "bytes" in request ? [request.bytes.buffer] : [];
    return this.client.send(this.id, request, transfer).answer;
  }

  /** @internal */
  answered(state: SessionState, seq: number): void {
    this.take(state, seq);
  }

  /** @internal */
  heard(event: SessionEvent, state: SessionState, acked: number): void {
    this.take(state, acked);
    switch (event.kind) {
      case "content":
        this.storage.apply(event.spans, this.state.size);
        for (const listener of this.contentListeners)
          listener({ spans: event.spans, restoring: event.restoring });
        return;
      case "committed":
        for (const listener of this.commitListeners) listener();
        return;
      case "closed":
        this.closedValue = true;
        this.closedReason = event.reason;
        for (const listener of this.closeListeners) listener();
        return;
    }
  }

  /**
   * Sends a request whose order matters and whose answer seldom does: the promise settles once the
   * host has applied it, for the caller that reads its effect, and a failure is not thrown at one
   * that did not wait.
   */
  private tellHost(request: SessionRequest): Promise<void> {
    return this.ask(request).then(
      () => undefined,
      () => undefined
    );
  }

  private take(state: SessionState, acked: number): void {
    const own = this.ownSelectionSeq !== 0 && acked < this.ownSelectionSeq;
    if (!own) this.ownSelectionSeq = 0;
    const selection = own ? this.state.selection : state.selection;
    this.state = { ...state, selection: this.state.selection };
    this.takeSelection(selection);

    const ownCuts = this.ownCutsSeq !== 0 && acked < this.ownCutsSeq;
    if (!ownCuts) this.ownCutsSeq = 0;
    if (!ownCuts && state.cuts.version !== this.partitionVersion) {
      this.partitionVersion = state.cuts.version;
      this.takePartition(partitionFrom(state.cuts.partition));
    }
  }

  private takePartition(partition: Segmentation): void {
    this.partitionValue = partition;
    for (const listener of this.cutsListeners) listener(partition);
  }

  private takeSelection(selection: Selection): void {
    const previous = this.state.selection;
    if (
      previous.start === selection.start &&
      previous.end === selection.end &&
      previous.fileSize === selection.fileSize
    )
      return;
    this.state = { ...this.state, selection };
    for (const listener of this.selectionListeners) listener(selection);
  }
}

function errorOf(failure: SessionFailure): Error {
  if (failure.name === "JoinEmpty") return new JoinEmpty();
  const error = new Error(failure.message);
  error.name = failure.name;
  return error;
}
