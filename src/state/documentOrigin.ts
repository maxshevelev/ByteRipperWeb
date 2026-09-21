import type { BinaryDocument } from "@/core/document/binaryDocument";
import { hexAddress } from "@/core/text/hexText";
import { IMAGE_LAYOUT, type UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import type { RebuildTarget } from "@/firmware/uefi/uefiRebuild";
import { type PaneId, type PaneState, paneState } from "@/state/workspaceStore";

/**
 * Where a part's bytes came from — a zone, a node of the tree, what a
 * compressed section decompressed to — and the way back
 * (`Design/UEFI/UPDATE_IN_PARENT.md` §2, §3).
 *
 * The parent is held by its pane *and* by the document that pane had at the
 * time: a pane that has been closed, or has another file in it now, is no
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
 * How the part's bytes stand to the source: the source's own bytes, copied out
 * — a zone, a node, a part a tool-module took — which go back as they are; or
 * what the source decompresses to, which would have to go back compressed
 * again.
 *
 * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.Kind
 */
export type OriginKind = "copy" | "decompressed";

/**
 * What putting the part back would do, or why it cannot — decided before a byte
 * is written.
 *
 * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.Update
 */
export type OriginUpdate =
  | {
      readonly kind: "overwrite";
      readonly offset: number;
      readonly bytes: Uint8Array;
      /** The source has changed there since, so the overwrite has to be asked for. */
      readonly confirm: boolean;
    }
  /**
   * `bytes` through the rebuild planner (§6) — a decompressed body, or a zone
   * that is a structure of the image, of whatever length.
   */
  | {
      readonly kind: "rebuild";
      readonly target: RebuildTarget;
      readonly bytes: Uint8Array;
      readonly confirm: boolean;
    }
  | { readonly kind: "refused"; readonly title: string; readonly message: string };

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
  document: BinaryDocument,
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
  document: BinaryDocument,
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
 * The link one part carries.
 *
 * Everything it answers is asked of the two documents as they are now, and the
 * answers are cached against each side's content generation: a side is read and
 * hashed again only once its bytes could have changed.
 */
export class DocumentOrigin {
  /**
   * The pane the bytes came out of. A part opened from a panel names that
   * panel's pane, not the dump behind it — the dock stays flat and the links
   * form the chain.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.parent
   */
  readonly parent: PaneId;
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
  /** @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.kind */
  readonly kind: OriginKind;
  /**
   * Where the bytes go back to through the rebuild planner, when the part is
   * something the image's structure can be laid out again around
   * (`Design/UEFI/UPDATE_IN_PARENT.md` §6). Nothing for bytes that go back as
   * they are, at their own length.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.rebuildTarget
   */
  readonly rebuildTarget: RebuildTarget | undefined;
  /**
   * What the bytes are, for a tool-module opened on the part: a decompressed
   * body is a run of sections, not an image to scan.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.layout
   */
  readonly layout: UEFIRootLayout;

  /** The document the parent pane held when the part was taken out of it. */
  private readonly parentDocument: BinaryDocument;
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
    parent: PaneId,
    parentDocument: BinaryDocument,
    parentName: string,
    source: readonly [number, number],
    partName: string,
    kind: OriginKind,
    rebuildTarget: RebuildTarget | undefined,
    layout: UEFIRootLayout,
    sourceBytes: Blob | undefined,
    content: Blob
  ) {
    this.parent = parent;
    this.parentDocument = parentDocument;
    this.lastParentName = parentName;
    this.source = source;
    this.partName = partName;
    this.kind = kind;
    this.rebuildTarget = rebuildTarget;
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
    readonly kind?: OriginKind;
    /** Where the bytes go back to through the rebuild planner, when they do. */
    readonly rebuildTarget?: RebuildTarget | undefined;
    /** What a panel opened on the part should read its bytes as. */
    readonly layout?: UEFIRootLayout;
    readonly content: Uint8Array;
  }): Promise<DocumentOrigin | undefined> {
    const slot = paneState(options.parent);
    if (slot === undefined) return undefined;
    const held = await readRange(slot.document, options.source[0], options.source[1]);
    return new DocumentOrigin(
      options.parent,
      slot.document,
      slot.name,
      options.source,
      options.partName,
      options.kind ?? "copy",
      options.rebuildTarget,
      options.layout ?? IMAGE_LAYOUT,
      held === undefined ? undefined : snapshotOf(held),
      snapshotOf(options.content)
    );
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
    const slot = this.livingParent();
    if (slot === undefined) return "parentClosed";
    const generation = slot.document.contentGeneration;
    const checked = this.checked;
    if (checked !== undefined && checked.generation === generation) return checked.state;
    const found = await same(
      slot.document,
      this.source[0],
      this.source[1],
      this.sourceBytes,
      undefined
    );
    const state: OriginState = found.same ? "intact" : "sourceChanged";
    this.checked = { generation, state };
    return state;
  }

  /** @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.parentName */
  get parentName(): string {
    const slot = this.livingParent();
    if (slot !== undefined) this.lastParentName = slot.name;
    return this.lastParentName;
  }

  /**
   * What the header's link says under the pointer.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.explanation
   */
  explanationFor(state: OriginState): string {
    const from = `Opened from “${this.partName}” in ${this.parentName}`;
    switch (state) {
      case "intact":
        return `${from}. Click to show it there.`;
      case "parentClosed":
        return `${from}, which is no longer open.`;
      case "sourceChanged":
        return `${from}, which has changed there since.`;
    }
  }

  /**
   * Whether the part holds anything the parent does not have back yet.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.hasChanges
   */
  async hasChanges(child: BinaryDocument): Promise<boolean> {
    const generation = child.contentGeneration;
    const checked = this.childChecked;
    if (checked !== undefined && checked.generation === generation) return checked.changed;
    const found = await same(child, 0, child.size, this.content, this.childDifference);
    this.childDifference = found.difference;
    this.childChecked = { generation, changed: !found.same };
    return !found.same;
  }

  /**
   * What Update in Parent would do with the part's bytes, or a refusal that
   * says why.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.planUpdate
   */
  async planUpdate(child: BinaryDocument): Promise<OriginUpdate> {
    const state = await this.state();
    const slot = this.livingParent();
    if (slot === undefined || state === "parentClosed") {
      return {
        kind: "refused",
        title: "The parent is closed",
        message: `“${this.parentName}” is no longer open, so there is nothing to put “${this.partName}” back into.`,
      };
    }
    let bytes: Uint8Array;
    try {
      bytes = await child.read(0, child.size);
    } catch {
      return {
        kind: "refused",
        title: "The part could not be read",
        message: `Nothing was changed in ${this.parentName}.`,
      };
    }
    // A part the image's structure can be laid out again around goes through
    // the planner, whatever length it has come back at (§6).
    if (this.rebuildTarget !== undefined) {
      return {
        kind: "rebuild",
        target: this.rebuildTarget,
        bytes,
        confirm: state === "sourceChanged",
      };
    }
    if (this.kind !== "copy") {
      return {
        kind: "refused",
        title: "This cannot be put back",
        message:
          `These bytes were decompressed from “${this.partName}” in ${this.parentName}, ` +
          "and where they belong in it was not recorded when the part was opened.",
      };
    }
    const length = this.source[1] - this.source[0];
    if (bytes.length !== length) {
      return {
        kind: "refused",
        title: "The length changed",
        message:
          `“${this.partName}” is ${hexAddress(length)} bytes in ${this.parentName}, ` +
          `and this part is ${hexAddress(bytes.length)}. A part goes back only at its own length: ` +
          "the bytes after it in the file are not this part's to move.",
      };
    }
    return { kind: "overwrite", offset: this.source[0], bytes, confirm: state === "sourceChanged" };
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

  /** The parent pane, while it is still holding the document this came from. */
  private livingParent(): PaneState | undefined {
    const slot = paneState(this.parent);
    return slot !== undefined && slot.document === this.parentDocument ? slot : undefined;
  }
}
