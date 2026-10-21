import { describe, expect, it } from "vitest";
import type { UEFINodeKind } from "@/firmware/uefi/uefiNode";
import { dmiButtonTitle } from "@/tools/uefi/uefiTreeDisplay";

/**
 * The DMI button says whose layout the image's store is, and only "DMI" when the stores are more
 * than one vendor's.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/DMIButtonTitleTests.swift#DMIButtonTitleTests
 */
describe("the DMI button's word", () => {
  const title = (...kinds: UEFINodeKind[]) =>
    dmiButtonTitle(
      kinds.map((kind, index) => ({
        kind,
        range: { start: index * 0x1000, end: index * 0x1000 + 0x200 },
      }))
    );

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/DMIButtonTitleTests.swift#DMIButtonTitleTests.testEachVendorByItsLayout
  it("names each vendor by its layout", () => {
    expect(title("lenovoDMIStore")).toBe("Lenovo DMI");
    expect(title("gpnvStore")).toBe("ASUS DMI");
    expect(title("acerDMIStore")).toBe("Acer DMI");
    expect(title("vssEntry")).toBe("HP DMI");
    expect(title("sysFStore")).toBe("Apple DMI");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/DMIButtonTitleTests.swift#DMIButtonTitleTests.testTwoStoresOfOneVendorNameIt
  it("names the vendor of two stores of one", () => {
    expect(title("lenovoDMIStore", "lenovoDMIStore")).toBe("Lenovo DMI");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/DMIButtonTitleTests.swift#DMIButtonTitleTests.testStoresOfTwoVendorsAreJustDMI
  it("is just DMI for stores of two vendors", () => {
    expect(title("lenovoDMIStore", "gpnvStore")).toBe("DMI");
  });
});
