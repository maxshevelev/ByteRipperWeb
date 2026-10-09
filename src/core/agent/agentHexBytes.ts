import { AgentToolError } from "@/core/agent/agentTool";

/**
 * Hex text as bytes: pairs of digits, spaces, commas and `0x` prefixes ignored. A model writes
 * bytes the way a dump shows them — `"DE AD BE EF"` — or run together.
 *
 * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.hexBytes
 */
export function parseHexBytes(text: string, name: string): Uint8Array {
  const digits = text.replaceAll(/0x/gi, "").replaceAll(/[\s,]/g, "");
  if (digits.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(digits)) {
    throw new AgentToolError(
      `\`${name}\` is not hex bytes. Give pairs of hex digits, e.g. "DE AD BE EF".`
    );
  }
  const bytes = new Uint8Array(digits.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Bytes as hex text, in pairs with a space between.
 *
 * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.hexText
 */
export const hexByteText = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
