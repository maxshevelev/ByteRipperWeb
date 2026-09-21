import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { hasSections } from "@/firmware/uefi/fileParser";
import { ffsVersionOfFileSystem } from "@/firmware/uefi/knownGuids";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeFileRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * What the bytes at offset 0 of a source are, when that is known from outside
 * them — a part of another image opened on its own
 * (`Design/UEFI/UPDATE_IN_PARENT.md` §2.1).
 *
 * A whole image announces itself: a capsule GUID, a descriptor signature, the
 * volumes a scan finds. A part cut out of one does not always: the body of a
 * Tiano or LZMA section is a run of sections, and a signature scan reads it as
 * padding. The tree that parsed the whole knew what the part was, so it says.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout
 * @upstream-differs a tagged union rather than an enum with payloads, as the
 * other ported Swift enums here are
 */
export type UEFIRootLayout =
  /**
   * Whatever the bytes announce — the default, and the answer for a whole image
   * or for a part that is none of the others.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.image
   */
  | { readonly kind: "image" }
  /**
   * One firmware volume at offset 0.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.volume
   */
  | { readonly kind: "volume" }
  /**
   * One FFS file at offset 0, read by the rules of the volume it came from.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.file
   */
  | { readonly kind: "file"; readonly ffsVersion: number; readonly volumeRevision: number }
  /**
   * A run of sections from offset 0: a file's body, one section, or what a
   * compressed section decompressed to.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.sections
   */
  | { readonly kind: "sections"; readonly ffsVersion: number };

/** The layout a whole image is read with, and the fallback for anything else. */
export const IMAGE_LAYOUT: UEFIRootLayout = { kind: "image" };

/**
 * What a compressed section decompresses to: sections, by the FFSv3 rules every
 * buffer is read with (`COMPRESSED_SECTIONS.md` §6.1).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.decompressedBody
 */
export const DECOMPRESSED_BODY_LAYOUT: UEFIRootLayout = { kind: "sections", ffsVersion: 3 };

/** Whether two layouts say the same thing. */
export function sameLayout(left: UEFIRootLayout, right: UEFIRootLayout): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "sections" && right.kind === "sections") {
    return left.ffsVersion === right.ffsVersion;
  }
  if (left.kind === "file" && right.kind === "file") {
    return left.ffsVersion === right.ffsVersion && left.volumeRevision === right.volumeRevision;
  }
  return true;
}

/**
 * What `node`'s bytes, header through tail, are when opened as a root.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.of
 */
export function layoutOf(node: UEFINode, image: UEFIImage): UEFIRootLayout {
  switch (node.kind) {
    case "volume":
      return { kind: "volume" };
    case "file": {
      const volume = enclosingVolume(node, image);
      return {
        kind: "file",
        ffsVersion: ffsVersionOf(node, volume),
        volumeRevision: volume?.subtype ?? 2,
      };
    }
    case "section":
      return { kind: "sections", ffsVersion: ffsVersionOf(node, enclosingVolume(node, image)) };
    default:
      return IMAGE_LAYOUT;
  }
}

/**
 * What `node`'s body alone is when opened as a root: a sectioned file's body,
 * and an encapsulation section's that is not compressed, are runs of sections.
 * Any other body stands on its own only as bytes.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.ofBody
 */
export function layoutOfBody(node: UEFINode, image: UEFIImage): UEFIRootLayout {
  const version = ffsVersionOf(node, enclosingVolume(node, image));
  if (node.kind === "file" && node.subtype !== undefined && hasSections(node.subtype)) {
    return { kind: "sections", ffsVersion: version };
  }
  const openedInPlace =
    node.kind === "section" &&
    node.compression === undefined &&
    node.children.some((child) => sameSpace(child.space, node.space));
  return openedInPlace ? { kind: "sections", ffsVersion: version } : IMAGE_LAYOUT;
}

/**
 * What the bytes at `range` of the file are, from the innermost node that
 * covers exactly that range — or whose body does. An image when no node the
 * tree has materialised does.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.forFileRange
 */
export function layoutForFileRange(
  range: readonly [number, number],
  image: UEFIImage
): UEFIRootLayout {
  const nodes = image.allNodes;
  const whole = lastWhere(nodes, (node) => {
    const own = nodeFileRange(node);
    return own !== undefined && own.start === range[0] && own.end === range[1];
  });
  if (whole !== undefined) return layoutOf(whole, image);
  const body = lastWhere(
    nodes,
    (node) =>
      isFileSpace(node.space) &&
      node.header.end > node.header.start &&
      node.body.start === range[0] &&
      node.body.end === range[1]
  );
  return body === undefined ? IMAGE_LAYOUT : layoutOfBody(body, image);
}

const lastWhere = <T>(items: readonly T[], matches: (item: T) => boolean): T | undefined => {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item !== undefined && matches(item)) return item;
  }
  return undefined;
};

const sameSpace = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((offset, index) => offset === right[index]);

/**
 * The volume a node's bytes are laid out in, in the node's own space: nothing
 * for a node inside a buffer with no volume of its own around it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.enclosingVolume
 */
function enclosingVolume(node: UEFINode, image: UEFIImage): UEFINode | undefined {
  const path = [...node.id];
  while (path.length > 0) {
    path.pop();
    const ancestor = image.node(path);
    if (ancestor === undefined) continue;
    if (!sameSpace(ancestor.space, node.space)) return undefined;
    if (ancestor.kind === "volume") return ancestor;
  }
  return undefined;
}

/**
 * The FFS rules the node is read by: its volume's file system, or FFSv3 inside
 * a buffer, or FFSv2 when neither says.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout.ffsVersion
 */
function ffsVersionOf(node: UEFINode, volume: UEFINode | undefined): number {
  const guid = volume?.guid;
  const version = guid === undefined ? undefined : ffsVersionOfFileSystem(guid);
  if (version !== undefined) return version;
  return isFileSpace(node.space) ? 2 : 3;
}
