import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOPIC } from "@/core/help/helpIds";
import { cpuidLookupFor } from "@/firmware/intelCpuid/cpuidLookup";
import {
  EMPTY_PROCESSOR_TABLES,
  installProcessorTables,
} from "@/firmware/intelCpuid/processorTables";
import { installTestTables, TEST_TABLES } from "@/firmware/testing/testTables";
import {
  type DesktopOwnWindowsBridge,
  installDesktopOwnWindowsForTesting,
  type OwnWindowKind,
} from "@/platform/desktop/desktopWindows";
import {
  clearCpuidHistory,
  cpuidLookupStore,
  editCpuidQuery,
  rememberCpuidQuery,
  setCpuidQuery,
  showCpuidLookup,
  sortCpuidLookup,
} from "@/state/cpuidLookupStore";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { setProcessorTablesSource } from "@/state/processorTablesStore";
import { cpuidLookupPanelIsUp, workspaceStore } from "@/state/workspaceStore";
import { CpuidLookupPanel, rowLines, sortedRows } from "@/ui/cpuidLookup/CpuidLookupPanel";

/**
 * Window ▸ Intel CPUID Lookup, over the fixture tables: what a query shows, what is remembered,
 * and that the lookup reads the store the FIT panel reads — upstream's `CPUIDLookupWindowTests`.
 */

/** The panel as it draws now, as text. */
const drawn = (): string => renderToStaticMarkup(<CpuidLookupPanel />);

/** The status line's words. */
const status = (): string =>
  /<p class="cpuid-lookup-status"[^>]*>([^<]*)<\/p>/.exec(drawn())?.[1] ?? "";

/** The rows of the table, as drawn. */
const rowCount = (): number => (drawn().match(/<tr data-row=/g) ?? []).length;

