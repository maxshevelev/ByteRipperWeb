/**
 * SHA-256, fed in pieces: a kept history chains each record's hash over the one before it and
 * its own bytes, and a record's body can run to gigabytes, read a slice at a time.
 *
 * Written out rather than taken from a package, as `src/firmware/me/crypto/digest.ts` is and for
 * its reason: FIPS 180-4 specifies it completely and NIST publishes the vectors the test checks.
 * That one hashes a message whole; this one is fed, and `src/core` may not reach `src/firmware`.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog
 * @upstream-differs CryptoKit's `SHA256` upstream; the page's `crypto.subtle` hashes one buffer and
 * answers asynchronously
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export class Sha256 {
  private readonly state = Uint32Array.of(
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19
  );
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private filled = 0;
  private total = 0;

  update(bytes: Uint8Array): this {
    let at = 0;
    this.total += bytes.length;
    if (this.filled > 0) {
      const take = Math.min(64 - this.filled, bytes.length);
      this.block.set(bytes.subarray(0, take), this.filled);
      this.filled += take;
      at = take;
      if (this.filled < 64) return this;
      this.compress(this.block, 0);
      this.filled = 0;
    }
    for (; at + 64 <= bytes.length; at += 64) this.compress(bytes, at);
    if (at < bytes.length) {
      this.block.set(bytes.subarray(at));
      this.filled = bytes.length - at;
    }
    return this;
  }

  /** The digest; the hasher is spent after it. */
  digest(): Uint8Array {
    const bits = this.total * 8;
    const tail = new Uint8Array(this.filled < 56 ? 64 - this.filled : 128 - this.filled);
    tail[0] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, Math.floor(bits / 2 ** 32), false);
    view.setUint32(tail.length - 4, bits >>> 0, false);
    this.update(tail);
    const out = new Uint8Array(32);
    const result = new DataView(out.buffer);
    for (let index = 0; index < 8; index++) {
      result.setUint32(index * 4, this.state[index] as number, false);
    }
    return out;
  }

  private compress(bytes: Uint8Array, at: number): void {
    const w = this.words;
    for (let index = 0; index < 16; index++) {
      const i = at + index * 4;
      w[index] =
        (((bytes[i] as number) << 24) |
          ((bytes[i + 1] as number) << 16) |
          ((bytes[i + 2] as number) << 8) |
          (bytes[i + 3] as number)) >>>
        0;
    }
    for (let index = 16; index < 64; index++) {
      const x = w[index - 15] as number;
      const y = w[index - 2] as number;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[index] = ((w[index - 16] as number) + s0 + (w[index - 7] as number) + s1) >>> 0;
    }
    const h = this.state;
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;
    for (let index = 0; index < 64; index++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + (K[index] as number) + (w[index] as number)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
    h[5] = ((h[5] as number) + f) >>> 0;
    h[6] = ((h[6] as number) + g) >>> 0;
    h[7] = ((h[7] as number) + hh) >>> 0;
  }
}

/** The SHA-256 of `bytes`. */
export const sha256 = (bytes: Uint8Array): Uint8Array => new Sha256().update(bytes).digest();
