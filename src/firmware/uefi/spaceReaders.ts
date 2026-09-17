import type { ImageReader } from "@/firmware/imageReader";
import type { ByteSpace } from "@/firmware/uefi/byteSpace";
import { DecompressedBuffers } from "@/firmware/uefi/decompressedBuffers";
import { DEFAULT_LIMITS, type Limits } from "@/firmware/uefi/parserState";

/**
 * The bytes of every space a tree's nodes can be in: the file, and what the
 * compressed sections opened so far decompress to.
 *
 * What a consumer of a parsed image reads a node's bytes through. A node's
 * ranges are in its own space, so its header is read from that space and from
 * nowhere else — the file's reader handed a buffer offset reads unrelated bytes
 * without a word of complaint.
 *
 * Ported from `Packages/UEFIImage/Sources/UEFIImage/SpaceReaders.swift`.
 */
export class SpaceReaders {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SpaceReaders.swift#SpaceReaders.file */
  readonly file: ImageReader;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SpaceReaders.swift#SpaceReaders.buffers */
  readonly buffers: DecompressedBuffers;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SpaceReaders.swift#SpaceReaders.limit */
  readonly limit: number;

  /**
   * Over `file`, with buffers of its own — for an image no lazy tree built: a
   * test's, or a one-off parse's.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SpaceReaders.swift#SpaceReaders.init
   */
  constructor(file: ImageReader, options?: { limits?: Limits; buffers?: DecompressedBuffers }) {
    this.file = file;
    this.buffers = options?.buffers ?? new DecompressedBuffers();
    this.limit = (options?.limits ?? DEFAULT_LIMITS).maxDecompressedSize;
  }

  /**
   * A reader of `space`, or nothing when a compressed section on the way in does
   * not decode. It may decode: a buffer the cache let go of is decoded again
   * from the file, so a caller asks for a space it has recently read, not for
   * one it is guessing at.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SpaceReaders.swift#SpaceReaders.reader
   */
  readerFor(space: ByteSpace): ImageReader | undefined {
    const read = this.buffers.readerFor(space, this.file, this.limit);
    return read.ok ? read.reader : undefined;
  }
}
