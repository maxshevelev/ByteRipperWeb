import type { ByteSource } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { DecompressedBuffers } from "@/firmware/uefi/decompressedBuffers";
import type { UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { DEFAULT_LIMITS, type Limits, Parser, ProgressSink } from "@/firmware/uefi/parserState";
import { type ProtectedRanges, readProtectedRanges } from "@/firmware/uefi/protectedRanges";
import { IMAGE_LAYOUT, type UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import { type ResetVector, runSecondPass } from "@/firmware/uefi/secondPass";
import { materializeAll, rootsOf, stampIds } from "@/firmware/uefi/treeMaterialization";
import {
  flattened,
  type NodeID,
  nodeFileRange,
  ROOT_ID,
  type UEFINode,
} from "@/firmware/uefi/uefiNode";

/**
 * A parsed image: the tree, what was wrong with it, and — once the second pass
 * has run — where in memory it lands.
 *
 * The value a tool keeps and the value it slices ranges out of. Deliberately
 * not the application's business: the shell never sees one, because a tree of
 * thousands of nodes is the tool's model and the handful of ranges worth
 * drawing is all that crosses the seam.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage
 */
export class UEFIImage {
  /**
   * The size the image had when it was parsed. An edit that changes the file's
   * size makes the whole tree stale — which is why a tool re-parses on a
   * content change rather than shifting what it has.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.size
   */
  readonly size: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.roots */
  readonly roots: UEFINode[];
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.diagnostics */
  readonly diagnostics: readonly UEFIDiagnostic[];
  /**
   * `address = offset + addressDiff`, worked out from the Volume Top File.
   * Absent means the VTF was missing or compressed, and then every address in
   * the image is unknowable — not zero, not a guess.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.addressDiff
   */
  readonly addressDiff: number | undefined;
  /**
   * The image's own statement of where it is loaded, when the pass got that far.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.resetVector
   */
  readonly resetVector: ResetVector | undefined;
  /**
   * The Boot Guard and vendor ranges this image names, once something has read
   * them. Nothing means "not read yet", which is not the same as "none".
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.protectedRanges
   */
  readonly protectedRanges: ProtectedRanges | undefined;

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.init */
  constructor(options: {
    readonly size: number;
    readonly roots: UEFINode[];
    readonly diagnostics?: readonly UEFIDiagnostic[];
    readonly addressDiff?: number | undefined;
    readonly resetVector?: ResetVector | undefined;
    readonly protectedRanges?: ProtectedRanges | undefined;
  }) {
    this.size = options.size;
    // Ids are stamped here, at the end, rather than threaded through the
    // parser: a node's place in the tree is not known until its parent has
    // decided to keep it, and a parser carrying counters is a parser that gets
    // them wrong on the paths where it gives up early.
    this.roots = stampIds(options.roots, ROOT_ID);
    this.diagnostics = options.diagnostics ?? [];
    this.addressDiff = options.addressDiff;
    this.protectedRanges = options.protectedRanges;
    this.resetVector = options.resetVector;
  }

  /**
   * Every node, outermost first.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.allNodes
   */
  get allNodes(): UEFINode[] {
    return this.roots.flatMap((root) => flattened(root));
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.node */
  node(id: NodeID): UEFINode | undefined {
    let nodes = this.roots;
    let found: UEFINode | undefined;
    for (const index of id) {
      const next = nodes[index];
      if (next === undefined) return undefined;
      found = next;
      nodes = next.children;
    }
    return found;
  }

  /**
   * The chain of nodes covering `offset`, outermost first — a volume, then the
   * file in it, then the section in that. Empty when the offset falls in a gap
   * nothing claimed, which after a full parse should not happen: everything
   * unparsed is still padding.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.nodes
   */
  nodesContaining(offset: number): UEFINode[] {
    const chain: UEFINode[] = [];
    let nodes = this.roots;
    for (;;) {
      const node = nodes.find((one) => {
        // A node inside a compressed section has offsets into a buffer, not
        // into the file: a chain by file offset stops at the section itself.
        const range = nodeFileRange(one);
        return range !== undefined && offset >= range.start && offset < range.end;
      });
      if (node === undefined) break;
      chain.push(node);
      nodes = node.children;
    }
    return chain;
  }

  /**
   * The innermost node covering `offset` — what a click in the dump means.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.innermostNode
   */
  innermostNodeContaining(offset: number): UEFINode | undefined {
    return this.nodesContaining(offset).at(-1);
  }

  /**
   * The physical address this offset is mapped at, or nothing if the image
   * never told us. Compressed nodes have no meaningful address at all, so
   * callers holding a node should check `isNodeCompressed` before asking.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.address
   */
  addressForOffset(offset: number): number | undefined {
    if (this.addressDiff === undefined || offset >= this.size) return undefined;
    const address = offset + this.addressDiff;
    return Number.isSafeInteger(address) ? address : undefined;
  }

  /**
   * Where a physical address — a FIT entry's, a reset vector's — lands in the
   * file. Nothing when addresses are unknown or when the address is outside
   * this image.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIImage.swift#UEFIImage.offset
   */
  offsetForAddress(address: number): number | undefined {
    if (this.addressDiff === undefined || address < this.addressDiff) return undefined;
    const offset = address - this.addressDiff;
    return offset < this.size ? offset : undefined;
  }
}

/**
 * Parses `source` into a whole tree, every container opened, in one call.
 *
 * The same materialization the lazy tree performs one node at a time, driven
 * straight through instead of on demand: build the top level, open every
 * collapsed node under it, then work out where the image is mapped. There is no
 * second implementation of the parse behind this.
 *
 * Deliberately not what the application uses: opening a 16 MB image this way
 * reads every file body in it, which is exactly the wait the lazy tree exists
 * to remove. What wants a finished tree in one value — this module's own tests,
 * an oracle comparison against UEFITool's output — asks here.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIParser.swift#UEFIParser
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIParser.swift#UEFIParser.parse
 */
export function parseUefiImage(
  source: ByteSource,
  options: {
    readonly limits?: Limits;
    readonly onProgress?: (fraction: number) => void;
    /**
     * The buffers decoded on the way, for a caller that wants to read what a
     * compressed section held after the parse — a test, most often.
     */
    readonly buffers?: DecompressedBuffers;
    /**
     * Reads the Boot Guard and vendor protected ranges and hashes them, which
     * hashes megabytes — so a caller with no use for them says so.
     *
     * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIParser.swift#UEFIParser.parse
     */
    readonly readsProtectedRanges?: boolean;
    /**
     * What the bytes at offset 0 are, where something outside them knows — a
     * part of another image opened on its own.
     *
     * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIParser.swift#UEFIParser.parse
     */
    readonly layout?: UEFIRootLayout;
  } = {}
): UEFIImage {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const reader = new ImageReader(source);
  const sink =
    options.onProgress === undefined
      ? undefined
      : new ProgressSink(reader.count, options.onProgress);

  const built = rootsOf(reader, limits, options.layout ?? IMAGE_LAYOUT, sink);
  const roots = built.nodes;
  const diagnostics = [...built.diagnostics];
  const buffers = options.buffers ?? new DecompressedBuffers();
  materializeAll(roots, reader, limits, buffers, diagnostics, {
    parent: ROOT_ID,
    ...(sink === undefined ? {} : { progress: sink }),
  });

  const parser = new Parser(reader, limits);
  const second =
    roots.length === 0
      ? { addressDiff: undefined, resetVector: undefined }
      : runSecondPass(parser, roots);
  const image = new UEFIImage({
    size: reader.count,
    roots,
    diagnostics: [...diagnostics, ...parser.diagnostics],
    addressDiff: second.addressDiff,
    resetVector: second.resetVector,
  });
  if (options.readsProtectedRanges === false) return image;
  // The ranges are read over the finished tree, and their own complaints join
  // the image's: what the lists say is as much a part of reading an image as
  // what its headers say.
  const ranges = readProtectedRanges(image, reader);
  return new UEFIImage({
    size: image.size,
    roots: image.roots,
    diagnostics: [...image.diagnostics, ...ranges.diagnostics],
    addressDiff: image.addressDiff,
    resetVector: image.resetVector,
    protectedRanges: ranges,
  });
}
