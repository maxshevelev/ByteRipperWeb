import type { ByteStorage, Bytes } from "@/core/storage/byteStorage";

/**
 * A storage's whole content, a chunk at a time.
 *
 * What saving writes and what a duplicate copies. Bounded by construction: a
 * gigabyte goes out in megabyte pieces and is never held whole.
 *
 * **A short read is a failure, not an end.** Upstream learned this twice. The
 * overlay pads a truncated base with zeros so the offsets after it keep their
 * meaning — right for the view, and catastrophic for a save, because those
 * zeros would go into the user's file and the save would report success.
 * Stopping early is the same bug wearing a different hat: it publishes a file
 * shorter than the document and calls it done. Either way the answer is to
 * refuse.
 */

export const CONTENT_CHUNK_SIZE = 1024 * 1024;

/** Thrown when the content shrank under the read — see the note above. */
export class ContentUnreadable extends Error {
  constructor(at: number, wanted: number, got: number) {
    super(
      `Only ${got} of ${wanted} bytes could be read at offset ${at}. The file this document ` +
        "was opened from has changed, so saving would write bytes that are not the ones on screen."
    );
    this.name = "ContentUnreadable";
  }
}

export async function* contentStream(
  storage: ByteStorage,
  chunkSize = CONTENT_CHUNK_SIZE
): AsyncGenerator<Bytes> {
  yield* rangeStream(storage, 0, storage.size, chunkSize);
}

/**
 * One range of a storage, a chunk at a time.
 *
 * What writing a segment out reads (§21.5), and what {@link contentStream} is
 * the whole-file case of. The refusal above is the reason this is not a loop at
 * the call site: a piece written short would be published under its own name
 * and look exactly like a complete one.
 */
export async function* rangeStream(
  storage: ByteStorage,
  start: number,
  end: number,
  chunkSize = CONTENT_CHUNK_SIZE
): AsyncGenerator<Bytes> {
  for (let at = start; at < end; ) {
    const wanted = Math.min(chunkSize, end - at);
    const bytes = await storage.read(at, wanted);
    if (bytes.length !== wanted) throw new ContentUnreadable(at, wanted, bytes.length);
    yield bytes;
    at += bytes.length;
  }
}

/** The whole content in one buffer. Only for content small enough to hold. */
export async function contentBytes(storage: ByteStorage): Promise<Bytes> {
  const result = new Uint8Array(storage.size);
  let at = 0;
  for await (const chunk of contentStream(storage)) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}
