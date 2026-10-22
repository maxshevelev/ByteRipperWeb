import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { readAppleDMIArea } from "@/firmware/uefi/appleDmiArea";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { readHPDMIArea } from "@/firmware/uefi/hpDmiArea";
import { flattened, nodeRange, type UEFINode, type UEFINodeKind } from "@/firmware/uefi/uefiNode";

/**
 * Where an image keeps the board's identity — the serial numbers, the UUID, the
 * model, the Windows key — in a store the tree reads as a row of its own: Lenovo's
 * DMI store (`lenovoDmiStore.ts`), AMI's GPNV store, ASUS's (`gpnvStore.ts`), Acer's DMI
 * area (`acerDmiStore.ts`), Panasonic's (`panasonicDmiStore.ts`), HP's `HP_MUD` variable (`hpDmiArea.ts`), the one store that
 * is an NVRAM entry rather than a row of its own, or Apple's SysF store (`appleDmiArea.ts`), a row
 * of its own but one the tree has for every Mac. What a bench looks for first in a dump,
 * and what can sit several levels down: in padding inside a region, or after a volume's free
 * space.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIStore
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIStore.init
 */
export interface DMIStore {
  /**
   * The row's kind: `lenovoDMIStore`, `gpnvStore`, `acerDMIStore`, `panasonicDMIStore`, or
   * `vssEntry` for HP's
   * `HP_MUD`, `sysFStore` for Apple's.
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
  kind === "lenovoDMIStore" ||
  kind === "gpnvStore" ||
  kind === "acerDMIStore" ||
  kind === "panasonicDMIStore";

/**
 * Every store in `nodes` and below, in file order. Only in the file: none of the formats
 * turns up inside a compressed section. HP's is found only with `reader`: a VSS entry is told
 * for one by its name, and a marked entry's name is in its bytes, not on the node. So is
 * Apple's: a SysF store is one only when it holds the serial or the board's.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIStore.all
 */
export function allDMIStores(nodes: readonly UEFINode[], reader?: ImageReader): DMIStore[] {
  const inFile = nodes.flatMap((node) => flattened(node)).filter((node) => isFileSpace(node.space));
  const rows: DMIStore[] = inFile
    .filter((node) => isDMIStore(node.kind))
    .map((node) => ({ kind: node.kind, range: nodeRange(node) }));
  const hp: DMIStore[] = [];
  if (reader !== undefined) {
    for (const store of inFile) {
      if (store.kind !== "vssStore" && store.kind !== "vss2Store") continue;
      const area = readHPDMIArea(store, reader);
      if (area !== undefined) hp.push({ kind: "vssEntry", range: area.entry });
    }
  }
  // Apple's: a SysF store is one only when it holds the serial or the board's.
  const apple: DMIStore[] = [];
  if (reader !== undefined) {
    for (const store of inFile) {
      if (store.kind !== "sysFStore") continue;
      const area = readAppleDMIArea(store, reader);
      if (area !== undefined) apple.push({ kind: "sysFStore", range: area.store });
    }
  }
  return [...rows, ...hp, ...apple].sort((left, right) => left.range.start - right.range.start);
}
