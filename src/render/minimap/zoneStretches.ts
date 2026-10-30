/**
 * The zones as the gutter brackets them: one bracket per stretch, all under the
 * zone's id, so the gutter marks where a scattered zone's bytes are and never
 * the span between them.
 *
 * Each stretch's depth is how many stretches of *other* zones contain it — the
 * lane its bracket steps into — so a file's chunks nest in the volume around
 * them, and two chunks of one file never nest in each other. In address order,
 * the outer one first for a shared start, so the brackets come out the way the
 * gutter reads them, top to bottom.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.brackets
 */
export function zoneStretchBrackets<
  Z extends {
    readonly id: string;
    readonly start: number;
    readonly end: number;
    readonly stretches?: readonly { readonly start: number; readonly end: number }[] | undefined;
  },
>(
  zones: readonly Z[]
): { readonly zone: Z; readonly start: number; readonly end: number; readonly depth: number }[] {
  const stretches = zones.flatMap((zone) =>
    (zone.stretches ?? [zone]).map((one) => ({ zone, start: one.start, end: one.end }))
  );
  // Stable, so zones of one stretch keep the map's order.
  if (zones.some((zone) => (zone.stretches?.length ?? 1) > 1)) {
    stretches.sort((left, right) =>
      left.start !== right.start ? left.start - right.start : right.end - left.end
    );
  }
  return stretches.map((stretch) => ({
    ...stretch,
    depth: stretches.filter(
      (other) =>
        other.zone.id !== stretch.zone.id &&
        other.start <= stretch.start &&
        other.end >= stretch.end
    ).length,
  }));
}
