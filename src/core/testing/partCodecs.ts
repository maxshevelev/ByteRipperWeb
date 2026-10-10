import { LocalizedText } from "@/core/localization/localization";
import {
  type PartBadge,
  type PartCodec,
  type PartParent,
  PartRefusal,
  type PartUpdate,
  sourceBytes,
} from "@/core/parts/partCodec";

/**
 * Bytes a test hands over as a part: they open as given — whatever the source
 * holds — and go back through `back`. What a test of the panels needs is a part
 * with known bytes; what the codec does with them on the way back is the
 * codec's own test.
 *
 * @upstream ByteRipperTests/PartCodecTestSupport.swift#GivenBytesCodec
 */
export class GivenBytesCodec implements PartCodec {
  readonly bytes: Uint8Array;
  readonly back: PartCodec;
  readonly decodesImmediately = true;

  constructor(bytes: Uint8Array, back: PartCodec) {
    this.bytes = bytes;
    this.back = back;
  }

  async decode(): Promise<Uint8Array> {
    return this.bytes;
  }

  encode(part: Uint8Array, parent: PartParent): Promise<PartUpdate> {
    return this.back.encode(part, parent);
  }

  get isImmediate(): boolean {
    return this.back.isImmediate;
  }

  get keepsOffsets(): boolean {
    return this.back.keepsOffsets;
  }

  get badge(): PartBadge | undefined {
    return this.back.badge;
  }
}

/**
 * A body that is not the file's bytes: what a decompressed body is to the
 * bookmarks, without a compressed section having to exist.
 *
 * @upstream ByteRipperTests/PartCodecTestSupport.swift#ElsewhereCodec
 */
export class ElsewhereCodec implements PartCodec {
  readonly isImmediate = true;
  readonly decodesImmediately = true;
  readonly keepsOffsets = false;
  readonly badge = undefined;

  decode(parent: PartParent): Promise<Uint8Array> {
    return sourceBytes(parent);
  }

  async encode(): Promise<PartUpdate> {
    throw new PartRefusal(
      LocalizedText.verbatim("This cannot be put back"),
      LocalizedText.verbatim("A test body.")
    );
  }
}
