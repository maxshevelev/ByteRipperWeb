import { describe, expect, it } from "vitest";
import {
  canonicalHelpKey,
  HELP_KEY_SPELLINGS,
  type HelpCommand,
  macToOther,
  resolveHelpKey,
  spellHelpKey,
} from "@/core/help/helpKeys";

/**
 * The whole of the Mac→Windows question, pinned.
 *
 * The book is written with Mac chords; the Windows build must read them as the
 * Windows hand presses them. The test asserts the spelling each command carries
 * on each platform, and — the load-bearing half — that the `other` column is not
 * written by hand but is the `apple` column run through the remap rule. A chord
 * the rule does not carry over correctly would fail here, which is what keeps
 * the mapping valid rather than merely claimed.
 */
describe("helpKeys", () => {
  it("spells every chord the Mac way on a Mac", () => {
    for (const command of Object.keys(HELP_KEY_SPELLINGS) as HelpCommand[]) {
      expect(resolveHelpKey(command, "apple"), command).toBe(HELP_KEY_SPELLINGS[command].apple);
    }
  });

  it("spells every chord the Windows way on Windows and Linux", () => {
    for (const command of Object.keys(HELP_KEY_SPELLINGS) as HelpCommand[]) {
      expect(resolveHelpKey(command, "other"), command).toBe(HELP_KEY_SPELLINGS[command].other);
    }
  });

  it("carries every Mac chord over by the rule, not by assertion", () => {
    // The reason the mapping is valid: applying the modifier remap to each Mac
    // chord reproduces exactly the spelling the other platform shows.
    for (const command of Object.keys(HELP_KEY_SPELLINGS) as HelpCommand[]) {
      const { apple, other } = HELP_KEY_SPELLINGS[command];
      expect(macToOther(apple), `${apple} on ${command}`).toBe(other);
    }
  });

  it("reads the remap rule the way the shell's menu spells it", () => {
    // The rule, on the chords the shell and the help share:
    expect(macToOther("⌘F")).toBe("Ctrl+F");
    expect(macToOther("⇧⌘D")).toBe("Ctrl+Shift+D");
    expect(macToOther("⌥⌘→")).toBe("Ctrl+Alt+→");
    expect(macToOther("⇧⌥⌘→")).toBe("Ctrl+Alt+Shift+→");
  });

  it("indexes a chord in the form the book was written in", () => {
    expect(canonicalHelpKey("find")).toBe("⌘F");
    expect(canonicalHelpKey("nextDifference")).toBe("⌥⌘→");
  });

  it("spells a chord from the id a page writes, on either platform", () => {
    // The span a page holds is the id its author wrote; the resolver answers it
    // with the platform's spelling, and needs no `HelpCommand` type in hand.
    expect(spellHelpKey("find", "apple")).toBe("⌘F");
    expect(spellHelpKey("find", "other")).toBe("Ctrl+F");
    expect(spellHelpKey("nextSameBlock", "other")).toBe("Ctrl+Alt+Shift+→");
    // A chord the table does not carry reads as its id — visibly wrong, not a throw.
    expect(spellHelpKey("noSuchChord", "other")).toBe("noSuchChord");
  });

  it("has no chord it does not know", () => {
    // The table is the closed set the book may name; a page that invents a new
    // one reads as its id, and the coverage of the book catches that.
    const commands = new Set(Object.keys(HELP_KEY_SPELLINGS) as HelpCommand[]);
    expect(commands.size).toBe(28);
  });
});
