import type { BinaryDocument } from "@/core/document/binaryDocument";
import type { PartReader } from "@/core/parts/partCodec";

/**
 * A document's content, unsaved edits included, for a part's codec to decode
 * from and encode into (`PartCodec`).
 *
 * @upstream ByteRipperApp/Documents/DocumentPartReader.swift#DocumentPartReader
 * @upstream ByteRipperApp/Documents/DocumentPartReader.swift#DocumentPartReader.init
 * @upstream ByteRipperApp/Documents/DocumentPartReader.swift#DocumentPartReader.size
 * @upstream ByteRipperApp/Documents/DocumentPartReader.swift#DocumentPartReader.read
 * @upstream-differs reads the document as it is when asked rather than a frozen
 * snapshot of it: upstream freezes one so a codec can read off the main actor
 * while the reader types, and here the slow halves run in the firmware worker
 * over the content taken at the moment they are asked for. What an update reads
 * on the main thread it reads before writing, and whether the parent moved
 * under a slow one is the content generation's to say
 */
export function documentPartReader(document: BinaryDocument): PartReader {
  return {
    get size() {
      return document.size;
    },
    async read(offset, length) {
      if (length < 0 || offset + length > document.size) {
        throw new RangeError("past the end of the document");
      }
      return document.read(offset, length);
    },
  };
}
