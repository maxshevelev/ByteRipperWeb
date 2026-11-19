import { describe, expect, it } from "vitest";
import { hexNumber } from "@/core/hexText/hexText";
import { addressResultText, addressValue } from "@/ui/controls/addressEvaluation";
import {
  type SelectBlockField,
  type SelectBlockForm,
  type SelectBlockLine,
  type SelectBlockMode,
  selectBlockModeSwitched,
  selectBlockNote,
  selectBlockTyped,
  validateSelectBlock,
} from "@/ui/dialogs/selectBlock";

/**
 * The sums of the Select Block form (issue #9), ported from the sum half of
 * `SelectBlockSheetTests.swift`. The form is driven as the sheet's tests drive
 * theirs: a field typed in, the option switched — and the line read.
 */

/** A form as upstream's `makeSheet` opens one: a 0x100-byte file, every field `0x`. */
class Sheet {
  form: SelectBlockForm;
  line: SelectBlockLine = { lastEdited: undefined, error: undefined };

  constructor(fileSize = 0x100) {
    this.form = { start: "0x", end: "0x", length: "0x", mode: "end", fileSize };
  }

  /** Text set without a keystroke, as a test's `stringValue =` does. */
  set(field: SelectBlockField, text: string) {
    this.form = { ...this.form, [field]: text };
  }

  type(field: SelectBlockField, text: string) {
    this.set(field, text);
    this.line = selectBlockTyped(this.form, field);
  }

  choose(mode: SelectBlockMode) {
    this.form = { ...this.form, mode };
    this.line = selectBlockModeSwitched(this.form, this.line);
  }

  get error() {
    return this.line.error;
  }

  /** The note shares the error's line: one or the other, never both. */
  get note() {
    return this.line.error === undefined
      ? selectBlockNote(this.form, this.line.lastEdited)
      : undefined;
  }
}

// @upstream ByteRipperTests/SelectBlockSheetTests.swift#SelectBlockSheetTests.testASumInAFieldSelectsFromItsResult
it("selects from what a sum in a field comes to", () => {
  const sheet = new Sheet(0x400000);
  sheet.choose("length");
  sheet.set("start", "0x1FE000 + 0x40");
  sheet.set("length", "4096 - 0x40");
  expect(validateSelectBlock(sheet.form)).toBeUndefined();
  expect(addressResultText(sheet.form.start)).toBe("= 0x1FE040");
  expect(addressValue(sheet.form.start)).toBe(0x1fe040);
  expect(addressValue(sheet.form.length)).toBe(0xfc0);
});

// @upstream ByteRipperTests/SelectBlockSheetTests.swift#SelectBlockSheetTests.testTheSumIsReadBackAndAnUnfinishedOneIsWaitedFor
it("reads the sum back, and waits for an unfinished one — though OK refuses it", () => {
  const sheet = new Sheet();
  sheet.set("end", "0x80");

  sheet.type("start", "0x10 +");
  expect(sheet.error).toBeUndefined();
  expect(sheet.note).toBeUndefined();
  expect(validateSelectBlock(sheet.form)).toBe("The sum is not finished.");

  sheet.type("start", "0x10 + 32");
  expect(sheet.error).toBeUndefined();
  expect(sheet.note).toBe("0x10 + 0x20 = 0x30 (48)");

  sheet.type("start", "0x10 - 32");
  expect(sheet.error).toBe("The result is negative.");
  expect(sheet.note).toBeUndefined();
});

// @upstream ByteRipperTests/SelectBlockSheetTests.swift#SelectBlockSheetTests.testTheLineFollowsTheFieldSwitchedTo
it("reads back the field the option switches to", () => {
  const sheet = new Sheet();
  sheet.set("start", "0x10");
  sheet.set("length", "0x8 + 8");
  sheet.type("end", "0x10 + 0x20");
  expect(sheet.note).toBe("0x10 + 0x20 = 0x30 (48)");

  sheet.choose("length");
  expect(sheet.note).toBe("0x8 + 0x8 = 0x10 (16)");

  sheet.set("length", "0x40");
  sheet.choose("end");
  expect(sheet.note).toBe("0x10 + 0x20 = 0x30 (48)");
});

// @upstream ByteRipperTests/SelectBlockSheetTests.swift#SelectBlockSheetTests.testAnUnfinishedSumElsewhereDoesNotHideAnError
it("names an unfinished sum left in another field", () => {
  const sheet = new Sheet();
  sheet.set("end", "0x80");
  sheet.type("start", "0x10 +");
  expect(sheet.error).toBeUndefined();

  sheet.type("end", "0x5 - 0x10");
  expect(sheet.error).toBe("The sum is not finished.");
  sheet.type("start", "0x10 + 1");
  sheet.type("end", "0x5 - 0x10");
  expect(sheet.error).toBe("The result is negative.");
});

// @upstream ByteRipperTests/SelectBlockSheetTests.swift#SelectBlockSheetTests.testSwitchingTheRadioRaisesNoErrorOfItsOwn
it("raises no error of its own when the option is switched", () => {
  const sheet = new Sheet();
  sheet.choose("length");
  expect(sheet.error).toBeUndefined();
  expect(sheet.note).toBeUndefined();

  sheet.set("end", "0x80");
  sheet.choose("end");
  sheet.type("start", "0x10 + 0x20");
  sheet.choose("length");
  sheet.choose("end");
  expect(sheet.error).toBeUndefined();
  expect(sheet.note).toBe("0x10 + 0x20 = 0x30 (48)");
});

// @upstream ByteRipperTests/SelectBlockSheetTests.swift#SelectBlockSheetTests.testSwitchingToAFieldWithAMistakeShowsIt
it("shows a mistake in the field switched to at once", () => {
  const sheet = new Sheet();
  sheet.set("length", "0x10 - 0x20");
  sheet.type("start", "0x10");
  sheet.set("end", "0x20");
  sheet.type("start", "0x10");
  expect(sheet.error).toBeUndefined();

  sheet.choose("length");
  expect(sheet.error).toBe("The result is negative.");
});

// @upstream ByteRipperTests/SelectBlockSheetTests.swift#SelectBlockSheetTests.testAnUnfinishedSumDoesNotHideAnotherFieldsError
it("does not let an unfinished sum hide another field's error", () => {
  const sheet = new Sheet(0x100);
  sheet.type("start", "0x99999999");
  expect(sheet.error).toBe("Start is beyond the end of the file.");

  sheet.type("end", "0x10 +");
  expect(sheet.error).toBe("Start is beyond the end of the file.");
});

// @upstream ByteRipperTests/SelectBlockSheetTests.swift#SelectBlockSheetTests.testAPresetStartPastFourGigabytesIsWhole
it("writes a preset start past 4 GB whole", () => {
  expect(hexNumber(0x1_2345_6780)).toBe("0x123456780");
  expect(addressValue(hexNumber(0x1_2345_6780))).toBe(0x1_2345_6780);
});

describe("the checks a lone number already had", () => {
  it("names each field's own mistake", () => {
    const sheet = new Sheet(0x100);
    sheet.set("start", "zz");
    expect(validateSelectBlock(sheet.form)).toBe("Invalid start offset.");
    sheet.set("start", "0x10");
    sheet.set("end", "0x8");
    expect(validateSelectBlock(sheet.form)).toBe("Start must not exceed end.");
    sheet.set("end", "0x100");
    expect(validateSelectBlock(sheet.form)).toBe("End is beyond the end of the file.");
    sheet.choose("length");
    expect(validateSelectBlock(sheet.form)).toBe("Invalid length.");
  });
});
