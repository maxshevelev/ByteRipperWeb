import { assembleWord, type ByteSource } from "@/firmware/byteSource";

/** What reads a `Blob` synchronously: `FileReaderSync`, which only a worker has. */
export interface BlobReader {
  readAsArrayBuffer(blob: Blob): ArrayBuffer;
}

/**
 * A `Blob`, read synchronously, which is a thing only a worker can do.
 *
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/ToolContentByteSource.swift#ToolContentByteSource
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/ToolContentByteSource.swift#ToolContentByteSource.byteCount
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/ToolContentByteSource.swift#ToolContentByteSource.bytes
 * @upstream-differs reads the pane's Blob in the worker, not a live reader over the document
 * @upstream-differs a read that fails throws, where upstream's hands back zeros of the length asked
 * for: here the failure is a `File` gone stale under a changed file, and the request it was part of
 * fails and says so, rather than a tree being read off bytes that were never there
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#LiveDocumentByteSource
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#LiveDocumentByteSource.byteCount
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#LiveDocumentByteSource.bytes
 */
export class BlobByteSource implements ByteSource {
  private readonly blob: Blob;
  private readonly reader: BlobReader;

  constructor(blob: Blob, reader: BlobReader = new FileReaderSync()) {
    this.blob = blob;
    this.reader = reader;
  }

  get byteCount(): number {
    return this.blob.size;
  }

  bytes(start: number, end: number): Uint8Array {
    if (end <= start) return new Uint8Array(0);
    return new Uint8Array(this.reader.readAsArrayBuffer(this.blob.slice(start, end)));
  }

  word(offset: number, count: number): number {
    return assembleWord(this.bytes(offset, offset + count), 0, count);
  }
}
