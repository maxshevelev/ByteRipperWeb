import { bzip2Decode } from "@/firmware/compression/bzip2Codec";

/**
 * The device overrides a Mac's system-flags store carries: Apple's own list of what to add to,
 * change in and take out of the device tree the firmware builds for this board — its USB and
 * Thunderbolt ports, thermal sensors, fan limits.
 *
 * The store's `overrides` variable is a bzip2 stream of text, one rule a line, three
 * tab-separated fields: the action, what it applies to (`()` for every device), and the device
 * or the properties it sets. Nothing documents the format; this reads what a 2010 to 2016
 * MacBook's store holds, and a line that does not fit is kept whole rather than guessed at.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleOverrides.swift#AppleOverrides
 */
export interface AppleOverrides {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleOverrides.swift#AppleOverrides.rules */
  readonly rules: readonly AppleOverrideRule[];
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleOverrides.swift#AppleOverrides.Rule */
export interface AppleOverrideRule {
  /**
   * `ADD_DEVICE`, `SET_PROPERTY`, `REMOVE_DEVICE`, … as written.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleOverrides.swift#AppleOverrides.Rule.action
   */
  readonly action: string;
  /**
   * The match the rule applies to, without its parentheses; empty when it applies to every
   * device.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleOverrides.swift#AppleOverrides.Rule.appliesTo
   */
  readonly appliesTo: string;
  /**
   * The rest of the line: the device an add creates, the properties a set writes, or the second
   * match of a remove.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleOverrides.swift#AppleOverrides.Rule.detail
   */
  readonly detail: string;
}

/**
 * The variable whose data this reads.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleOverrides.swift#AppleOverrides.variableName
 */
export const APPLE_OVERRIDES_VARIABLE = "overrides";

/** How much text a store of at most 64 KiB may unpack to. */
const LIMIT = 1 << 22;

/**
 * The text a variable's data unpacks to, or nothing when it is not a bzip2 stream — a store of
 * another vendor's, or a damaged one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleOverrides.swift#AppleOverrides.unpacked
 */
export function unpackedOverrides(data: Uint8Array): Uint8Array | undefined {
  try {
    return bzip2Decode(data, LIMIT);
  } catch {
    return undefined;
  }
}

/**
 * The rules in a variable's data, or nothing when it is not a bzip2 stream of text.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleOverrides.swift#AppleOverrides.read
 */
export function readAppleOverrides(data: Uint8Array): AppleOverrides | undefined {
  const text = unpackedOverrides(data);
  if (text === undefined) return undefined;
  const lines = utf8(text)
    .split(/[\n\0]/)
    .filter((line) => line !== "");
  const rules = lines.map((line): AppleOverrideRule => {
    const fields = line.split("\t");
    if (fields.length < 3) return { action: line, appliesTo: "", detail: "" };
    let target = fields[1] ?? "";
    if (target.startsWith("(") && target.endsWith(")")) target = target.slice(1, -1);
    return { action: fields[0] ?? "", appliesTo: target, detail: fields.slice(2).join("\t") };
  });
  return rules.length === 0 ? undefined : { rules };
}

/** The bytes as UTF-8 text; a byte that is none reads as itself. */
function utf8(bytes: Uint8Array): string {
  let escaped = "";
  for (const byte of bytes) escaped += `%${byte.toString(16).padStart(2, "0")}`;
  try {
    return decodeURIComponent(escaped);
  } catch {
    return String.fromCharCode(...bytes);
  }
}
