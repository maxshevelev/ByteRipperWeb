import type { BinaryDocument } from "@/core/document/binaryDocument";
import { hexAddress } from "@/core/text/hexText";
import { sha256 } from "@/firmware/me/crypto/digest";
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
 * @upstream-differs no `rebuild` case: laying the image out again around a part
 * whose length changed is the planner (`UEFIRebuild`), which this port has no
 * half of yet — such a part is refused by the length rule below, which is the
 * same answer upstream gives a part with no rebuild target
 */
export type OriginUpdate =
  | {
      readonly kind: "overwrite";
      readonly offset: number;
      readonly bytes: Uint8Array;
      /** The source has changed there since, so the overwrite has to be asked for. */
      readonly confirm: boolean;
    }
  | { readonly kind: "refused"; readonly title: string; readonly message: string };

/**
 * The link's verdicts before an update, to put back if the write fails.
 *
 * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.Snapshot
 */
export interface OriginSnapshot {
  readonly fingerprint: string | undefined;
  readonly baseline: string;
  readonly source: readonly [number, number];
}

/** The digest of a stretch of bytes, or nothing where they cannot be read. */
async function digestOf(
  document: BinaryDocument,
  start: number,
  end: number
): Promise<string | undefined> {
  if (end > document.size || start > end) return undefined;
  try {
    return hex(sha256(await document.read(start, end - start)));
  } catch {
    return undefined;
  }
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

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

  /** The document the parent pane held when the part was taken out of it. */
  private readonly parentDocument: BinaryDocument;
  /** The source's bytes as last taken out or put back. */
  private fingerprint: string | undefined;
  /**
   * The part's content as last taken out or put back — what "has changes to put
   * back" is measured against.
   *
   * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.baseline
   */
  private baseline: string;
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
    fingerprint: string | undefined,
    baseline: string
  ) {
    this.parent = parent;
    this.parentDocument = parentDocument;
    this.lastParentName = parentName;
    this.source = source;
    this.partName = partName;
    this.kind = kind;
    this.fingerprint = fingerprint;
    this.baseline = baseline;
    this.checked = {
      generation: parentDocument.contentGeneration,
      state: fingerprint === undefined ? "sourceChanged" : "intact",
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
    readonly content: Uint8Array;
  }): Promise<DocumentOrigin | undefined> {
    const slot = paneState(options.parent);
    if (slot === undefined) return undefined;
    const fingerprint = await digestOf(slot.document, options.source[0], options.source[1]);
    return new DocumentOrigin(
      options.parent,
      slot.document,
      slot.name,
      options.source,
      options.partName,
      options.kind ?? "copy",
      fingerprint,
      hex(sha256(options.content))
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
    const digest = await digestOf(slot.document, this.source[0], this.source[1]);
    const state: OriginState =
      digest !== undefined && digest === this.fingerprint ? "intact" : "sourceChanged";
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
    let changed = true;
    try {
      changed = hex(sha256(await child.read(0, child.size))) !== this.baseline;
    } catch {
      changed = true;
    }
    this.childChecked = { generation, changed };
    return changed;
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
    if (this.kind !== "copy") {
      return {
        kind: "refused",
        title: "This cannot be put back",
        message:
          `These bytes were decompressed from “${this.partName}” in ${this.parentName}, ` +
          "and compressing them again is not something this edition does yet.",
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
      fingerprint: this.fingerprint,
      baseline: this.baseline,
      source: this.source,
    };
    this.fingerprint = hex(sha256(sourceBytes));
    this.baseline = hex(sha256(partBytes));
    this.source = source;
    this.checked = undefined;
    this.childChecked = undefined;
    return snapshot;
  }

  /** @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.restore */
  restore(snapshot: OriginSnapshot): void {
    this.fingerprint = snapshot.fingerprint;
    this.baseline = snapshot.baseline;
    this.source = snapshot.source;
    this.checked = undefined;
    this.childChecked = undefined;
  }

  /** The parent pane, while it is still holding the document this came from. */
  private livingParent(): PaneState | undefined {
    const slot = paneState(this.parent);
    return slot !== undefined && slot.document === this.parentDocument ? slot : undefined;
  }
}
