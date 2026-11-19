import { hexNumber } from "@/core/hexText/hexText";
import { readOffsetDigits } from "@/core/text/offsetParser";

/**
 * A sum typed where an offset or a length is asked for: `0x1FE000 + 4096`,
 * `196608 - 0x200` (issue #9).
 *
 * The numbers of this work arrive as arithmetic — a region's start plus a
 * structure's distance into it, a component's length minus its header — and a
 * sum done in another program and typed back is where a wrong digit gets in.
 *
 * The grammar is as small as it can be and still cover that:
 * - terms joined by `+` and `-`, taken left to right;
 * - each term read exactly as `parseOffset` reads a field that holds one
 *   number, so the bases mix freely and there is one rule to know, not two;
 * - whitespace anywhere between a term and an operator;
 * - no brackets, no multiplication, no precedence to get wrong, and no sign in
 *   front of the first term — a leading `+` or `-` is refused rather than
 *   guessed at, which keeps it free to mean "from here" one day.
 *
 * A single number is an expression of one term, so a field hands everything
 * it holds to `parseOffsetExpression` and need not know which it was given.
 *
 * The sum may dip below zero on the way (`0x100 - 0x200 + 0x200`); only what
 * it comes to has to be an offset — neither negative nor past 64 bits. The
 * arithmetic is upstream's, in 64 bits: the terms and the result are `bigint`,
 * and whether a result is an offset this application can address is the
 * field's question (`src/ui/controls/addressEvaluation.ts`), not the sum's.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetExpression.swift#OffsetExpression
 */
export interface OffsetExpression {
  /**
   * The terms in the order they were typed. Never empty; the first is never
   * subtracted.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetExpression.swift#OffsetExpression.terms
   */
  readonly terms: readonly OffsetExpressionTerm[];
  /**
   * What the sum comes to.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetExpression.swift#OffsetExpression.value
   */
  readonly value: bigint;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetExpression.swift#OffsetExpression.Term */
export interface OffsetExpressionTerm {
  /**
   * True for a term the sum takes away.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetExpression.swift#OffsetExpression.Term.isSubtracted
   */
  readonly isSubtracted: boolean;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetExpression.swift#OffsetExpression.Term.value */
  readonly value: bigint;
}

/**
 * Why a text comes to no offset.
 *
 * - `invalidInput` — not a sum of numbers: a stray character, an operator with
 *   nothing before it, two operators in a row — or a term too large to be a
 *   number at all, which is as much a typo as a stray character.
 * - `incomplete` — a sum still being typed: it ends at an operator, or at a
 *   term that is so far only its `0x`. Told apart from `invalidInput` so a
 *   field can wait for the rest instead of calling it an error.
 * - `negative` — the sum comes to less than zero.
 * - `outOfRange` — the sum does not fit in 64 bits, though every term does.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetExpression.swift#OffsetExpression.ParseError
 */
export type OffsetExpressionFailure = "invalidInput" | "incomplete" | "negative" | "outOfRange";

export type OffsetExpressionResult =
  | { readonly ok: true; readonly expression: OffsetExpression }
  | { readonly ok: false; readonly reason: OffsetExpressionFailure };

/** The largest term, and the largest result: upstream's `UInt64.max`. */
const UINT64_MAX = (1n << 64n) - 1n;

/**
 * Reads `text` as a sum. Never throws: what is wrong comes back as a reason.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetExpression.swift#OffsetExpression.parse
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetExpression.swift#OffsetExpression.Wide
 * @upstream-differs answers a result rather than throwing, and sums in `bigint`, which has the 128 bits upstream's `Wide` builds by hand
 */
export function parseOffsetExpression(text: string): OffsetExpressionResult {
  const terms: OffsetExpressionTerm[] = [];
  let subtracting = false;
  let current = "";

  /** Reads the term typed so far; a reason when it is not one. */
  const closeTerm = (last: boolean): OffsetExpressionFailure | undefined => {
    const piece = current.trim();
    current = "";
    const value = readOffsetDigits(piece);
    if (value === undefined) {
      // The last term may simply not be finished: nothing after the operator
      // yet, or a prefix waiting for its digits. Only after an operator,
      // though: a field holding nothing but its `0x` is not a sum being typed,
      // it is not an offset.
      const unfinished = terms.length > 0 && (piece === "" || piece.toLowerCase() === "0x");
      return last && unfinished ? "incomplete" : "invalidInput";
    }
    // A term too large is a mistake in that term, not a result that
    // overflowed: the field's own "invalid" names it.
    if (value > UINT64_MAX) return "invalidInput";
    terms.push({ isSubtracted: subtracting, value });
    return undefined;
  };

  for (const character of text) {
    if (character === "+" || character === "-") {
      const failure = closeTerm(false);
      if (failure !== undefined) return { ok: false, reason: failure };
      subtracting = character === "-";
    } else {
      current += character;
    }
  }
  const failure = closeTerm(true);
  if (failure !== undefined) return { ok: false, reason: failure };

  // Added and taken away are summed apart, so neither the order of the terms
  // nor a dip below zero on the way matters — only what the whole comes to.
  let added = 0n;
  let taken = 0n;
  for (const term of terms) {
    if (term.isSubtracted) taken += term.value;
    else added += term.value;
  }
  if (added < taken) return { ok: false, reason: "negative" };
  const value = added - taken;
  if (value > UINT64_MAX) return { ok: false, reason: "outOfRange" };
  return { ok: true, expression: { terms, value } };
}

/**
 * True when there is an operator: a lone number has nothing to work out.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetExpression.swift#OffsetExpression.isSum
 */
export function isSum(expression: OffsetExpression): boolean {
  return expression.terms.length > 1;
}

/**
 * The sum with every term in hex, as it was read: `0x1FE000 + 0x28` for
 * `0x1FE000 + 40`. Shown beside the result, it is how a `40` that was meant as
 * `0x40` is seen before the result is used.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/OffsetExpression.swift#OffsetExpression.hexText
 */
export function expressionHexText(expression: OffsetExpression): string {
  let text = "";
  for (const [index, term] of expression.terms.entries()) {
    if (index > 0) text += term.isSubtracted ? " - " : " + ";
    text += hexNumber(term.value);
  }
  return text;
}
