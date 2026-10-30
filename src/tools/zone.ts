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
// Upstream's book carried a page about the zones' one user, the Zone Sketch
// panel, and the panel's module anchored it. This app does not offer that
// panel (upstream's debug-only demonstration, an `n/a` in the module map), and
// an anchor is a promise that the book explains a thing the user can reach —
// so the shared type carries no anchor of its own.
export interface Zone {
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.id */
  readonly id: string;
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.name */
  readonly name: string;
  /**
   * Half-open `[start, end)`, the application's convention throughout: the
   * zone's one stretch, or the span of its stretches when it has several —
   * which claims the bytes between them too, so it orders and nests zones and
   * is never read as the zone's bytes.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.range
   */
  readonly start: number;
  readonly end: number;
  /**
   * The stretches of the file the zone is, where the firmware scattered its
   * bytes — an MFS file is a chain of chunks spread over the volume's pages.
   * In the owner's order: for a file, the order its bytes are read in, which is
   * not address order. Disjoint, each inside `[start, end)`. Absent for a zone
   * of one stretch, which is `[start, end)` itself ({@link zoneStretches}).
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.ranges
   * @upstream-differs a zone of one stretch keeps the shape it had, so the publishers of one range — every one but the ME file rows — say nothing new
   */
  readonly stretches?: readonly ZoneStretch[] | undefined;
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

/** One stretch of a zone's bytes, half-open. */
export interface ZoneStretch {
  readonly start: number;
  readonly end: number;
}

/**
 * A zone of several stretches, in the owner's order; its `[start, end)` is
 * their span. One stretch is a zone like any other.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.init
 */
export function scatteredZone(id: string, name: string, stretches: readonly ZoneStretch[]): Zone {
  const first = stretches[0];
  if (first === undefined) return { id, name, start: 0, end: 0 };
  if (stretches.length === 1) return { id, name, start: first.start, end: first.end };
  return {
    id,
    name,
    start: Math.min(...stretches.map((one) => one.start)),
    end: Math.max(...stretches.map((one) => one.end)),
    stretches,
  };
}

/** The zone's stretches in the owner's order: `[start, end)` alone for a zone of one. */
export function zoneStretches(zone: Zone): readonly ZoneStretch[] {
  return zone.stretches ?? [{ start: zone.start, end: zone.end }];
}

/**
 * Where the zone begins for a reader: the first byte of its first stretch in
 * the owner's order — where a reveal or a focus takes the dump.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.start
 */
export function zoneStart(zone: Zone): number {
  return zone.stretches?.[0]?.start ?? zone.start;
}

/**
 * True when the zone is more than one stretch.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.isScattered
 */
export function isScatteredZone(zone: Zone): boolean {
  return (zone.stretches?.length ?? 1) > 1;
}

/**
 * The stretch `offset` lies in, undefined for a byte between two stretches.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#Zone.stretch
 */
export function zoneStretchContaining(zone: Zone, offset: number): ZoneStretch | undefined {
  return zoneStretches(zone).find((one) => offset >= one.start && offset < one.end);
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
 * rejection, stretch by stretch — a stretch reaching past the end is clamped,
 * one starting at or past it is dropped, an empty one is dropped — and a zone
 * left with no stretch is dropped, a repeated id is dropped after its first
 * use, and a focus naming nothing that survived is cleared.
 *
 * Overlap is not an error: zones nest. The order is the drawing order — by
 * start, the longer first for a shared start, then by id; a scattered zone by
 * its span, its stretches keeping the owner's order — so the result is the
 * same whatever order the zones arrived in.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#ZoneMap.normalized
 */
export function normalizedZones(map: ZoneMap, contentSize: number): ZoneMap {
  const seen = new Set<string>();
  const kept: Zone[] = [];
  for (const zone of map.zones) {
    const stretches = zoneStretches(zone)
      .filter((one) => one.start < one.end && one.start < contentSize)
      .map((one) => ({ start: one.start, end: Math.min(one.end, contentSize) }));
    if (stretches.length === 0) continue;
    if (seen.has(zone.id)) continue;
    seen.add(zone.id);
    kept.push({ ...zone, stretches: undefined, ...scatteredZone(zone.id, zone.name, stretches) });
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
 * aiming at. By the stretches, not the span: the gap between two chunks of a
 * file is not the file.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/Zone.swift#ZoneMap.zones
 */
export function zonesContaining(map: ZoneMap, offset: number): Zone[] {
  return map.zones
    .filter((zone) => zoneStretchContaining(zone, offset) !== undefined)
    .sort((left, right) => right.end - right.start - (left.end - left.start));
}
