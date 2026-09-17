import { describe, expect, it } from "vitest";
import {
  boundaryTarget,
  clampColumnWidth,
  columnsMinWidth,
  columnTemplate,
  designWidths,
  draggedWidth,
  type TableColumn,
} from "@/ui/toolPanel/columnWidths";

/**
 * The columns of a panel's table — their widths, their floors, and which one
 * takes the panel's spare width. Upstream's rules, checked as arithmetic: what
 * a table's template says, and which column a boundary drag moves.
 */

/** The ME tree's two columns: Name fixed, values taking the slack. */
const ME: readonly TableColumn[] = [
  { id: "name", title: "Name", width: 300, min: 150 },
  { id: "values", title: "", width: 150, min: 150, grows: true },
];

/** The UEFI tree's three: Name takes the slack, the other two give way. */
const UEFI: readonly TableColumn[] = [
  { id: "name", title: "Name", width: 300, min: 200, grows: true },
  { id: "type", title: "Type", width: 76, min: 56 },
  { id: "subtype", title: "Subtype", width: 88, min: 64 },
];

describe("clampColumnWidth", () => {
  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable.scaleColumnWidths
  it("holds a width between the column's floor and the table's ceiling", () => {
    const column = ME[0] as TableColumn;
    expect(clampColumnWidth(40, column)).toBe(150);
    expect(clampColumnWidth(420, column)).toBe(420);
    expect(clampColumnWidth(90_000, column)).toBe(2000);
    expect(clampColumnWidth(Number.NaN, column)).toBe(300);
    expect(clampColumnWidth(310.6, column)).toBe(311);
  });
});

describe("columnTemplate", () => {
  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
  it("lets the growing column take the rest, and the others their width", () => {
    expect(columnTemplate(designWidths(ME), ME)).toBe("minmax(150px, 300px) minmax(150px, 1fr)");
    expect(columnTemplate(designWidths(UEFI), UEFI)).toBe(
      "minmax(200px, 1fr) minmax(56px, 76px) minmax(64px, 88px)"
    );
  });

  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
  it("follows a width the reader dragged", () => {
    expect(columnTemplate({ ...designWidths(ME), name: 420 }, ME)).toBe(
      "minmax(150px, 420px) minmax(150px, 1fr)"
    );
  });

  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
  it("clamps what it is given, so a stored width cannot escape its column", () => {
    expect(columnTemplate({ name: 5, values: 150 }, ME)).toBe(
      "minmax(150px, 150px) minmax(150px, 1fr)"
    );
  });

  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
  it("ignores the design width of the column that grows", () => {
    // The growing column is as wide as the panel leaves it; its `width` is only
    // what a reset hands back, so moving it changes nothing on its own.
    expect(columnTemplate({ ...designWidths(ME), values: 900 }, ME)).toBe(
      "minmax(150px, 300px) minmax(150px, 1fr)"
    );
  });
});

describe("columnsMinWidth", () => {
  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
  it("adds the floors up, for the row a scroller scrolls", () => {
    expect(columnsMinWidth(ME)).toBe(300);
    expect(columnsMinWidth(UEFI)).toBe(320);
  });
});

describe("which column a boundary drag moves", () => {
  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
  it("resizes the column on the left of the boundary", () => {
    expect(boundaryTarget(ME, 0)).toEqual({ id: "name", sign: 1 });
    expect(boundaryTarget(UEFI, 1)).toEqual({ id: "type", sign: 1 });
  });

  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
  it("takes from the neighbour when the column on the left is the one that grows", () => {
    // UEFI's Name takes the slack, so the boundary after it moves the fixed
    // column: pulling right widens Name by narrowing Type, which is the same
    // boundary moving the same way.
    expect(boundaryTarget(UEFI, 0)).toEqual({ id: "type", sign: -1 });
  });

  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
  it("is nothing at the end of the table, or past it", () => {
    expect(boundaryTarget(ME, 1)).toBeUndefined();
    expect(boundaryTarget(UEFI, 2)).toBeUndefined();
    expect(boundaryTarget(ME, 9)).toBeUndefined();
    expect(boundaryTarget(ME, -1)).toBeUndefined();
  });
});

describe("draggedWidth", () => {
  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
  it("moves with the pointer, and stops at the column's floor", () => {
    expect(draggedWidth(300, 40, ME[0] as TableColumn, 1)).toBe(340);
    expect(draggedWidth(300, -400, ME[0] as TableColumn, 1)).toBe(150);
  });

  // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
  it("runs the other way when the drag takes from the neighbour", () => {
    const type = UEFI[1] as TableColumn;
    expect(draggedWidth(76, 20, type, -1)).toBe(56);
    expect(draggedWidth(76, -20, type, -1)).toBe(96);
  });
});
