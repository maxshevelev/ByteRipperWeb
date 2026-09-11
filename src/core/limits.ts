/**
 * What an offset is, and where it stops being one.
 *
 * Decision D3: offsets are `number`, not `bigint`. A double holds every integer
 * up to 2^53 - 1 exactly — nine petabytes — and the largest thing this app is
 * ever pointed at is a flash dump of a few gigabytes. `bigint` would buy three
 * orders of magnitude nobody needs, at several times the arithmetic cost, and
 * it would infect every signature in the domain half.
 *
 * The price of that decision is one assertion, made once, where a size first
 * enters the program: {@link assertRepresentableSize}. Past this point nothing
 * range-checks again, because nothing can have got past here.
 */

/**
 * The largest byte count this application will work with: 2^53 - 1, the last
 * integer a `number` represents exactly.
 *
 * Note this is a length, so the largest valid *offset* into a document of the
 * maximum size is one less — ranges are half-open `[start, end)` throughout
 * (D13), and `end` may equal the length.
 */
export const MAX_REPRESENTABLE_SIZE = Number.MAX_SAFE_INTEGER;

/** Thrown when a file is larger than {@link MAX_REPRESENTABLE_SIZE}. */
export class SizeNotRepresentableError extends Error {
  readonly size: number;

  constructor(size: number, what: string) {
    super(
      `${what} is ${size} bytes, past the ${MAX_REPRESENTABLE_SIZE}-byte limit on an exactly ` +
        "representable offset. ByteRipper addresses bytes as JavaScript numbers (D3)."
    );
    this.name = "SizeNotRepresentableError";
    this.size = size;
  }
}

/**
 * Check a byte count at the boundary — opening a file, joining two, reading a
 * length out of a header — and hand it back so the check reads as part of the
 * assignment.
 *
 * @param size The byte count to admit.
 * @param what What it is the size of, for the message a user would read.
 * @throws {SizeNotRepresentableError} if the size is negative, not an integer,
 * or beyond the exactly representable range.
 */
export function assertRepresentableSize(size: number, what = "This file"): number {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new SizeNotRepresentableError(size, what);
  }
  return size;
}

/**
 * Whether a size could be admitted, without throwing — for the places that
 * offer a different path rather than failing, such as a file picker that wants
 * to grey out what it cannot open.
 */
export function isRepresentableSize(size: number): boolean {
  return Number.isSafeInteger(size) && size >= 0;
}
