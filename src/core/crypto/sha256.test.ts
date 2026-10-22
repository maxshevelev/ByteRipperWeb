import { describe, expect, it } from "vitest";
import { Sha256, sha256 } from "@/core/crypto/sha256";

/** NIST's examples for SHA-256 (FIPS 180-4), and the same fed in pieces. */

const hexOf = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const ascii = (text: string) => Uint8Array.from(text, (unit) => unit.charCodeAt(0));

describe("SHA-256", () => {
  it("hashes NIST's vectors", () => {
    expect(hexOf(sha256(ascii("")))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(hexOf(sha256(ascii("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(hexOf(sha256(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
    expect(hexOf(sha256(new Uint8Array(1_000_000).fill(0x61)))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
    );
  });

  it("gives the same digest however the message is cut", () => {
    const message = Uint8Array.from({ length: 1000 }, (_, index) => (index * 31) & 0xff);
    const whole = hexOf(sha256(message));
    for (const cut of [1, 3, 63, 64, 65, 127, 500]) {
      const hasher = new Sha256();
      for (let at = 0; at < message.length; at += cut)
        hasher.update(message.subarray(at, at + cut));
      expect(hexOf(hasher.digest()), `cut every ${cut}`).toBe(whole);
    }
  });
});
