import { describe, expect, it } from "vitest";
import {
  initialPictureBackground,
  nextPictureBackground,
  type PictureBackground,
} from "./pictureBackground";

/**
 * Ported from `UEFIToolFlowTests`: a picture's background — what it starts on,
 * and where a click takes it. The web's level is the state the component keeps
 * rather than a view: the bytes' alpha is found by the browser's own decoder,
 * and what reaches the state here is its answer, fed as upstream's `init` is.
 */
describe("a picture's background", () => {
  it("starts on the panel's own where the picture has no alpha, and a click goes round the three", () => {
    // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testAClickChangesThePicturesBackground
    let one: PictureBackground = initialPictureBackground(false);
    expect(one).toBe("panel");

    one = nextPictureBackground(one);
    expect(one).toBe("checkerboard");
    one = nextPictureBackground(one);
    expect(one).toBe("contrast");
    one = nextPictureBackground(one);
    expect(one).toBe("panel");
  });

  it("starts on the checkerboard where the picture has an alpha channel", () => {
    // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testATransparentPictureStartsOnTheCheckerboard
    expect(initialPictureBackground(true)).toBe("checkerboard");
  });
});
