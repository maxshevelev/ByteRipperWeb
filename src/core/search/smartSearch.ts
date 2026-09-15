import {
  type ByteRange,
  findOne,
  foldedPattern,
  type ScanOptions,
} from "@/core/search/searchEngine";
import {
  type CaseFolding,
  foldingFor,
  parsePattern,
  type SearchEncoding,
  type SearchPattern,
  sameFolding,
} from "@/core/search/searchPattern";
import type { ByteStorage } from "@/core/storage/byteStorage";

/**
 * Finding a pattern without being told how it is stored.
 *
 * Ported from `SmartSearch.swift`. A dump holds bytes, and a string in a dump
 * is in whichever encoding the firmware's author happened to use. The reader
 * usually knows *what* they are looking for and not *how it is written* — so
 * the encoding becomes a result rather than an instruction: the pattern is
 * looked for in one encoding after another, and the first that finds anything
 * is the answer.
 */

/**
 * One thing to look for.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SmartSearch.swift#SmartSearch.Attempt
 */
export interface Attempt {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SmartSearch.swift#SmartSearch.Attempt.pattern */
  readonly pattern: SearchPattern;
  /**
   * How letters compare, which is part of the question rather than of the
   * caller's bookkeeping: the same bytes compared exactly and compared folded
   * are two different searches.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SmartSearch.swift#SmartSearch.Attempt.folding
   */
  readonly folding: CaseFolding;
  /**
   * More than one encoding can ask the same question — `abc` as ASCII and as
   * UTF-8 is the same three bytes compared the same way — and scanning a dump
   * twice for them would be twice the wait for one answer. They are one
   * attempt, and the first of them is the one a field adopts, being the
   * narrower claim.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SmartSearch.swift#SmartSearch.Attempt.encodings
   */
  readonly encodings: readonly SearchEncoding[];
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SmartSearch.swift#SmartSearch.Attempt.encoding */
export const attemptEncoding = (attempt: Attempt): SearchEncoding =>
  attempt.encodings[0] ?? attempt.pattern.encoding;

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SmartSearch.swift#SmartSearch.Outcome */
export type SmartOutcome =
  | {
      readonly kind: "found";
      readonly attempt: Attempt;
      readonly range: ByteRange;
      /** True when the range came from the scan that started at the file's edge. */
      readonly wrapped: boolean;
    }
  | { readonly kind: "nothing" };

/**
 * Whether the text reads as a hexadecimal byte sequence, and so should be
 * looked for as bytes before it is looked for as text.
 *
 * Deliberately stricter than the hex parser, which accepts any grouping: the
 * question here is not "could this be parsed as hex" but "does this look like
 * it was *meant* as hex". So an even run of hex digits — `DEADBEEF` — or those
 * digits in pairs — `DE AD BE EF`. Anything else, `DEAD BEEF` included, is text
 * as far as this test is concerned; a reader who means those four bytes writes
 * them the way every hex dump prints them.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SmartSearch.swift#SmartSearch.looksLikeHexBytes
 */
export function looksLikeHexBytes(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  const groups = trimmed.split(/\s+/).filter((group) => group.length > 0);
  if (!groups.every((group) => /^[0-9a-fA-F]+$/.test(group))) return false;
  if (groups.length === 1) return (groups[0]?.length ?? 0) % 2 === 0;
  return groups.every((group) => group.length === 2);
}

/**
 * The encodings a text pattern is tried in, in order: the ones a reader is most
 * likely to have meant first. ASCII before UTF-8 because they ask the same
 * question of a plain string and ASCII is the narrower claim; the UTF-16 pair
 * after them, where a string in a dump is stored two bytes to a character.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SmartSearch.swift#SmartSearch.textOrder
 */
export const TEXT_ORDER: readonly SearchEncoding[] = ["ascii", "utf8", "utf16LE", "utf16BE"];

/**
 * What to look for, in the order to look: hex first when the text reads as hex,
 * then the text encodings.
 *
 * `preferred` goes in front of all of it. It is for a pattern the *user* brought
 * an encoding with — one picked out of the field's history, where the entry
 * records the pair — because that is a statement about the encoding as much as
 * about the pattern, and guessing over it would throw away what the user
 * already knows. Typing anything is not such a statement.
 *
 * Attempts asking the same question are merged, so the file is scanned once per
 * question rather than once per encoding. An encoding that cannot hold the text
 * is left out — there is nothing to look for — and a text no encoding can carry
 * yields no attempts at all, which is the caller's cue that there is no pattern
 * here rather than a bad one.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SmartSearch.swift#SmartSearch.attempts
 */
export function attemptsFor(
  text: string,
  caseSensitive: boolean,
  preferred?: SearchEncoding
): Attempt[] {
  const order: SearchEncoding[] = [];
  if (preferred !== undefined) order.push(preferred);
  if (looksLikeHexBytes(text)) order.push("hex");
  order.push(...TEXT_ORDER);

  const attempts: Attempt[] = [];
  for (const encoding of order) {
    const parsed = parsePattern(text, encoding);
    if (!parsed.ok) continue;

    const folding = foldingFor(encoding, caseSensitive);
    const existing = attempts.findIndex(
      (attempt) =>
        sameFolding(attempt.folding, folding) &&
        sameBytes(attempt.pattern.bytes, parsed.pattern.bytes)
    );
    if (existing !== -1) {
      const already = attempts[existing];
      // `order` names the preferred encoding again in its usual place; the
      // merge keeps the first, which is the point of putting it first.
      if (already === undefined || already.encodings.includes(encoding)) continue;
      attempts[existing] = { ...already, encodings: [...already.encodings, encoding] };
      continue;
    }
    attempts.push({ pattern: parsed.pattern, folding, encodings: [encoding] });
  }
  return attempts;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

/**
 * Runs the attempts in order until one of them finds something.
 *
 * Each attempt is the two scans a plain search runs: one from the anchor, and —
 * failing that — one from the file's other end, which is the wrap. So "this
 * encoding finds nothing" means nothing anywhere in the file, not merely
 * nothing ahead of the caret, and the pass moves on to the next encoding only
 * when it is sure.
 *
 * Progress covers the whole pass: each attempt owns its share, and each
 * attempt's two scans own half of that. A wrong guess about an encoding costs a
 * scan of the file, and several of them are a wait worth being able to stop.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SmartSearch.swift#SmartSearch.firstMatch
 */
export async function firstMatchAmong(
  attempts: readonly Attempt[],
  storage: ByteStorage,
  options: {
    readonly from: number;
    readonly direction?: "forward" | "backward";
  } & ScanOptions
): Promise<SmartOutcome> {
  if (attempts.length === 0) return { kind: "nothing" };
  const direction = options.direction ?? "forward";
  const total = attempts.length;

  for (const [position, attempt] of attempts.entries()) {
    const scan = async (from: number, half: number) =>
      await findOne(foldedPattern(attempt.pattern.bytes, attempt.folding), storage, {
        from,
        direction,
        folding: attempt.folding,
        ...(options.chunkSize === undefined ? {} : { chunkSize: options.chunkSize }),
        ...(options.shouldCancel === undefined ? {} : { shouldCancel: options.shouldCancel }),
        onProgress: (fraction) => options.onProgress?.((position + half + fraction / 2) / total),
      });

    const here = await scan(options.from, 0);
    if (here !== undefined) return { kind: "found", attempt, range: here, wrapped: false };

    const edge = direction === "forward" ? 0 : storage.size;
    const wrapped = await scan(edge, 0.5);
    if (wrapped !== undefined) return { kind: "found", attempt, range: wrapped, wrapped: true };

    options.onProgress?.((position + 1) / total);
  }
  return { kind: "nothing" };
}