// @upstream ByteRipperTests/CPUIDLookupWindowTests.swift#CPUIDLookupWindowTests
describe("the Intel CPUID Lookup", () => {
  // @upstream ByteRipperTests/CPUIDLookupWindowTests.swift#CPUIDLookupWindowTests.setUp
  beforeEach(() => {
    installTestTables();
    // No network in a test: the source answers at once with what is installed.
    setProcessorTablesSource({ refresh: async () => undefined, freshness: () => undefined });
    clearCpuidHistory();
    cpuidLookupStore.update((state) => ({ ...state, query: "", sort: undefined }));
  });

  // @upstream ByteRipperTests/CPUIDLookupWindowTests.swift#CPUIDLookupWindowTests.tearDown
  afterEach(() => {
    installTestTables();
    installDesktopOwnWindowsForTesting();
    workspaceStore.update((state) => ({ ...state, dock: EMPTY_DOCK, cpuidLookupPanel: undefined }));
  });

  // @upstream ByteRipperTests/CPUIDLookupWindowTests.swift#CPUIDLookupWindowTests.testAnEmptyQueryListsTheWholeTable
  it("lists the whole table before anything is typed, and counts it", () => {
    expect(rowCount()).toBe(cpuidLookupFor(TEST_TABLES).rows.length);
    expect(status()).toContain("CPUID");
    expect(drawn()).not.toContain("cpuid-lookup-heading");
  });

  // @upstream ByteRipperTests/CPUIDLookupWindowTests.swift#CPUIDLookupWindowTests.testAnSSpecFindsItsModel
  it("finds an S-SPEC's model", () => {
    setCpuidQuery("SR3Z0");
    expect(rowCount()).toBe(1);
    expect(drawn()).toContain("906EA");
    expect(status()).toBe("Found: 1");
  });

  // @upstream ByteRipperTests/CPUIDLookupWindowTests.swift#CPUIDLookupWindowTests.testACPUIDIsHeadedByItsEntry
  it("heads a CPUID typed whole with its entry; with no models the heading is all there is", () => {
    setCpuidQuery("B06F5");
    const html = drawn();
    expect(html).toContain("cpuid-lookup-heading");
    expect(html).toContain("Raptor Lake");
    // The CPUIDs its microcode also serves.
    expect(html).toContain("90672");
    expect(html).toContain("cpuid-lookup-table");

    const modelless = TEST_TABLES.families.find(
      (family) =>
        family.processors.length === 0 &&
        family.cpuids.length === 1 &&
        !(family.cpuids[0] ?? "").includes("X")
    );
    expect(modelless).toBeDefined();
    setCpuidQuery(modelless?.cpuids[0] ?? "");
    expect(drawn()).not.toContain("cpuid-lookup-table");
    expect(drawn()).toContain("cpuid-lookup-heading is-filling");
    expect(status()).toBe("No models are listed for this CPUID. What is known about it is above.");
  });

  // @upstream ByteRipperTests/CPUIDLookupWindowTests.swift#CPUIDLookupWindowTests.testSearchesAreRememberedWhenTheyFindSomething
  it("remembers a search that found something, in place of what was typed on the way", () => {
    editCpuidQuery("SR3Z");
    rememberCpuidQuery();
    setCpuidQuery("SR3Z0");
    setCpuidQuery("nosuchprocessor");
    expect(cpuidLookupStore.getSnapshot().history).toEqual(["SR3Z0"]);
    clearCpuidHistory();
    expect(cpuidLookupStore.getSnapshot().history).toEqual([]);
  });

  // @upstream ByteRipperTests/CPUIDLookupWindowTests.swift#CPUIDLookupWindowTests.testCopyPutsTheRowsOnThePasteboard
  it("copies rows as lines of tab-separated columns", () => {
    const rows = cpuidLookupFor(TEST_TABLES).rowsMatching("SR3Z0");
    const copied = rowLines(rows) ?? "";
    expect(copied.startsWith("906EA\t")).toBe(true);
    expect(copied).toContain("SR3Z0");
    expect(rowLines([])).toBeUndefined();
  });

  // @upstream ByteRipperTests/CPUIDLookupWindowTests.swift#CPUIDLookupWindowTests.testANewTableIsSearchedAtOnce
  it("searches a table that lands at once, and says when there is none", () => {
    setCpuidQuery("SR3Z0");
    expect(rowCount()).toBe(1);
    installProcessorTables(EMPTY_PROCESSOR_TABLES);
    expect(rowCount()).toBe(0);
    expect(status().startsWith("The table has not been read yet")).toBe(true);
  });

  // @upstream ByteRipperTests/CPUIDLookupWindowTests.swift#CPUIDLookupWindowTests.testTheTableFollowsTheZoom
  // @upstream-differs the panel's text is the dump's size, which the stylesheet hands it
  it("is set in the dump's size, as the tool panels are", () => {
    expect(drawn()).toContain('class="cpuid-lookup"');
  });

  // @upstream ByteRipperTests/CPUIDLookupWindowTests.swift#CPUIDLookupWindowTests.testHelpOpensTheLookupPage
  it("has a page of its own in the help", () => {
    expect(TOPIC.cpuidLookup).toBe("cpuid-lookup");
  });

  // @web-only upstream leaves the sort to NSTableView, and does not test it
  it("sorts by a column title, and the other way on a second click", () => {
    const rows = cpuidLookupFor(TEST_TABLES).rowsMatching("i7");
    sortCpuidLookup("model");
    const up = sortedRows(rows, cpuidLookupStore.getSnapshot().sort).map((row) => row.name);
    sortCpuidLookup("model");
    const down = sortedRows(rows, cpuidLookupStore.getSnapshot().sort).map((row) => row.name);
    expect(up.length).toBeGreaterThan(1);
    expect(up[0]?.localeCompare(up[up.length - 1] ?? "")).toBeLessThanOrEqual(0);
    expect(down[0]).toBe(up[up.length - 1]);
  });

  // @web-only upstream's lookup is always a window of its own
  it("is a panel of the dock, raised when asked again — and the shell's own window there", () => {
    showCpuidLookup();
    const first = workspaceStore.getSnapshot().cpuidLookupPanel;
    expect(first).toBeDefined();
    expect(cpuidLookupPanelIsUp(workspaceStore.getSnapshot())).toBe(true);
    showCpuidLookup();
    expect(workspaceStore.getSnapshot().cpuidLookupPanel).toBe(first);
    expect(workspaceStore.getSnapshot().dock.panels.length).toBe(1);

    const asked: OwnWindowKind[] = [];
    const bridge: DesktopOwnWindowsBridge = {
      open: (kind) => asked.push(kind),
      onShow: () => () => undefined,
      close: () => undefined,
    };
    installDesktopOwnWindowsForTesting(bridge);
    workspaceStore.update((state) => ({ ...state, dock: EMPTY_DOCK, cpuidLookupPanel: undefined }));
    showCpuidLookup();
    expect(asked).toEqual(["cpuid"]);
    expect(workspaceStore.getSnapshot().cpuidLookupPanel).toBeUndefined();
  });
});
