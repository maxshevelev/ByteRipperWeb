import { L } from "@/core/localization/localization";

/**
 * What a part's bytes are to the bytes of the file they came out of, in both
 * directions (`Design/UEFI/UPDATE_IN_PARENT.md` §4.2, upstream's
 * `Design/FRAGMENT_PANELS_PLAN.md`).
 *
 * A part is opened from a range of its parent — a zone, a node of the image, a
 * compressed section, an encoded block — and what the reader studies is not
 * always those bytes as they lie. It may be them as they are (a copy), what they
 * decompress to, or what they decode to. Each of those is one codec: `decode`
 * makes the panel's bytes out of the source, and `encode` makes the source again
 * out of the panel's bytes when the reader puts the panel back (Update in
 * Parent). The application opens and puts back every part the same way — a zone,
 * a selection, a part a tool-module handed over — and knows nothing about any of
 * them.
 */

/**
 * Bytes the part is decoded from and encoded into.
 *
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartReader
 * @upstream-differs a read is a promise, as every read of a document is here;
 * upstream's is a synchronous read of a frozen snapshot, from any thread
 */
export interface PartReader {
  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartReader.size */
  readonly size: number;
  /**
   * Reads `length` bytes at `offset`; rejects rather than truncates past the end.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartReader.read
   */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/**
 * The parent a part is decoded from and encoded into: a reading of its whole
 * content, and where in it the part's source is.
 *
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartParent
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartParent.init
 */
export interface PartParent {
  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartParent.content */
  readonly content: PartReader;
  /**
   * The source's range in `content` — what the link points at. Half-open.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartParent.source
   */
  readonly source: readonly [number, number];
  /**
   * What the parent is called, for a refusal to name it.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartParent.name
   */
  readonly name: string;
  /**
   * What the part is called there — the zone's name, the section's.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartParent.partName
   */
  readonly partName: string;
  /**
   * Says what a slow `encode` is doing now, and how far it has got.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartParent.progress
   */
  readonly progress?:
    | ((phase: string | undefined, fraction: number | undefined) => void)
    | undefined;
}

/**
 * The source's bytes as they are now.
 *
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartParent.sourceBytes
 */
export function sourceBytes(parent: PartParent): Promise<Uint8Array> {
  return parent.content.read(parent.source[0], parent.source[1] - parent.source[0]);
}

/**
 * The whole parent, for a codec whose way back lays out more than the source.
 *
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartParent.allBytes
 */
export function allBytes(parent: PartParent): Promise<Uint8Array> {
  return parent.content.read(0, parent.content.size);
}

/**
 * One run of bytes to write over the parent, and what the reader is told about
 * it.
 *
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartUpdate
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartUpdate.init
 */
export interface PartUpdate {
  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartUpdate.offset */
  readonly offset: number;
  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartUpdate.bytes */
  readonly bytes: Uint8Array;
  /**
   * Where the source is once the run is written — the same range, unless the
   * way back laid it out again at another length.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartUpdate.source
   */
  readonly source: readonly [number, number];
  /**
   * Said after the update, above the line about undoing it.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartUpdate.notes
   */
  readonly notes: readonly string[];
}

/**
 * `bytes` over the whole source, which keeps its place.
 *
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartUpdate.overwriting
 */
export function overwriting(source: readonly [number, number], bytes: Uint8Array): PartUpdate {
  return { offset: source[0], bytes, source, notes: [] };
}

/**
 * Why a part cannot go back, in the words the user is shown.
 *
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartRefusal
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartRefusal.init
 */
export class PartRefusal extends Error {
  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartRefusal.title */
  readonly title: string;

  /**
   * `Error.message`, which carries the words the reader is shown.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartRefusal.message
   */
  constructor(title: string, message: string) {
    super(message);
    this.name = "PartRefusal";
    this.title = title;
  }

