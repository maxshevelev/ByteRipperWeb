/**
 * The one compressed body the panel's own compressed-node tests open: an FFS
 * file header with a checksum that is wrong on purpose, LZMA-encoded once with
 * Python's `lzma` module in the layout EDK2 writes.
 *
 * Upstream encodes it in the test; the web edition decompresses only (GAPS.md
 * G5), so the stream is checked in and {@link fileBody} says what has to come
 * back out of it.
 */

import * as Test from "@/firmware/testing/testImage";
import { VOLUME_TOP_FILE } from "@/firmware/uefi/knownGuids";

export { streamBytes } from "@/firmware/uefi/testing/compressedFixtures";

/**
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/CompressedNodeTests.swift#CompressedNodeTests.built
 */
export const fileBody = (): Uint8Array =>
  Test.file({
    guid: VOLUME_TOP_FILE,
    type: 0x07,
    body: new Uint8Array(0xe8).fill(0x5a),
    headerChecksum: 0xaa,
  });

/** LZMA, over {@link fileBody}. */
export const FILE_LZMA: readonly string[] = [
  "5d0000010000010000000000000017019061a64af606aa542891e1f94fb9714896bde74fcd9299367a900ccdbbff",
  "fffbc44000",
];
