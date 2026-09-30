/**
 * A version number — this app's, or one published on github.com — read and
 * compared the way a version number is meant to be.
 *
 * The reason this is a type rather than two strings is the comparison: text
 * compares wrongly ("0.8.10" sorts before "0.8.9"), so the parts are compared
 * as numbers, left to right, with the ones a side lacks read as zero — "0.9"
 * and "0.9.0" are the same version.
 *
 * **This edition's number is upstream's, and a build of its own.** `0.8.5` is
 * the upstream release the port is level with; `0.8.5-2` is the second build of
 * this edition made against it. The build number is one more part after the
 * upstream's three, so `0.8.5` < `0.8.5-1` < `0.8.5-2` < `0.8.6` — which is
 * not semantic versioning, where a hyphen names a *pre*-release, and is why the
 * rule is written down here rather than left to a library. A tail that is not a
 * number (`0.8.5-dev`, `0.8.5-1-dev`) is a label and is not compared.
 *
 * @upstream ByteRipperApp/Updates/AppVersion.swift#AppVersion
 * @upstream-differs the hyphenated build number is a part of its own, which upstream's numbers never carry
 */
export interface AppVersion {
  /**
   * The number as it was written, with a leading "v" taken off: "0.8.5-2".
   *
   * @upstream ByteRipperApp/Updates/AppVersion.swift#AppVersion.text
   */
  readonly text: string;
  /**
   * The parts to compare.
   *
   * @upstream ByteRipperApp/Updates/AppVersion.swift#AppVersion.parts
   */
  readonly parts: readonly number[];
}

/**
 * Reads a version out of a build's own number or out of a release tag like
 * "v0.8.5-2"; `undefined` when there is no number in it at all, so a caller
 * can say nothing rather than guess at one.
 *
 * @upstream ByteRipperApp/Updates/AppVersion.swift#AppVersion.init
 */
export function parseAppVersion(written: string): AppVersion | undefined {
  const trimmed = written.trim();
  const text = /^v/i.test(trimmed) ? trimmed.slice(1) : trimmed;
  const found = /^(\d+(?:\.\d+)*)(?:-(\d+))?/.exec(text);
  if (found === null) return undefined;
  const parts = (found[1] ?? "").split(".").map(Number);
  if (found[2] !== undefined) parts.push(Number(found[2]));
  return { text, parts };
}

/**
 * Negative when `left` is older, positive when it is newer, zero when they are
 * the same version. Missing parts are zero, so this agrees with itself.
 *
 * @upstream ByteRipperApp/Updates/AppVersion.swift#AppVersion.compare
 */
export function compareAppVersions(left: AppVersion, right: AppVersion): number {
  const length = Math.max(left.parts.length, right.parts.length);
  for (let index = 0; index < length; index++) {
    const one = left.parts[index] ?? 0;
    const other = right.parts[index] ?? 0;
    if (one !== other) return one < other ? -1 : 1;
  }
  return 0;
}
