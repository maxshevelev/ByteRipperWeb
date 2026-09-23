import { describe, expect, it } from "vitest";
import { FIT_COLUMNS, fittedColumnWidths } from "@/tools/fit/fitColumns";
import { columnsMinWidth, designWidths } from "@/ui/toolPanel/columnWidths";

/**
 * How the FIT table shares a panel: "Points at" takes what the others leave,
 * and Size and then Type give way once it is at its floor.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.fitColumnsToThePanel
 */

const DESIGN = designWidths(FIT_COLUMNS);
const fitted = (available: number, wanted = DESIGN) =>
  fittedColumnWidths(FIT_COLUMNS, wanted, available);
const total = (widths: Record<string, number>) =>
  FIT_COLUMNS.reduce((sum, column) => sum + (widths[column.id] ?? 0), 0);

/** The width the columns were laid out for, all five together. */
const DESIGN_TOTAL = total(DESIGN);
/** Past this the table is wider than the panel and the list scrolls sideways. */
const FLOOR_TOTAL = columnsMinWidth(FIT_COLUMNS);

describe("the width Points at is drawn at", () => {
  it("takes what the other columns leave, on a panel wider than the design", () => {
    const widths = fitted(DESIGN_TOTAL + 200);

    expect(widths.target).toBe((DESIGN.target ?? 0) + 200);
    // And nothing else moved: the slack is one column's.
    expect(widths.index).toBe(DESIGN.index);
    expect(widths.type).toBe(DESIGN.type);
    expect(widths.address).toBe(DESIGN.address);
    expect(widths.size).toBe(DESIGN.size);
  });

  it("gives way first, down to its own floor", () => {
    const widths = fitted(DESIGN_TOTAL - 100);

    expect(widths.target).toBe((DESIGN.target ?? 0) - 100);
    expect(widths.size).toBe(DESIGN.size);
    expect(widths.type).toBe(DESIGN.type);
  });
});

describe("the columns that give way after it", () => {
  /** The panel at which "Points at" has just reached its floor. */
  const atTheFloor = DESIGN_TOTAL - ((DESIGN.target ?? 0) - 96);

  it("are still whole while Points at can take the squeeze alone", () => {
    const widths = fitted(atTheFloor);

    expect(widths.target).toBe(96);
    expect(widths.size).toBe(DESIGN.size);
    expect(widths.type).toBe(DESIGN.type);
    expect(total(widths)).toBe(atTheFloor);
  });

  it("are Size and then Type, in that order", () => {
    // Twenty-two past the point where "Points at" ran out: Size alone covers it.
    const squeezed = fitted(atTheFloor - 22);
    expect(squeezed.target).toBe(96);
    expect(squeezed.size).toBe((DESIGN.size ?? 0) - 22);
    expect(squeezed.type).toBe(DESIGN.type);

    // Past Size's own floor, and Type starts to give.
    const further = fitted(atTheFloor - 72);
    expect(further.size).toBe(48);
    expect(further.type).toBe((DESIGN.type ?? 0) - 21);
    expect(further.target).toBe(96);
    expect(total(further)).toBe(atTheFloor - 72);
  });

  it("never take the row number or the address with them", () => {
    const widths = fitted(200);

    expect(widths.index).toBe(DESIGN.index);
    expect(widths.address).toBe(DESIGN.address);
  });
});

describe("a panel narrower than every floor", () => {
  // There is nothing left to give, so the table is wider than the panel and the
  // list scrolls sideways — which is the one case where it does.
  it("gets the floors, and the row stays wider than it", () => {
    const widths = fitted(FLOOR_TOTAL - 80);

    expect(widths).toEqual({ index: 24, type: 64, address: 90, size: 48, target: 96 });
    expect(total(widths)).toBe(FLOOR_TOTAL);
  });
});

describe("a column the reader dragged", () => {
  // The width a reader chose is the one a squeezed column comes back to, which
  // is what upstream's `wantedWidths` remembers.
  it("is what it comes back to when the panel grows again", () => {
    const wanted = { ...DESIGN, size: 160 };
    const wide = DESIGN_TOTAL - (DESIGN.size ?? 0) + 160;

    // Squeezed past its floor by a narrow panel…
    const narrow = fitted(FLOOR_TOTAL - 10, wanted);
    expect(narrow.size).toBe(48);

    // …and back to the reader's own width the moment there is room.
    expect(fitted(wide, wanted).size).toBe(160);
    expect(fitted(wide, wanted).target).toBe(DESIGN.target);
  });
});
