import type { ByteSource } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import type { UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { DEFAULT_LIMITS, type Limits, Parser, ProgressSink } from "@/firmware/uefi/parserState";
import { type ResetVector, runSecondPass } from "@/firmware/uefi/secondPass";
import { materializeAll, rootsOf, stampIds } from "@/firmware/uefi/treeMaterialization";
import {
  flattened,
  type NodeID,
  nodeRange,
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
 */
export class UEFIImage {
  /**
   * The size the image had when it was parsed. An edit that changes the file's
   * size makes the whole tree stale — which is why a tool re-parses on a
   * content change rather than shifting what it has.
   */
  readonly size: number;
  readonly roots: UEFINode[];
  readonly diagnostics: readonly UEFIDiagnostic[];
  /**
   * `address = offset + addressDiff`, worked out from the Volume Top File.
   * Absent means the VTF was missing or compressed, and then every address in
   * the image is unknowable — not zero, not a guess.
   */
  readonly addressDiff: number | undefined;
  /** The image's own statement of where it is loaded, when the pass got that far. */
  readonly resetVector: ResetVector | undefined;

  constructor(options: {
    readonly size: number;
    readonly roots: UEFINode[];
    readonly diagnostics?: readonly UEFIDiagnostic[];
    readonly addressDiff?: number | undefined;
    readonly resetVector?: ResetVector | undefined;
  }) {
    this.size = options.size;
    // Ids are stamped here, at the end, rather than threaded through the
    // parser: a node's place in the tree is not known until its parent has
    // decided to keep it, and a parser carrying counters is a parser that gets
    // them wrong on the paths where it gives up early.
    this.roots = stampIds(options.roots, ROOT_ID);
    this.diagnostics = options.diagnostics ?? [];
    this.addressDiff = options.addressDiff;
    this.resetVector = options.resetVector;
  }

  /** Every node, outermost first. */
  get allNodes(): UEFINode[] {
    return this.roots.flatMap((root) => flattened(root));
  }

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
   */
  nodesContaining(offset: number): UEFINode[] {
    const chain: UEFINode[] = [];
    let nodes = this.roots;
    for (;;) {
      const node = nodes.find((one) => {
        const range = nodeRange(one);
        return offset >= range.start && offset < range.end;
      });
      if (node === undefined) break;
      chain.push(node);
      nodes = node.children;
    }
    return chain;
  }

  /** The innermost node covering `offset` — what a click in the dump means. */
  innermostNodeContaining(offset: number): UEFINode | undefined {
    return this.nodesContaining(offset).at(-1);
  }

  /**
   * The physical address this offset is mapped at, or nothing if the image
   * never told us. Compressed nodes have no meaningful address at all, so
   * callers holding a node should check `isCompressed` before asking.
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
 */
export function parseUefiImage(
  source: ByteSource,
  options: { readonly limits?: Limits; readonly onProgress?: (fraction: number) => void } = {}
): UEFIImage {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const reader = new ImageReader(source);
  const sink =
    options.onProgress === undefined
      ? undefined
      : new ProgressSink(reader.count, options.onProgress);

  const built = rootsOf(reader, limits, sink);
  const roots = built.nodes;
  const diagnostics = [...built.diagnostics];
  materializeAll(roots, reader, limits, diagnostics, ROOT_ID, sink);

  const parser = new Parser(reader, limits);
  const second =
    roots.length === 0
      ? { addressDiff: undefined, resetVector: undefined }
      : runSecondPass(parser, roots);
  return new UEFIImage({
    size: reader.count,
    roots,
    diagnostics: [...diagnostics, ...parser.diagnostics],
    addressDiff: second.addressDiff,
    resetVector: second.resetVector,
  });
}
