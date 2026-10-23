import { L, LocalizedText } from "@/core/localization/localization";
import { CopyPartCodec, type PartCodec, PartRefusal } from "@/core/parts/partCodec";
import type { SessionId } from "@/core/session/sessionProtocol";
import type { SessionView } from "@/core/session/sessionView";
import { IMAGE_LAYOUT, type UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import { endedHere, unwatchSession, watchSession } from "@/state/sessions/pageSessions";
import { type PaneId, paneShowing, paneState } from "@/state/workspaceStore";

/**
 * Where a part's bytes came from — a zone, a node of the tree, what a
 * compressed section decompressed to — and the way back
 * (`Design/UEFI/UPDATE_IN_PARENT.md` §2, §3).
 *
 * The parent is held by its session, which every window reaches in the session
 * host: the link goes wherever the part goes and finds the parent wherever it is
 * shown, in this window or another, as upstream's holds the parent pane itself. A
 * session that has ended — its pane closed, another file opened over it — is no
 * longer the parent. The link lives in memory with the documents and is never
 * written down — a part saved to disk is a file, and a file has no parent.
 *
 * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin
 */

/**
 * Whether the link still leads to what the bytes were taken from.
 *
 * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.State
 */
export type OriginState = "intact" | "parentClosed" | "sourceChanged";

/**
 * What putting the part back would do, or why it cannot — decided before a byte
 * is written.
 *
 * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.Update
 */
export type OriginUpdate =
  /**
   * `bytes` — the part's content — through the codec (§3); `confirm` when the
   * source has changed in the parent since, and overwriting it has to be asked
   * for.
   */
  | {
      readonly kind: "encode";
      readonly codec: PartCodec;
      readonly bytes: Uint8Array;
      readonly confirm: boolean;
    }
  /** Put into words by whoever shows it. */
  | { readonly kind: "refused"; readonly refusal: PartRefusal };

/**
 * The link's verdicts before an update, to put back if the write fails.
 *
 * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.Snapshot
 */
export interface OriginSnapshot {
  readonly source: readonly [number, number];
  readonly sourceBytes: Blob | undefined;
  readonly content: Blob;
}

/**
 * How much of a side is read at a time while the two are compared.
 *
 * @web-only upstream hashes each side whole; this walks them, and a walk reads
 * in chunks for the same reason every other read of a large file here does
 */
const COMPARE_CHUNK = 1 << 20;

/**
 * A stretch of bytes held as it stood, to answer later whether it still does.
 *
 * A `Blob` rather than a digest, and the reason is measured: a part is
 * megabytes — a decompressed DXE volume is seventeen of them — and this
 * question is asked on every keystroke. Hashing both sides costs seconds a
 * keystroke in a browser, where upstream's CryptoKit costs milliseconds; a
 * comparison that stops at the first differing byte costs almost nothing, gives
 * the same answer, and keeps the bytes off the JavaScript heap.
 */
const snapshotOf = (bytes: Uint8Array): Blob => new Blob([bytes.slice()]);

/** The bytes of a stretch of a document, or nothing where they cannot be read. */
async function readRange(
  document: SessionView,
  start: number,
  end: number
): Promise<Uint8Array | undefined> {
  if (end > document.size || start > end) return undefined;
  try {
    return await document.read(start, end - start);
  } catch {
    return undefined;
  }
}

/**
 * Whether `[start, end)` of `document` is byte for byte what `held` holds —
 * read a chunk at a time, and no further than the first byte that differs.
 *
 * `at` is where the two last differed: a witness, checked first, so a part
 * being typed into answers "changed" from one byte rather than from a walk of
 * everything before the edit. It comes back with the answer, to be checked
 * first next time.
 */
async function same(
  document: SessionView,
  start: number,
  end: number,
  held: Blob | undefined,
  at: number | undefined
): Promise<{ readonly same: boolean; readonly difference: number | undefined }> {
  if (held === undefined) return { same: false, difference: undefined };
  if (end > document.size || start > end || end - start !== held.size) {
    return { same: false, difference: undefined };
  }
  if (at !== undefined && at < held.size) {
    const read = await readRange(document, start + at, start + at + 1);
    const known = new Uint8Array(await held.slice(at, at + 1).arrayBuffer());
    if (read === undefined || read[0] !== known[0]) return { same: false, difference: at };
  }
  for (let offset = 0; offset < held.size; offset += COMPARE_CHUNK) {
    const length = Math.min(COMPARE_CHUNK, held.size - offset);
    const read = await readRange(document, start + offset, start + offset + length);
    if (read === undefined) return { same: false, difference: undefined };
    const known = new Uint8Array(await held.slice(offset, offset + length).arrayBuffer());
    for (let index = 0; index < length; index++) {
      if (read[index] !== known[index]) return { same: false, difference: offset + index };
    }
  }
  return { same: true, difference: undefined };
}

/**
 * What a link is once it leaves its window for another, but for its codec, which the carrier says
 * in words of its own: the parent's session by name, and the link's snapshots as they stand.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.release
 * @upstream-differs the link crosses as a record, where upstream's pane takes its object along
 */
export interface CarriedOrigin {
  readonly session: SessionId;
  readonly parentName: string;
  readonly source: readonly [number, number];
  readonly partName: string;
  readonly layout: UEFIRootLayout;
  readonly sourceBytes: Blob | undefined;
  readonly content: Blob;
}

/**
 * The link one part carries.
 *
 * Everything it answers is asked of the two documents as they are now, and the
 * answers are cached against each side's content generation: a side is read and
 * hashed again only once its bytes could have changed.
 */
export class DocumentOrigin {
  /**
   * The source's bytes in the parent: the zone, the node, or the outermost
   * compressed section a decompressed body came out of. It moves with an update
   * that changed its length.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.sourceRange
   */
  private source: readonly [number, number];
  /**
   * What the part is called there — the zone's or the node's name.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.partName
   */
  readonly partName: string;
  /**
   * What the part's bytes are to the source's, both ways: a copy, a body
   * decompressed, a block decoded. The whole of what Update in Parent does is
   * its `encode`.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.codec
   */
  readonly codec: PartCodec;
  /**
   * What the bytes are, for a tool-module opened on the part: a decompressed
   * body is a run of sections, not an image to scan.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.layout
   */
  readonly layout: UEFIRootLayout;

  /**
   * The parent's session as this window hears it — watched, so the link hears it end wherever it
   * is shown.
   */
  private readonly parentDocument: SessionView;
  /** Whether the watch has been let go: the part is closed, or carried on to another window. */
  private released = false;
  /**
   * The source's bytes as last taken out or put back; nothing where they could
   * not be read at all.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.fingerprint
   * @upstream-differs the bytes, held off the heap, where upstream holds their
   * SHA-256: what the two sides are asked is whether they still match, and a
   * walk that stops at the first byte that differs answers it without hashing
   * megabytes on every keystroke
   */
  private sourceBytes: Blob | undefined;
  /**
   * The part's content as last taken out or put back — what "has changes to put
   * back" is measured against.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.baseline
   * @upstream-differs the bytes rather than their digest, for the reason above
   */
  private content: Blob;
  /** Where the part and its snapshot last differed — the witness `same` checks first. */
  private childDifference: number | undefined;
  /**
   * The parent's name now — it follows a Save As — or the last name it had
   * while it was still the parent.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.parentName
   */
  private lastParentName: string;
  /** The last verdicts, with the generation each was reached at. */
  private checked: { generation: number; state: OriginState } | undefined;
  private childChecked: { generation: number; changed: boolean } | undefined;

  private constructor(
    parentDocument: SessionView,
    parentName: string,
    source: readonly [number, number],
    partName: string,
    codec: PartCodec,
    layout: UEFIRootLayout,
    sourceBytes: Blob | undefined,
    content: Blob
  ) {
    this.parentDocument = parentDocument;
    this.lastParentName = parentName;
    this.source = source;
    this.partName = partName;
    this.codec = codec;
    this.layout = layout;
    this.sourceBytes = sourceBytes;
    this.content = content;
    this.checked = {
      generation: parentDocument.contentGeneration,
      state: sourceBytes === undefined ? "sourceChanged" : "intact",
    };
  }

  /**
   * Makes the link, reading both sides once: the source's bytes as they are now
   * and the part's as it opens with them. Nothing where the parent is not open.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.init
   */
  static async of(options: {
    readonly parent: PaneId;
    readonly source: readonly [number, number];
    readonly partName: string;
    /** What the bytes are to the source; a copy when nothing says otherwise. */
    readonly codec?: PartCodec | undefined;
    /** What a panel opened on the part should read its bytes as. */
    readonly layout?: UEFIRootLayout;
    readonly content: Uint8Array;
  }): Promise<DocumentOrigin | undefined> {
    const slot = paneState(options.parent);
    if (slot === undefined) return undefined;
    let view: SessionView;
    try {
      view = await watchSession(slot.document.id);
    } catch {
      return undefined;
    }
    const held = await readRange(view, options.source[0], options.source[1]);
    return new DocumentOrigin(
      view,
      slot.name,
      options.source,
      options.partName,
      options.codec ?? new CopyPartCodec(),
      options.layout ?? IMAGE_LAYOUT,
      held === undefined ? undefined : snapshotOf(held),
      snapshotOf(options.content)
    );
  }

  /**
   * A link carried in from another window, its parent taken up by its session's name; nothing
   * where that session has ended on the way.
   */
  static async carried(
    carried: CarriedOrigin & { readonly codec: PartCodec }
  ): Promise<DocumentOrigin | undefined> {
    let view: SessionView;
    try {
      view = await watchSession(carried.session);
    } catch {
      return undefined;
    }
    return new DocumentOrigin(
      view,
      carried.parentName,
      carried.source,
      carried.partName,
      carried.codec,
      carried.layout,
      carried.sourceBytes,
      carried.content
    );
  }

  /** The link as it leaves for another window; `release` lets this window's hold on it go. */
  carry(): CarriedOrigin {
    return {
      session: this.parentDocument.id,
      parentName: this.parentName,
      source: this.source,
      partName: this.partName,
      layout: this.layout,
      sourceBytes: this.sourceBytes,
      content: this.content,
    };
  }

  /** Stops hearing the parent: the part has closed, or gone on to another window. */
  release(): void {
    if (this.released) return;
    this.released = true;
    unwatchSession(this.parentDocument.id);
  }

  /**
   * The pane of this window that shows the parent — a file slot, or another part: a part opened
   * from a panel names that panel's pane, not the dump behind it, so the dock stays flat and the
   * links form the chain. Nothing while the parent is shown only in another window, or ended.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.parent
   * @upstream-differs found by the session, where upstream holds the pane
   */
  get parent(): PaneId | undefined {
    return this.parentAlive ? paneShowing(this.parentDocument) : undefined;
  }

  /** The parent's session, as long as it has not ended: what an update reads and writes. */
  get parentView(): SessionView | undefined {
    return this.parentAlive ? this.parentDocument : undefined;
  }

  /** The parent's session's name, which another window finds it by. */
  get parentSession(): SessionId {
    return this.parentDocument.id;
  }

  /**
   * Hears the parent change or end, wherever it is shown: a parent in another window moves no
   * pane of this one, so nothing else here would ask the link again. Answers the means to stop.
   */
  onParentChanged(listener: () => void): () => void {
    const stops = [
      this.parentDocument.onContentChanged(listener),
      this.parentDocument.onClosed(listener),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }

  /** The bytes this part came from, in the parent. */
  get sourceRange(): readonly [number, number] {
    return this.source;
  }

  /**
   * Whether the link still leads to what the bytes were taken from, asked of
   * the parent as it is now.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.state
   */
  async state(): Promise<OriginState> {
    // A pane closed in this very turn has its session ended once the turn's own work is done
    // (`workspaceStore`, the sessions no pane shows): that is let happen first.
    await Promise.resolve();
    const document = this.parentView;
    if (document === undefined) return "parentClosed";
    const generation = document.contentGeneration;
    const checked = this.checked;
    if (checked !== undefined && checked.generation === generation) return checked.state;
    const found = await same(document, this.source[0], this.source[1], this.sourceBytes, undefined);
    const state: OriginState = found.same ? "intact" : "sourceChanged";
    this.checked = { generation, state };
    return state;
  }

  /** @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.parentName */
  get parentName(): string {
    const pane = this.parent;
    const slot = pane === undefined ? undefined : paneState(pane);
    if (slot !== undefined) this.lastParentName = slot.name;
    return this.lastParentName;
  }

  /**
   * What the header's link says under the pointer.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.explanation
   */
  explanationFor(state: OriginState): string {
    switch (state) {
      case "intact":
        return L(
          "Opened from “%1$@” in %2$@. Click to show it there.",
          this.partName,
          this.parentName
        );
      case "parentClosed":
        return L(
          "Opened from “%1$@” in %2$@, which is no longer open.",
          this.partName,
          this.parentName
        );
      case "sourceChanged":
        return L(
          "Opened from “%1$@” in %2$@, which has changed there since.",
          this.partName,
          this.parentName
        );
    }
  }

  /**
   * Whether the part holds anything the parent does not have back yet.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.hasChanges
   */
  async hasChanges(child: SessionView): Promise<boolean> {
    const generation = child.contentGeneration;
    const checked = this.childChecked;
    if (checked !== undefined && checked.generation === generation) return checked.changed;
    const found = await same(child, 0, child.size, this.content, this.childDifference);
    this.childDifference = found.difference;
    this.childChecked = { generation, changed: !found.same };
    return !found.same;
  }

  /**
   * What Update in Parent would do with the part's bytes (§3, §4): hand them to
   * the codec, or a refusal that says why there is nothing to hand them to.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.planUpdate
   */
  async planUpdate(child: SessionView): Promise<OriginUpdate> {
    const state = await this.state();
    if (this.parentView === undefined || state === "parentClosed") {
      return {
        kind: "refused",
        refusal: new PartRefusal(
          LocalizedText.of("The parent is closed"),
          LocalizedText.of(
            "“%1$@” is no longer open, so there is nothing to put “%2$@” back into.",
            this.parentName,
            this.partName
          )
        ),
      };
    }
    let bytes: Uint8Array;
    try {
      bytes = await child.read(0, child.size);
    } catch {
      return {
        kind: "refused",
        refusal: new PartRefusal(
          LocalizedText.of("The part could not be read"),
          LocalizedText.of("Nothing was changed in %1$@.", this.parentName)
        ),
      };
    }
    return { kind: "encode", codec: this.codec, bytes, confirm: state === "sourceChanged" };
  }

  /**
   * Takes `partBytes` as what the part holds and `sourceBytes` as what the
   * parent will — called just before the write, so the change the write
   * announces already finds the link intact and nothing left to put back.
   * Hands back what to restore if the write fails.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.adopt
   */
  adopt(
    partBytes: Uint8Array,
    sourceBytes: Uint8Array,
    source: readonly [number, number]
  ): OriginSnapshot {
    const snapshot: OriginSnapshot = {
      source: this.source,
      sourceBytes: this.sourceBytes,
      content: this.content,
    };
    this.sourceBytes = snapshotOf(sourceBytes);
    this.content = snapshotOf(partBytes);
    this.source = source;
    this.checked = undefined;
    this.childChecked = undefined;
    this.childDifference = undefined;
    return snapshot;
  }

  /** @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.restore */
  restore(snapshot: OriginSnapshot): void {
    this.sourceBytes = snapshot.sourceBytes;
    this.content = snapshot.content;
    this.source = snapshot.source;
    this.checked = undefined;
    this.childChecked = undefined;
    this.childDifference = undefined;
  }

  /**
   * Whether the parent's session is still open: the host's word that it closed, or this window's
   * own knowledge that it ended it, which comes first.
   */
  private get parentAlive(): boolean {
    return !this.parentDocument.closed && !endedHere(this.parentDocument.id);
  }
}
