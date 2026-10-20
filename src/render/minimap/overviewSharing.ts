import type { DiffBlockIndex } from "@/core/diff/diffBlock";
import { MINIMAP_COLUMNS, OverviewBinning } from "@/render/minimap/overviewBinning";

/**
 * Which file bins each row of a comparison's overview: the first (0) or the second (1) for a row
 * the comparison index calls the same in both — its density is then copied to the other — and
 * nothing for a row each file bins itself (§19.9). The first half of the shared rows go to the
 * first file and the rest to the second, so each reads one contiguous stretch of them and the pass
 * takes about half as long.
 *
 * The index has to describe these files, not ones they used to be: a size that disagrees means it
 * does not, and nothing is shared.
 *
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.overviewSummaries
 */
export function shareOverviewRows(
  index: DiffBlockIndex,
  sizes: readonly [number, number],
  extent: number,
  rowCount: number
): (0 | 1 | undefined)[] | undefined {
  const [left, right] = sizes;
  if (rowCount <= 0 || extent <= 0 || index.maxSize !== extent) return undefined;
  const indexed = [index.leftSize, index.rightSize].sort((a, b) => a - b);
  const given = [left, right].sort((a, b) => a - b);
  if (indexed[0] !== given[0] || indexed[1] !== given[1]) return undefined;
  const same = new OverviewBinning(extent, rowCount).rowsWithSameBytes(index, {
    from: 0,
    to: rowCount,
  });
  const half = Math.floor(same.filter(Boolean).length / 2);
  let seen = 0;
  return same.map((shared) => {
    if (!shared) return undefined;
    const owner = seen < half ? 0 : 1;
    seen += 1;
    return owner;
  });
}

/**
 * Hands each shared row to the file that skipped it: its density copied from the file that read
 * it. Modified and difference marks stay per file — an edit can paint a byte red in one file that
 * the other holds unchanged — and are not in the density.
 *
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.overviewSummaries
 */
export function copySharedRows(
  owners: readonly (0 | 1 | undefined)[],
  densities: readonly [Uint8Array, Uint8Array]
): void {
  owners.forEach((owner, row) => {
    if (owner === undefined) return;
    const from = densities[owner];
    const to = densities[owner === 0 ? 1 : 0];
    const cells = row * MINIMAP_COLUMNS;
    to.set(from.subarray(cells, cells + MINIMAP_COLUMNS), cells);
  });
}
