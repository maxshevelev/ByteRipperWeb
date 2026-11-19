import { L } from "@/core/localization/localization";
import {
  addressBreakdown,
  addressProblemMessage,
  evaluateAddress,
} from "@/ui/controls/addressEvaluation";

/**
 * The checks of the Select Block form (§10.2), kept apart from the dialog so
 * they can be tested without one.
 */

/**
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.endRadio
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.lengthRadio
 */
export type SelectBlockMode = "end" | "length";

/** The form's three address fields. */
export type SelectBlockField = "start" | "end" | "length";

/** What the form holds: the three fields' text, the option chosen, and the file. */
export interface SelectBlockForm {
  readonly start: string;
  readonly end: string;
  readonly length: string;
  readonly mode: SelectBlockMode;
  readonly fileSize: number;
}

/**
 * What a field holds, as the checks need it: the number it names, the sentence
 * for why it names none — or, for the field being typed in, a sum still
 * waiting for its last term.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.Reading
 */
type Reading =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "wrong"; readonly message: string }
  | { readonly kind: "waiting" };

/** @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.read */
function read(text: string, invalid: string, waiting: boolean): Reading {
  const evaluation = evaluateAddress(text);
  if (evaluation.ok) return { kind: "number", value: evaluation.value };
  if (evaluation.reason === "incomplete" && waiting) return { kind: "waiting" };
  return { kind: "wrong", message: addressProblemMessage(text) ?? invalid };
}

/**
 * The End or Length field, whichever the option makes the active one.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.secondField
 */
export function secondField(mode: SelectBlockMode): SelectBlockField {
  return mode === "end" ? "end" : "length";
}

/**
 * The Start field read, with the file's end checked as well.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.startReading
 */
function startReading(form: SelectBlockForm, waiting: SelectBlockField | undefined): Reading {
  const reading = read(form.start, L("Invalid start offset."), waiting === "start");
  if (reading.kind === "number" && reading.value > form.fileSize) {
    return { kind: "wrong", message: L("Start is beyond the end of the file.") };
  }
  return reading;
}

/**
 * The first thing wrong, or `undefined`. With no field `waiting`, `undefined`
 * means every field in use names a number — there is no path that lets a field
 * with none through.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.problem
 */
export function selectBlockProblem(
  form: SelectBlockForm,
  waiting?: SelectBlockField | undefined
): string | undefined {
  const start = startReading(form, waiting);
  if (start.kind === "wrong") return start.message;
  if (form.mode === "end") {
    const end = read(form.end, L("Invalid end offset."), waiting === "end");
    if (end.kind === "wrong") return end.message;
    if (end.kind === "number") {
      if (start.kind === "number" && start.value > end.value)
        return L("Start must not exceed end.");
      // End names the last byte, so it has to be a byte the file holds.
      if (end.value >= form.fileSize) return L("End is beyond the end of the file.");
    }
    return undefined;
  }
  const length = read(form.length, L("Invalid length."), waiting === "length");
  return length.kind === "wrong" ? length.message : undefined;
}

/**
 * What OK refuses with: every field checked, nothing waited for.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.validate
 */
export function validateSelectBlock(form: SelectBlockForm): string | undefined {
  return selectBlockProblem(form);
}

/**
 * What is wrong while the user types: only the field being typed in waits — an
 * unfinished sum left behind in another field, or any other mistake in one, is
 * named as usual. A field the option has switched off is not being typed in.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.liveProblem
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.liveProblem
 */
export function liveSelectBlockProblem(
  form: SelectBlockForm,
  typing: SelectBlockField | undefined
): string | undefined {
  return selectBlockProblem(
    form,
    typing !== undefined && isEnabled(form, typing) ? typing : undefined
  );
}

/**
 * The sum being typed, read back in hex with its result (issue #9).
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.liveNote
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.liveNote
 */
export function selectBlockNote(
  form: SelectBlockForm,
  lastEdited: SelectBlockField | undefined
): string | undefined {
  if (lastEdited === undefined || !isEnabled(form, lastEdited)) return undefined;
  return addressBreakdown(form[lastEdited]);
}

/**
 * The error for the Start field alone, or `undefined` when it names a valid
 * position. The two boundary buttons ignore the End/Length option, so they
 * validate only what they actually use.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.startError
 */
export function selectBlockStartError(form: SelectBlockForm): string | undefined {
  const start = startReading(form, undefined);
  return start.kind === "wrong" ? start.message : undefined;
}

/** The message line as the form shows it: an error, or nothing wrong. */
export interface SelectBlockLine {
  /** The field whose sum the line reads back. */
  readonly lastEdited: SelectBlockField | undefined;
  /** The error shown, or `undefined` while the line is free for the note. */
  readonly error: string | undefined;
}

/**
 * A key typed into a field: the line is checked again, with that field the
 * one being typed in.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.updateLiveError
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.lastEditedAddressField
 */
export function selectBlockTyped(form: SelectBlockForm, field: SelectBlockField): SelectBlockLine {
  return { lastEdited: field, error: liveSelectBlockProblem(form, field) };
}

/**
 * The End/Length option switched (`form` already holds the new one). A sum
 * read back from the field just switched off goes, and the one in the field
 * switched on takes its place; Start's stays. The fields are checked again
 * when an error is already shown or the field switched to holds something
 * typed — but the switch does not raise an error over a field nobody has typed
 * in yet.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.modeRadioChanged
 */
export function selectBlockModeSwitched(
  form: SelectBlockForm,
  line: SelectBlockLine
): SelectBlockLine {
  const switchedOff: SelectBlockField = form.mode === "length" ? "end" : "length";
  const lastEdited = line.lastEdited === switchedOff ? secondField(form.mode) : line.lastEdited;
  if (line.error === undefined && isUntouched(form[secondField(form.mode)])) {
    return { lastEdited, error: undefined };
  }
  return { lastEdited, error: liveSelectBlockProblem(form, lastEdited) };
}

/** True for a field that holds nothing typed: empty, or the `0x` it opens with. */
export function isUntouched(text: string): boolean {
  const typed = text.trim().toLowerCase();
  return typed === "" || typed === "0x";
}

function isEnabled(form: SelectBlockForm, field: SelectBlockField): boolean {
  return field === "start" || field === secondField(form.mode);
}
