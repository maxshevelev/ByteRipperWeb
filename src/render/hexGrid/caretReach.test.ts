/**
 * How far the caret's ink reaches.
 *
 * The overwrite bar is an underline that deliberately runs past the bottom of
 * its own row, so the rows it dirties are not the row it is in. Getting this
 * short leaves a stub of a rule under every row the caret has visited — the
 * same class of defect the mirrored contour had, for the same reason.
 */

import { expect, it } from "vitest";
import { caretRowReach } from "@/render/hexGrid/hexGridRenderer";
import { BYTES_PER_ROW } from "@/render/hexGrid/hexLayout";

it("reaches the row below, where the bar's overhang lands", () => {
  expect(caretRowReach(0, 17)).toEqual({ first: 0, end: 2 });
  expect(caretRowReach(3 * BYTES_PER_ROW + 5, 17)).toEqual({ first: 3, end: 5 });
});

it("reaches further when the rows are shorter than the overhang", () => {
  // A pathological layout rather than a real one, but the reach is derived
  // from the bar's geometry so that it cannot be outgrown quietly.
  expect(caretRowReach(0, 1).end).toBeGreaterThan(2);
});

it("never asks for a row above the caret's own", () => {
  expect(caretRowReach(0, 17).first).toBe(0);
});
