import { describe, expect, it } from "vitest";
import { soundClock } from "@/ui/toolPanel/soundClock";

describe("soundClock", () => {
  /** @web-only the player's own time text */
  it("writes minutes and seconds", () => {
    expect(soundClock(0)).toBe("0:00");
    expect(soundClock(5.9)).toBe("0:05");
    expect(soundClock(754)).toBe("12:34");
    expect(soundClock(Number.NaN)).toBe("0:00");
  });
});
