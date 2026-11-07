import { describe, expect, it } from "vitest";
import { FIT_COLUMNS, FIT_MIN_WIDTH, fittedColumnWidths } from "@/tools/fit/fitColumns";
import { designWidths } from "@/ui/toolPanel/columnWidths";

/**
 * How the FIT table shares a panel: its one column, Type, takes the panel's
 * width, down to its floor.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.fitColumnsToThePanel
 */

const DESIGN = designWidths(FIT_COLUMNS());
const fitted = (available: number) => fittedColumnWidths(FIT_COLUMNS(), DESIGN, available);

describe("the FIT table's column", () => {
  // @upstream ByteRipperTests/FITToolFlowTests.swift#FITToolFlowTests.testTheColumnTakesThePanelsWidth
  // @upstream ByteRipperTests/FITToolFlowTests.swift#FITToolFlowTests.testTheTableKeepsInsideItsScrollView
  it("is the one column, and takes the panel's width down to its floor", () => {
    // The type and what the entry points at, on one line; the number, the
    // address and the size are the detail's.
    expect(FIT_COLUMNS().map((column) => column.title)).toEqual(["Type"]);
    expect(fitted(700).type).toBe(700);
    expect(fitted(600).type).toBe(600);
    expect(fitted(700).type).toBe(700);
    // Below the floor the table stays that wide and the list scrolls sideways.
    expect(fitted(60).type).toBe(FIT_MIN_WIDTH);
  });
});
