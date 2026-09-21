import { describe, expect, it } from "vitest";
import { nodeOpen, nodeOpenTitle, partName, type ZonedNode } from "@/tools/uefi/uefiPresenter";

/**
 * Every node of the tree can be taken out and read as a file of its own, and a
 * node with a header can have its body taken out without it
 * (`Design/FRAGMENT_PANELS_PLAN.md`). Ported from upstream's `NodeOpenTests`.
 *
 * What a part *links back to* is not here: the source range, the layout a UEFI
 * panel would read the bytes as and where they go back to through the rebuild
 * planner are the link, which is G4. The refusal that reads the file bytes is —
 * a node inside a section nothing can trace back to the file has no way home,
 * and opening it is refused rather than half-offered.
 */

const node = (fields: Partial<ZonedNode> & { name: string }): ZonedNode => ({
  id: [0],
  header: [0, 0],
  body: [0, 0],
  tail: [0, 0],
  ...fields,
});

/** A volume with one file in it, in the file's own bytes. */
const file = node({ id: [0, 0], name: "MyDriver", header: [0x100, 0x118], body: [0x118, 0x180] });
const volume = node({ name: "FFSv2", header: [0, 0x100], body: [0x100, 0x200], children: [file] });

describe("what the menu offers", () => {
  /**
   * Every node is offered, named after itself.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/NodeOpenTests.swift#NodeOpenTests.testANodeIsOfferedByName
   */
  it("offers a node by name", () => {
    expect(nodeOpenTitle(volume, false)).toBe("Open “FFSv2”");
    expect(nodeOpenTitle(file, false)).toBe("Open “MyDriver”");
    expect(nodeOpenTitle(file, true)).toBe("Open Body of “MyDriver”");
  });

  /**
   * A node with no name of its own is still offered — by what it is.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/NodeOpenTests.swift#NodeOpenTests.testAnUnnamedNodeIsStillOffered
   */
  it("offers a nameless node by what it is", () => {
    const bare = node({ name: "", header: [0, 4], body: [4, 0x40] });

    expect(nodeOpenTitle(bare, false)).toBe("Open Node");
    expect(nodeOpenTitle(bare, true)).toBe("Open Node Body");
  });

  /**
   * A body that is the whole node is not a second thing to open.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/NodeOpenTests.swift#NodeOpenTests.testABodyThatIsTheWholeNodeIsNotOffered
   */
  it("offers no body where the body is the whole node", () => {
    const headerless = node({ name: "Raw", header: [0, 0], body: [0, 0x40] });

    expect(nodeOpenTitle(headerless, false)).toBe("Open “Raw”");
    expect(nodeOpenTitle(headerless, true)).toBeUndefined();
  });

  /**
   * Nor is a node with nothing in it.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/NodeOpenTests.swift#NodeOpenTests.testAnEmptyNodeIsNotOffered
   */
  it("offers nothing for an empty node", () => {
    const empty = node({ name: "Nothing", header: [0x10, 0x10], body: [0x10, 0x10] });

    expect(nodeOpenTitle(empty, false)).toBeUndefined();
  });
});

describe("what opening one means", () => {
  /**
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/NodeOpenTests.swift#NodeOpenTests.testAFileNodeIsItsOwnSource
   */
  it("takes a node of the file's own bytes", () => {
    const open = nodeOpen(file, false);

    expect(open?.space).toEqual([]);
    expect(open?.range).toEqual([0x100, 0x180]);
    expect(open?.suggestedName).toBe("MyDriver.bin");
    expect(open === undefined ? undefined : partName(open.suggestedName, "bios.rom")).toBe(
      "bios_MyDriver.bin"
    );
  });

  /**
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/NodeOpenTests.swift#NodeOpenTests.testABodyIsLinkedToTheBodysOwnBytes
   */
  it("takes a body's own bytes, without the header in front of them", () => {
    const open = nodeOpen(file, true);

    expect(open?.range).toEqual([0x118, 0x180]);
    expect(open?.suggestedName).toBe("MyDriver body.bin");
  });

  /**
   * A node whose name would make a file name with a path in it is cleaned up,
   * the way a decompressed export's is.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/NodeOpenTests.swift#NodeOpenTests.testASlashInTheNameDoesNotBecomeAPath
   */
  it("does not let a slash in a name become a path", () => {
    const odd = node({ name: "a/b:c", header: [0, 4], body: [4, 0x40] });

    expect(nodeOpen(odd, false)?.suggestedName).toBe("a_b_c.bin");
  });

  /**
   * A node inside a compressed section is read out of that buffer — its ranges
   * are offsets into one — and it can only be opened where the section holding
   * it can be found, since a part nothing can place has no way home (G4).
   */
  it("reads a node inside a buffer from that buffer, and only with the section to place it", () => {
    const section = node({ name: "LZMA section", header: [0x40, 0x49], body: [0x49, 0x400] });
    const inside = node({ id: [0, 0], name: "Inner", header: [0, 0x18], body: [0x18, 0x100] });
    const inner: ZonedNode = { ...inside, space: [0x40] };

    const open = nodeOpen(inner, false, [section]);
    expect(open?.space).toEqual([0x40]);
    expect(open?.range).toEqual([0, 0x100]);
    expect(open?.suggestedName).toBe("Inner.bin");

    // Without the tree there is nothing to place the section with.
    expect(nodeOpen(inner, false)).toBeUndefined();
    expect(nodeOpen(inner, false, [])).toBeUndefined();
  });
});