  /**
   * The part is not the source's length, and its bytes go back only at that
   * length: another one would shift every byte after it.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartRefusal.lengthChanged
   * @upstream-differs "this part" where upstream says "this tab": a part opens
   * as a panel here, never as a tab
   */
  static lengthChanged(options: {
    readonly part: string;
    readonly parent: string;
    readonly source: number;
    readonly now: number;
  }): PartRefusal {
    const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;
    return new PartRefusal(
      L("The length changed"),
      L(
        "“%1$@” is %2$@ bytes in %3$@, and this part is %4$@. A part goes back only at its own length: the bytes after it in the file are not this part's to move.",
        options.part,
        hex(options.source),
        options.parent,
        hex(options.now)
      )
    );
  }
}

/**
 * The badge a part panel's header carries for its codec.
 *
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartBadge
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartBadge.init
 */
export interface PartBadge {
  /**
   * A word or two: what fits in a capsule beside the panel's name.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartBadge.text
   */
  readonly text: string;
  /**
   * The sentence under the pointer: what the panel shows, and what Update in
   * Parent does with it on the way back.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartBadge.explanation
   */
  readonly explanation: string;
}

/**
 * What a part is, both ways.
 *
 * A value, kept with the link for as long as the panel is open and called long
 * after whatever opened the part has gone: what it needs it carries.
 *
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartCodec
 */
export interface PartCodec {
  /**
   * The panel's bytes, from the parent as it is now.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartCodec.decode
   */
  decode(parent: PartParent): Promise<Uint8Array>;
  /**
   * What putting `part` back writes into the parent; rejects with a
   * `PartRefusal` saying why it cannot be put back.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartCodec.encode
   */
  encode(part: Uint8Array, parent: PartParent): Promise<PartUpdate>;
  /**
   * True when `encode` is a matter of microseconds — a copy, an XOR — so the
   * update is written on the spot rather than behind a progress modal.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartCodec.isImmediate
   */
  readonly isImmediate: boolean;
  /**
   * True when `decode` is cheap enough to run on the spot as the part opens — a
   * slice of the file, an XOR. A body to decompress is decoded in the worker.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartCodec.decodesImmediately
   * @upstream-differs said, not acted on: every decode is a promise here, and
   * the panel opens when it settles whichever kind it is
   */
  readonly decodesImmediately: boolean;
  /**
   * True when byte `n` of the panel is byte `n` of the source: a copy, a block
   * decoded in place. The parent's bookmarks then reach the panel at their own
   * rows; for bytes that are not the file's — a decompressed body — there is no
   * such mapping and they do not.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartCodec.keepsOffsets
   */
  readonly keepsOffsets: boolean;
  /**
   * What the panel's header says the bytes are, as a badge beside its name —
   * `LZMA`, `XOR 77`, `Read-only` — so a reader looking at plain text knows the
   * file holds it otherwise. Nothing for a copy: the bytes are the file's, and
   * there is nothing to say.
   *
   * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#PartCodec.badge
   */
  readonly badge: PartBadge | undefined;
}

/**
 * The source's own bytes: they open as they are and go back as they are, at the
 * same length.
 *
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#CopyPartCodec
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#CopyPartCodec.init
 */
export class CopyPartCodec implements PartCodec {
  readonly isImmediate = true;
  readonly decodesImmediately = true;
  readonly keepsOffsets = true;
  readonly badge = undefined;

  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#CopyPartCodec.decode */
  decode(parent: PartParent): Promise<Uint8Array> {
    return sourceBytes(parent);
  }

  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#CopyPartCodec.encode */
  async encode(part: Uint8Array, parent: PartParent): Promise<PartUpdate> {
    const length = parent.source[1] - parent.source[0];
    if (part.length !== length) {
      throw PartRefusal.lengthChanged({
        part: parent.partName,
        parent: parent.name,
        source: length,
        now: part.length,
      });
    }
    return overwriting(parent.source, part);
  }
}

/**
 * Bytes worked out of the source that nothing here can turn back into it — a
 * variable's text unpacked from a format there is no encoder for. They open as
 * given and are refused on the way back, with the reason.
 *
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#ReadOnlyPartCodec
 * @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#ReadOnlyPartCodec.init
 */
export class ReadOnlyPartCodec implements PartCodec {
  readonly isImmediate = true;
  readonly decodesImmediately = true;
  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#ReadOnlyPartCodec.keepsOffsets */
  readonly keepsOffsets = false;
  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#ReadOnlyPartCodec.bytes */
  readonly bytes: Uint8Array;
  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#ReadOnlyPartCodec.title */
  readonly title: string;
  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#ReadOnlyPartCodec.reason */
  readonly reason: string;

  constructor(bytes: Uint8Array, title: string, reason: string) {
    this.bytes = bytes;
    this.title = title;
    this.reason = reason;
  }

  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#ReadOnlyPartCodec.decode */
  async decode(): Promise<Uint8Array> {
    return this.bytes;
  }

  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#ReadOnlyPartCodec.encode */
  async encode(): Promise<PartUpdate> {
    throw new PartRefusal(this.title, this.reason);
  }

  /** @upstream Packages/PartCodec/Sources/PartCodec/PartCodec.swift#ReadOnlyPartCodec.badge */
  get badge(): PartBadge {
    return {
      text: L("Read-only", { context: "part badge" }),
      explanation: L("These bytes were worked out of the file and cannot be put back into it."),
    };
  }
}
