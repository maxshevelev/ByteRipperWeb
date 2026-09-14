/**
 * The x86 branch converter (BCJ) — a port of the LZMA SDK's `Bra86.c` (Igor
 * Pavlov, public domain), in place over a buffer, from position 0.
 *
 * The encoder turns the relative targets of `call`/`jmp rel32` instructions into
 * absolute ones so they compress; decoding turns them back. It assumes x86 code:
 * over anything else it changes correct bytes into wrong ones without failing.
 *
 * The SDK's routine is a web of `goto`s; this keeps its labels as the states of
 * a loop, so each jump is the one the C takes.
 */

const needsConversionForMsByte = (b: number) => ((b + 1) & 0xfe) === 0;

export function x86BranchConvert(data: Uint8Array, encoding: boolean): void {
  const size = data.length;
  if (size < 5) return;
  const lim = size - 4;
  let mask = 0;
  let p = 0;

  const isBcjByte = (index: number) => ((data[index] ?? 0) & 0xfe) === 0xe8;
  const getUi32 = (index: number) =>
    ((data[index] ?? 0) |
      ((data[index + 1] ?? 0) << 8) |
      ((data[index + 2] ?? 0) << 16) |
      ((data[index + 3] ?? 0) << 24)) >>>
    0;
  const setUi32 = (index: number, value: number) => {
    data[index] = value & 0xff;
    data[index + 1] = (value >>> 8) & 0xff;
    data[index + 2] = (value >>> 16) & 0xff;
    data[index + 3] = (value >>> 24) & 0xff;
  };
  /** The offset of the next instruction, from the start of the buffer. */
  const pcGet = () => p + 4;
  const convert = (v: number, c: number) => (encoding ? (v + c) >>> 0 : (v - c) >>> 0);

  type Label = "start" | "cont" | "masked" | "mainLoop" | "a3" | "finP" | "fin";
  let label: Label = "start";

  for (;;) {
    switch (label) {
      case "cont":
        mask |= 4;
        label = "start";
        break;

      case "start": {
        if (p >= lim) {
          label = "fin";
          break;
        }
        const q = p;
        p += 4;
        if (isBcjByte(q)) {
          p -= 3;
          label = "masked";
          break;
        }
        mask >>= 1;
        if (isBcjByte(q + 1)) {
          p -= 2;
          label = "masked";
          break;
        }
        mask >>= 1;
        if (isBcjByte(q + 2)) {
          p -= 1;
          label = "masked";
          break;
        }
        mask = 0;
        label = isBcjByte(q + 3) ? "a3" : "mainLoop";
        break;
      }

      // m0 / m1 / m2, once `p` stands on the operand.
      case "masked": {
        if (mask === 0) {
          label = "a3";
          break;
        }
        if (p > lim) {
          label = "finP";
          break;
        }
        if (mask > 4 || mask === 3) {
          mask >>= 1;
          label = "cont";
          break;
        }
        mask >>= 1;
        if (needsConversionForMsByte(data[p + mask] ?? 0)) {
          label = "cont";
          break;
        }
        let v = (getUi32(p) + (1 << 24)) >>> 0;
        if ((v & 0xfe00_0000) !== 0) {
          label = "cont";
          break;
        }
        const c = pcGet();
        v = convert(v, c);
        mask <<= 3;
        if (needsConversionForMsByte(v >>> mask)) {
          v = (v ^ ((0x100 << mask) - 1)) >>> 0;
          v = convert(v, c);
        }
        mask = 0;
        v = ((v & ((1 << 25) - 1)) - (1 << 24)) >>> 0;
        setUi32(p, v);
        p += 4;
        label = "mainLoop";
        break;
      }

      case "mainLoop": {
        if (p >= lim) {
          label = "fin";
          break;
        }
        let found: Label = "fin";
        for (;;) {
          const q = p;
          p += 4;
          if (isBcjByte(q)) {
            p -= 3;
            found = "a3";
            break;
          }
          if (isBcjByte(q + 1)) {
            p -= 2;
            found = "a3";
            break;
          }
          if (isBcjByte(q + 2)) {
            p -= 1;
            found = "a3";
            break;
          }
          if (isBcjByte(q + 3)) {
            found = "a3";
            break;
          }
          if (p >= lim) break;
        }
        label = found;
        break;
      }

      case "a3": {
        if (p > lim) {
          label = "finP";
          break;
        }
        let v = (getUi32(p) + (1 << 24)) >>> 0;
        if ((v & 0xfe00_0000) !== 0) {
          label = "cont";
          break;
        }
        v = convert(v, pcGet());
        v = ((v & ((1 << 25) - 1)) - (1 << 24)) >>> 0;
        setUi32(p, v);
        p += 4;
        label = "mainLoop";
        break;
      }

      case "finP":
        p--;
        label = "fin";
        break;

      case "fin":
        return;
    }
  }
}
