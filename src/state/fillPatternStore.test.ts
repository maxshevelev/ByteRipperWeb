import { afterEach, expect, test } from "vitest";
import {
  DEFAULT_FILL_PATTERN,
  lastFillPattern,
  type PatternStorage,
  saveFillPattern,
  setFillPatternStorage,
} from "@/state/fillPatternStore";

function memory(): PatternStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

afterEach(() => setFillPatternStorage(undefined));

test("a fill starts from FF until a pattern has been used", () => {
  setFillPatternStorage(memory());
  expect(lastFillPattern()).toBe("FF");
  expect(DEFAULT_FILL_PATTERN).toBe("FF");
});

test("the last pattern is remembered as typed, without the space around it", () => {
  setFillPatternStorage(memory());
  saveFillPattern("  DE AD \n");
  expect(lastFillPattern()).toBe("DE AD");
  saveFillPattern("0x00, 0xFF");
  expect(lastFillPattern()).toBe("0x00, 0xFF");
});

test("a browser that refuses storage offers the default and still fills", () => {
  setFillPatternStorage({
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  });
  expect(() => saveFillPattern("DE AD")).not.toThrow();
  expect(lastFillPattern()).toBe("FF");
});
