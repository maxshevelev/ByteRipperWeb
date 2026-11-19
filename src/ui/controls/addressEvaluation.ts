import { hexNumber } from "@/core/hexText/hexText";
import { MAX_REPRESENTABLE_SIZE } from "@/core/limits";
import { L } from "@/core/localization/localization";
import {
  expressionHexText,
  isSum,
  type OffsetExpression,
  type OffsetExpressionFailure,
  parseOffsetExpression,
} from "@/core/text/offsetExpression";
import { recordAddressExpression } from "@/state/addressHistoryStore";

/**
 * What the address field (`AddressField.tsx`) holds, read: the arithmetic of
 * the one field an address or a length is typed in, kept apart from the
 * component so it can be tested without one. Every function takes the field's
 * text, which is all the field is.
 */

/**
 * What a field's text comes to, or why it comes to nothing.
 *
 * `value` is the number a form acts on. A sum may come to more than this
 * application can address exactly (D3) while still fitting upstream's 64 bits;
 * that is no offset here, and it reads as `invalidInput` — the form's own
 * "invalid" message, as a lone number that large already does.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.evaluation
 * @upstream-differs a result past Number.MAX_SAFE_INTEGER is invalidInput, where upstream's ceiling is the 64 bits of UInt64
 */
export type AddressEvaluation =
  | { readonly ok: true; readonly expression: OffsetExpression; readonly value: number }
  | { readonly ok: false; readonly reason: OffsetExpressionFailure };

/**
 * The text last read, and what it came to. Parsed once per text: the result
 * beside the field, the form's check and its message line all ask, on every
 * render.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.parsed
 */
let parsed: { readonly text: string; readonly evaluation: AddressEvaluation } | undefined;

/** @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.evaluation */
export function evaluateAddress(text: string): AddressEvaluation {
  if (parsed?.text === text) return parsed.evaluation;
  const result = parseOffsetExpression(text);
  const evaluation: AddressEvaluation = !result.ok
    ? result
    : result.expression.value > BigInt(MAX_REPRESENTABLE_SIZE)
      ? { ok: false, reason: "invalidInput" }
      : { ok: true, expression: result.expression, value: Number(result.expression.value) };
  parsed = { text, evaluation };
  return evaluation;
}

/**
 * The number a form acts on: the lone number typed, or what the sum comes to.
 * `undefined` while the text names none.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.value
 */
export function addressValue(text: string): number | undefined {
  const evaluation = evaluateAddress(text);
  return evaluation.ok ? evaluation.value : undefined;
}

/** True for a sum that ends at its operator: waited for while it is typed. */
export function isUnfinished(text: string): boolean {
  const evaluation = evaluateAddress(text);
  return !evaluation.ok && evaluation.reason === "incomplete";
}

/**
 * A sum, read back in full for a form that has a line to put it on:
 * `0x1FE000 + 0x28 = 0x1FE028 (2089000)` — every term in hex as it was
 * understood, then the result in both bases. `undefined` for anything but a sum.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.breakdown
 */
export function addressBreakdown(text: string): string | undefined {
  const evaluation = evaluateAddress(text);
  if (!evaluation.ok || !isSum(evaluation.expression)) return undefined;
  const sum = evaluation.expression;
  return `${expressionHexText(sum)} = ${hexNumber(sum.value)} (${sum.value})`;
}

/**
 * The sentence for a sum that comes to no address, for a form that says what
 * is wrong in words. `undefined` when the text names a number, and when the
 * form's own "invalid" message — which names the field — is the right one:
 * text that is no number, a number too large among them. A form that waits for
 * an unfinished sum while it is typed asks only once the user acts on it.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.problemMessage
 */
export function addressProblemMessage(text: string): string | undefined {
  const evaluation = evaluateAddress(text);
  if (evaluation.ok) return undefined;
  switch (evaluation.reason) {
    case "negative":
      return L("The result is negative.");
    case "outOfRange":
      return L("The result does not fit in 64 bits.");
    case "incomplete":
      return L("The sum is not finished.");
    case "invalidInput":
      return undefined;
  }
}

/**
 * What is drawn at the right edge: `= 0x1FE028` for a sum, and for a lone
 * number that was not typed with its `0x`. Empty when the text already *is* the
 * number as the app writes one, or names none.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.resultText
 */
export function addressResultText(text: string): string {
  const evaluation = evaluateAddress(text);
  if (!evaluation.ok) return "";
  const typed = text.trim().toLowerCase();
  if (!isSum(evaluation.expression) && typed.startsWith("0x")) return "";
  return `= ${hexNumber(evaluation.value)}`;
}

/**
 * Puts what the field holds into the list of recent entries — called by the
 * form once it has acted on it. A sum is always worth keeping; a lone number
 * only where it was an address gone to (`always`), or the list would fill with
 * every length ever typed.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.recordInHistory
 */
export function recordAddressInHistory(text: string, always = false): void {
  const evaluation = evaluateAddress(text);
  if (!evaluation.ok || (!always && !isSum(evaluation.expression))) return;
  recordAddressExpression(evaluation.expression, text);
}

/**
 * One row of the list of recent entries: the entry, and for a sum what it
 * comes to. Picking the row gives the field the entry alone — the text a field
 * can evaluate again.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.historyMenu
 */
export interface AddressHistoryRow {
  readonly entry: string;
  /** `0x1FE028` for a sum; `undefined` for an address, which is its own result. */
  readonly result: string | undefined;
}

/** @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.historyMenu */
export function addressHistoryRows(entries: readonly string[]): readonly AddressHistoryRow[] {
  return entries.map((entry) => {
    const sum = parseOffsetExpression(entry);
    return {
      entry,
      result: sum.ok && isSum(sum.expression) ? hexNumber(sum.expression.value) : undefined,
    };
  });
}
