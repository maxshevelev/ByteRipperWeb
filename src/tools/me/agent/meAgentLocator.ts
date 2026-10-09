import { idText } from "@/tools/me/agent/meAgentAnswers";
import type { MEANode } from "@/tools/meaTree";
import type { ToolAgentPlace } from "@/tools/toolAgent";

/**
 * Where ranges of the ME region are in the structure the ME engine decoded, for answers that are
 * not the module's own — the runs a byte comparison found (`ToolAgentLocator`).
 *
 * Finer than the UEFI tree inside the ME region, so it wins there (`precedence` 1). The areas are
 * the partition table's entries — of the top groups of `me_tree`, the one whose rows with bytes
 * cover the most of the file. A range is placed in the area that covers it and at the smallest node
 * of the whole tree that covers it whole. Inside a file system it goes one further: an MFS or EFS
 * file has no one range, its bytes are scattered over the volume's pages, so a range is placed at
 * the file when that file is the only one whose stored bytes it touches — what else it touches is
 * the volume's own bookkeeping, a chunk's CRC or a page's header. Nothing is analysed for a range
 * outside the ME region, nor for a file with none.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentLocator.swift#MEAAgentLocator
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentLocator.swift#MEAAgentLocator.locator
 */

type Span = { readonly start: number; readonly end: number };

/**
 * The partition table's rows: of the top groups, the one whose rows with bytes cover the most,
 * those rows in address order, an overlapping one left out.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentLocator.swift#MEAAgentLocator.areas
 */
export function areasIn(roots: readonly MEANode[]): MEANode[] {
  const rows = (group: MEANode) => group.children.filter((one) => one.range !== undefined);
  const size = (node: MEANode) =>
    node.range === undefined ? 0 : node.range.end - node.range.start;
  const coverage = (group: MEANode) => rows(group).reduce((sum, one) => sum + size(one), 0);
  let table: MEANode | undefined;
  for (const group of roots) {
    if (table === undefined || coverage(group) > coverage(table)) table = group;
  }
  if (table === undefined || coverage(table) === 0) return [];
  const result: MEANode[] = [];
  const sorted = [...rows(table)].sort(
    (one, two) => (one.range?.start ?? 0) - (two.range?.start ?? 0)
  );
  for (const row of sorted) {
    if (row.range === undefined || size(row) === 0) continue;
    const last = result.at(-1);
    if (last?.range !== undefined && last.range.end > row.range.start) continue;
    result.push(row);
  }
  return result;
}

/**
 * The file rows' stretches in address order, so a range finds the files it touches without a pass
 * over every chunk of every file.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentLocator.swift#MEAAgentLocator.FileIndex
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentLocator.swift#MEAAgentLocator.FileIndex.init
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentLocator.swift#MEAAgentLocator.FileIndex.only
 */
export class FileIndex {
  private readonly stretches: { readonly range: Span; readonly file: number }[];
  private readonly files: readonly MEANode[];

  constructor(files: readonly MEANode[]) {
    this.files = files;
    this.stretches = files
      .flatMap((file, index) => (file.extents ?? []).map((range) => ({ range, file: index })))
      .sort((one, two) => one.range.start - two.range.start);
  }

  /** The one file whose stretches `range` overlaps; nothing when it touches none, or more than one. */
  only(range: Span): MEANode | undefined {
    let low = 0;
    let high = this.stretches.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((this.stretches[mid]?.range.end ?? 0) <= range.start) low = mid + 1;
      else high = mid;
    }
    // Stretches never overlap, so from the first one ending after the range starts, every one that
    // starts before it ends is touched.
    let found: number | undefined;
    for (const stretch of this.stretches.slice(low)) {
      if (stretch.range.start >= range.end) break;
      if (!(stretch.range.start < range.end && range.start < stretch.range.end)) continue;
      if (found !== undefined && found !== stretch.file) return undefined;
      found = stretch.file;
    }
    return found === undefined ? undefined : this.files[found];
  }
}

const flattened = (nodes: readonly MEANode[]): MEANode[] =>
  nodes.flatMap((one) => [one, ...flattened(one.children)]);

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentLocator.swift#MEAAgentLocator.place */
export const placeOf = (node: MEANode): ToolAgentPlace => ({
  kind: "me",
  id: idText(node.path),
  name: node.title,
  range: node.range,
});

/**
 * Each range placed in the ME structure: the area that covers it and the smallest node that covers
 * it whole; nothing for a range outside the ME region.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentLocator.swift#MEAAgentLocator.locator
 */
export function locateRanges(
  roots: readonly MEANode[],
  region: Span,
  ranges: readonly Span[]
): ToolAgentPlace[][] {
  const overlaps = (range: Span, other: Span) => range.start < other.end && other.start < range.end;
  const areas = areasIn(roots);
  const all = flattened(roots);
  const nodes = all.filter((one) => one.range !== undefined);
  const files = new FileIndex(all.filter((one) => (one.extents?.length ?? 0) > 0));
  const size = (node: MEANode) =>
    node.range === undefined ? 0 : node.range.end - node.range.start;
  return ranges.map((range) => {
    if (!overlaps(range, region)) return [];
    const covering = nodes.filter(
      (one) =>
        one.range !== undefined && one.range.start <= range.start && range.end <= one.range.end
    );
    let deepest: MEANode | undefined;
    for (const one of covering) {
      if (
        deepest === undefined ||
        size(one) < size(deepest) ||
        (size(one) === size(deepest) && one.path.length > deepest.path.length)
      ) {
        deepest = one;
      }
    }
    if (deepest === undefined) return [];
    // The file, when the range stays inside the partition the file is in: a run past it touches the
    // file and much besides.
    const file = files.only(range);
    const extents = file?.extents;
    if (file !== undefined && extents !== undefined && extents.length > 0) {
      const lower = Math.min(...extents.map((one) => one.start));
      const upper = Math.max(...extents.map((one) => one.end));
      let home: MEANode | undefined;
      for (const one of nodes) {
        if (one.range === undefined || !(one.range.start <= lower && upper <= one.range.end))
          continue;
        if (home === undefined || size(one) < size(home)) home = one;
      }
      if (
        home?.range !== undefined &&
        home.range.start <= range.start &&
        range.end <= home.range.end
      ) {
        deepest = file;
      }
    }
    const placed = deepest;
    const area = areas.find(
      (one) =>
        one.range !== undefined && one.range.start <= range.start && range.end <= one.range.end
    );
    if (area !== undefined && idText(area.path) !== idText(placed.path)) {
      return [placeOf(area), placeOf(placed)];
    }
    return [placeOf(placed)];
  });
}
