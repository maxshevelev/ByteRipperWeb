/**
 * What a tool asks the application to draw.
 *
 * A tool's model is thousands of nodes; the handful of ranges worth drawing is
 * all that crosses the seam. A zone is one of those: a named range the shell
 * can mark in the minimap's margin, offer in the dump's right-click menu, and
 * put the caret on — without knowing what a volume or a FIT row is.
 *
 * Ids are the tool's own and are stable across a re-read, which is what lets a
 * zone survive being written down: the panel publishes a fresh map after every
 * edit, and the focus still names the same thing.
 */

/**
 * What a zone *is*, as opposed to what it is called.
 *
 * One case for now, on purpose: see `Zone.kind`. A union of string tags rather
 * than a TypeScript `enum`, as the other ported Swift enums here are.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#ZoneKind
 */
export type ZoneKind = "plain";

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone */
export interface Zone {
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.id */
  readonly id: string;
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.name */
  readonly name: string;
  /**
   * Half-open `[start, end)`, the application's convention throughout.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.range
   */
  readonly start: number;
  readonly end: number;
  /**
   * Reserved. The uses are real — protected by Boot Guard, padding, an empty
   * slot, a region open for editing — and each of them wants a tool that has
   * something to say first. Nothing reads it yet, which is why every zone
   * published today is `plain` and the default keeps a construction site from
   * having to say so.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.kind
   */
  readonly kind?: ZoneKind;
}

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#ZoneMap */
export interface ZoneMap {
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#ZoneMap.zones */
  readonly zones: readonly Zone[];
  /**
   * The one the panel is looking at, drawn louder than the rest.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#ZoneMap.focus
   */
  readonly focus: string | undefined;
}

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#ZoneMap.empty */
export const EMPTY_ZONES: ZoneMap = { zones: [], focus: undefined };

/**
 * The map as the dump can actually draw it, against a file of `contentSize`
 * bytes.
 *
 * A published map can disagree with the file, and the ordinary way it happens
 * is not a bug in the tool: an edit lands, the map is a re-read behind, and
 * something asks to draw in between. So this is a repair rather than a
 * rejection — a zone reaching past the end is clamped, one starting at or past
 * it is dropped, an empty one is dropped, a repeated id is dropped after its
 * first use, and a focus naming nothing that survived is cleared.
 *
 * Overlap is not an error: zones nest. The order is the drawing order — by
 * start, the longer first for a shared start, then by id — so the result is
 * the same whatever order the zones arrived in.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#ZoneMap.normalized
 */
export function normalizedZones(map: ZoneMap, contentSize: number): ZoneMap {
  const seen = new Set<string>();
  const kept: Zone[] = [];
  for (const zone of map.zones) {
    if (zone.start >= zone.end) continue;
    if (zone.start >= contentSize) continue;
    if (seen.has(zone.id)) continue;
    seen.add(zone.id);
    kept.push({ ...zone, end: Math.min(zone.end, contentSize) });
  }
  kept.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    if (left.end !== right.end) return right.end - left.end;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  const focus = kept.some((zone) => zone.id === map.focus) ? map.focus : undefined;
  return { zones: kept, focus };
}

/**
 * The zones covering `offset`, innermost last.
 *
 * Zones nest — a FIT table, the row in it, the microcode a row points at — so
 * a byte is often inside several, and the smallest is the one a click is
 * aiming at.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#ZoneMap.zones
 */
export function zonesContaining(map: ZoneMap, offset: number): Zone[] {
  return map.zones
    .filter((zone) => offset >= zone.start && offset < zone.end)
    .sort((left, right) => right.end - right.start - (left.end - left.start));
}
