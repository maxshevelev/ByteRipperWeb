import type { ImageRange } from "@/firmware/imageReader";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { flattened, nodeRange, type UEFINode, type UEFINodeKind } from "@/firmware/uefi/uefiNode";

/**
 * Where an image keeps the board's identity — the serial numbers, the UUID, the
 * model, the Windows key — in a store the tree reads as a row of its own: Lenovo's
 * DMI store (`lenovoDmiStore.ts`), AMI's GPNV store, ASUS's (`gpnvStore.ts`), or Acer's
 * DMI area (`acerDmiStore.ts`). What a bench looks for first in a dump, and what can sit
 * several levels down: in padding inside a region, or after a volume's free space.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIStore
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIStore.init
 */
export interface DMIStore {
  /**
   * The row's kind: `lenovoDMIStore`, `gpnvStore` or `acerDMIStore`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIStore.kind
   */
  readonly kind: UEFINodeKind;
  /**
   * Where the row is in the file — what tells the row apart from the others of its
   * kind on the way to it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIStore.range
   */
  readonly range: ImageRange;
}

/**
 * The kinds that are one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIStore.isStore
 */
export const isDMIStore = (kind: string): boolean =>
  kind === "lenovoDMIStore" || kind === "gpnvStore" || kind === "acerDMIStore";

/**
 * Every store in `nodes` and below, in file order. Only in the file: none of the formats
 * turns up inside a compressed section.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIStore.all
 */
export function allDMIStores(nodes: readonly UEFINode[]): DMIStore[] {
  return nodes
    .flatMap((node) => flattened(node))
    .filter((node) => isDMIStore(node.kind) && isFileSpace(node.space))
    .map((node) => ({ kind: node.kind, range: nodeRange(node) }))
    .sort((left, right) => left.range.start - right.range.start);
}
