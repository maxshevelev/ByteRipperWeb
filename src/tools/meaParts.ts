import { L } from "@/core/localization/localization";
import { CopyPartCodec, GatherPartCodec, type PartCodec } from "@/core/parts/partCodec";
import type { MEANode } from "@/tools/meaTree";

/**
 * What a row of the ME tree opens as in a fragment panel — a double-click on it,
 * in the ME Analyzer and in the UEFI Structure's ME branch alike.
 *
 * A row with one range opens as a copy of those bytes. An MFS or EFS file opens
 * as its chunks gathered in the file's order (`GatherPartCodec`) — the stored
 * chain, Integrity table included — and goes back to the same places. A row
 * without bytes of its own, and an empty file, opens nothing.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAParts.swift#MEAParts
 */
export interface MEAPartOpen {
  /**
   * The fragment's name: the row's title, a file's last path component.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAParts.swift#MEAParts.Open.name
   */
  readonly name: string;
  /**
   * What the fragment is linked to in the dump — a scattered file's span.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAParts.swift#MEAParts.Open.source
   */
  readonly source: readonly [number, number];
  /** @upstream Packages/MEPresentation/Sources/MEPresentation/MEAParts.swift#MEAParts.Open.codec */
  readonly codec: PartCodec;
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEAParts.swift#MEAParts.open */
export function meaPartOpen(node: MEANode): MEAPartOpen | undefined {
  const name = partName(node.title);
  if (node.range !== undefined && node.range.start < node.range.end) {
    return { name, source: [node.range.start, node.range.end], codec: new CopyPartCodec() };
  }
  const extents = (node.extents ?? []).filter((one) => one.start < one.end);
  const [first] = extents;
  if (first === undefined) return undefined;
  if (extents.length === 1) {
    return { name, source: [first.start, first.end], codec: new CopyPartCodec() };
  }
  return {
    name,
    source: [
      Math.min(...extents.map((one) => one.start)),
      Math.max(...extents.map((one) => one.end)),
    ],
    codec: new GatherPartCodec(extents.map((one) => [one.start, one.end] as const)),
  };
}

/**
 * A file's row is titled by its path — `/home/mctp/smt2_devices` — and a
 * fragment is named as it would be saved: the last component.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAParts.swift#MEAParts.partName
 */
function partName(title: string): string {
  const last =
    title
      .split("/")
      .filter((one) => one.length > 0)
      .pop() ?? title;
  return last.length === 0 ? L("(unnamed)") : last;
}
