/**
 * How many times each machine has written a collection
 * (`Design/FAVORITES_SYNC_WEB.md`).
 *
 * It answers the one question timestamps cannot: were two versions written
 * **concurrently**, or did one see the other first? Two machines' clocks
 * disagree by more than a sync takes, so "later" is not a fact about order —
 * but "this version already includes every write that one knows about" is, and
 * that is all a merge needs to know before it starts asking the user questions.
 *
 * A plain record of counters, which is also exactly how it is written to a file:
 * `{ "desk": 3, "laptop": 1 }`.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/VersionVector.swift#VersionVector
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/VersionVector.swift#VersionVector.counters
 * @upstream-differs a readonly record with functions over it, rather than a struct with methods
 */
export type VersionVector = Readonly<Record<string, number>>;

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/VersionVector.swift#VersionVector.init */
export const EMPTY_VECTOR: VersionVector = Object.freeze({});

/**
 * The number of writes by `device` this version reflects.
 *
 * An own property only: a device called `toString` has written nothing unless
 * the vector says so.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/VersionVector.swift#VersionVector.subscript
 */
export function writesBy(vector: VersionVector, device: string): number {
  return Object.hasOwn(vector, device) ? (vector[device] ?? 0) : 0;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/VersionVector.swift#VersionVector.isEmpty */
export function isEmptyVector(vector: VersionVector): boolean {
  return Object.keys(vector).length === 0;
}

/**
 * Counts one more write by `device`.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/VersionVector.swift#VersionVector.increment
 */
export function incremented(vector: VersionVector, device: string): VersionVector {
  return { ...vector, [device]: writesBy(vector, device) + 1 };
}

/**
 * Whether this version includes every write the other one knows about. A
 * version that dominates another is simply ahead of it: taking it loses
 * nothing, and no merge is needed.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/VersionVector.swift#VersionVector.dominates
 */
export function dominates(vector: VersionVector, other: VersionVector): boolean {
  return Object.entries(other).every(([device, count]) => writesBy(vector, device) >= count);
}

/**
 * Neither one has seen everything the other has: both were written from a
 * common past without knowing about each other. This is the case the merge
 * exists for.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/VersionVector.swift#VersionVector.isConcurrent
 */
export function isConcurrent(vector: VersionVector, other: VersionVector): boolean {
  return !dominates(vector, other) && !dominates(other, vector);
}

/**
 * The version that has seen both — what a merged collection carries.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/VersionVector.swift#VersionVector.merged
 */
export function mergedVectors(vector: VersionVector, other: VersionVector): VersionVector {
  const union: Record<string, number> = { ...vector };
  for (const [device, count] of Object.entries(other)) {
    union[device] = Math.max(writesBy(vector, device), count);
  }
  return union;
}

/** Whether two versions have the same counters. */
export function vectorsEqual(one: VersionVector, other: VersionVector): boolean {
  return dominates(one, other) && dominates(other, one);
}

/**
 * Reads a version back from a file: a dictionary of whole, non-negative write
 * counts. Anything else is not a version, and says so.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/VersionVector.swift#VersionVector.encode
 */
export function readVector(raw: unknown): VersionVector {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SyntaxError("A version vector is a dictionary of write counts.");
  }
  const counters: Record<string, number> = {};
  for (const [device, count] of Object.entries(raw)) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new SyntaxError(`Not a write count for ${device}: ${String(count)}`);
    }
    counters[device] = count;
  }
  return counters;
}
