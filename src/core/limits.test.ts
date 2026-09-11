import { describe, expect, it } from "vitest";
import {
  assertRepresentableSize,
  isRepresentableSize,
  MAX_REPRESENTABLE_SIZE,
  SizeNotRepresentableError,
} from "@/core/limits";

describe("the representable-size limit (D3)", () => {
  it("admits the sizes this app is actually pointed at", () => {
    for (const size of [0, 1, 16 * 1024 * 1024, 64 * 1024 * 1024, 1024 ** 3]) {
      expect(assertRepresentableSize(size)).toBe(size);
    }
  });

  it("admits the last exactly representable byte count", () => {
    expect(assertRepresentableSize(MAX_REPRESENTABLE_SIZE)).toBe(MAX_REPRESENTABLE_SIZE);
  });

  it("refuses a size past the point where a number stops counting exactly", () => {
    expect(() => assertRepresentableSize(MAX_REPRESENTABLE_SIZE + 1)).toThrow(
      SizeNotRepresentableError
    );
  });

  it("refuses sizes that are not whole non-negative counts", () => {
    for (const size of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertRepresentableSize(size)).toThrow(SizeNotRepresentableError);
    }
  });

  it("names what was too large, so the message is about a file and not a number", () => {
    expect(() => assertRepresentableSize(-1, "The joined image")).toThrow(/The joined image/);
  });

  it("answers the same question without throwing, for callers that offer a way out", () => {
    expect(isRepresentableSize(1024)).toBe(true);
    expect(isRepresentableSize(MAX_REPRESENTABLE_SIZE + 1)).toBe(false);
  });
});
