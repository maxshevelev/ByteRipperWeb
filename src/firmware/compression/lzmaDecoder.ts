/**
 * The LZMA decoder — a port of the LZMA SDK's `LzmaDec.c` (Igor Pavlov, public
 * domain), the decoder upstream vendors in its `FirmwareCompression` package.
 *
 * Ported path for path, including the parts a whole-buffer decode rarely takes:
 * the dummy look-ahead that decides whether the last symbol fits, the temporary
 * buffer the stream's tail is decoded through, and the strict finish — a stream
 * that has filled the output must end there, with an end marker or with a range
 * coder at rest. The names are the SDK's, so the two read side by side.
 *
 * Unsigned 32-bit arithmetic is spelled with `>>> 0` where C wraps silently.
 */

// MARK: - The SDK's constants

const kTopValue = 1 << 24;
const kNumBitModelTotalBits = 11;
const kBitModelTotal = 1 << kNumBitModelTotalBits;
const kNumMoveBits = 5;
const RC_INIT_SIZE = 5;

const kNumPosBitsMax = 4;
const kNumPosStatesMax = 1 << kNumPosBitsMax;
const kLenNumLowBits = 3;
const kLenNumLowSymbols = 1 << kLenNumLowBits;
const kLenNumHighBits = 8;
const kLenNumHighSymbols = 1 << kLenNumHighBits;
const LenLow = 0;
const LenHigh = LenLow + 2 * (kNumPosStatesMax << kLenNumLowBits);
const kNumLenProbs = LenHigh + kLenNumHighSymbols;
const LenChoice = LenLow;
const LenChoice2 = LenLow + (1 << kLenNumLowBits);

const kNumStates = 12;
const kNumStates2 = 16;
const kNumLitStates = 7;
const kStartPosModelIndex = 4;
const kEndPosModelIndex = 14;
const kNumFullDistances = 1 << (kEndPosModelIndex >> 1);
const kNumPosSlotBits = 6;
const kNumLenToPosStates = 4;
const kNumAlignBits = 4;
const kAlignTableSize = 1 << kNumAlignBits;
const kMatchMinLen = 2;
const kMatchSpecLenStart = kMatchMinLen + kLenNumLowSymbols * 2 + kLenNumHighSymbols;
const kMatchSpecLen_Error_Data = 1 << 9;
const kMatchSpecLen_Error_Fail = kMatchSpecLen_Error_Data - 1;

/** The probabilities are addressed from 1664 in, as `probs_1664`. */
const kStartOffset = 1664;
const SpecPos = -kStartOffset;
const IsRep0Long = SpecPos + kNumFullDistances;
const RepLenCoder = IsRep0Long + (kNumStates2 << kNumPosBitsMax);
const LenCoder = RepLenCoder + kNumLenProbs;
const IsMatch = LenCoder + kNumLenProbs;
const Align = IsMatch + (kNumStates2 << kNumPosBitsMax);
const IsRep = Align + kAlignTableSize;
const IsRepG0 = IsRep + kNumStates;
const IsRepG1 = IsRepG0 + kNumStates;
const IsRepG2 = IsRepG1 + kNumStates;
const PosSlot = IsRepG2 + kNumStates;
const Literal = PosSlot + (kNumLenToPosStates << kNumPosSlotBits);
const NUM_BASE_PROBS = Literal + kStartOffset;

const LZMA_LIT_SIZE = 0x300;
const LZMA_REQUIRED_INPUT_MAX = 20;
const LZMA_DIC_MIN = 1 << 12;
const LZMA_PROPS_SIZE = 5;
const kBadRepCode = 0xc000_0000 - 0x400;

export const SZ_OK = 0;
export const SZ_ERROR_DATA = 1;
export const SZ_ERROR_UNSUPPORTED = 4;
export const SZ_ERROR_INPUT_EOF = 6;
export const SZ_ERROR_FAIL = 11;

const STATUS_NOT_SPECIFIED = 0;
const STATUS_FINISHED_WITH_MARK = 1;
const STATUS_NOT_FINISHED = 2;
const STATUS_NEEDS_MORE_INPUT = 3;
const STATUS_MAYBE_FINISHED_WITHOUT_MARK = 4;

const FINISH_ANY = 0;
const FINISH_END = 1;

const DUMMY_INPUT_EOF = 0;
const DUMMY_LIT = 1;
const DUMMY_MATCH = 2;
const DUMMY_REP = 3;

// MARK: - The decoder's state

interface Decoder {
  lc: number;
  lp: number;
  pb: number;
  dicSize: number;
  probs: Uint16Array;
  dic: Uint8Array;
  dicBufSize: number;
  dicPos: number;
  /** Where `buf` reads from: the caller's stream, or the temporary buffer. */
  input: Uint8Array;
  buf: number;
  range: number;
  code: number;
  processedPos: number;
  checkDicSize: number;
  reps: [number, number, number, number];
  state: number;
  remainLen: number;
  tempBuf: Uint8Array;
  tempBufSize: number;
}

// MARK: - LZMA_DECODE_REAL

/** @upstream Packages/FirmwareCompression/Sources/CLZMA/SDK/LzmaDec.c#LZMA_DECODE_REAL */
function decodeReal(p: Decoder, limit: number, bufLimit: number): number {
  const probs = p.probs;
  const input = p.input;
  let state = p.state;
  let [rep0, rep1, rep2, rep3] = p.reps;
  const pbMask = (1 << p.pb) - 1;
  const lc = p.lc;
  const lpMask = (0x100 << p.lp) - (0x100 >> lc);
  const dic = p.dic;
  const dicBufSize = p.dicBufSize;
  let dicPos = p.dicPos;
  let processedPos = p.processedPos;
  const checkDicSize = p.checkDicSize;
  let len = 0;
  let buf = p.buf;
  let range = p.range;
  let code = p.code;

  /** IF_BIT_0 with UPDATE_0 / UPDATE_1 folded in: the bit, and the model moved. */
  const bit = (index: number): number => {
    const ttt = probs[index] ?? 0;
    if (range < kTopValue) {
      range = (range << 8) >>> 0;
      code = ((code << 8) | (input[buf++] ?? 0)) >>> 0;
    }
    const bound = (range >>> kNumBitModelTotalBits) * ttt;
    if (code < bound) {
      range = bound;
      probs[index] = ttt + ((kBitModelTotal - ttt) >>> kNumMoveBits);
      return 0;
    }
    range = (range - bound) >>> 0;
    code = (code - bound) >>> 0;
    probs[index] = ttt - (ttt >>> kNumMoveBits);
    return 1;
  };
  const at = (offset: number) => kStartOffset + offset;

  do {
    const posState = (processedPos & pbMask) << 4;
    let prob = at(IsMatch) + posState + state;
    if (bit(prob) === 0) {
      prob = at(Literal);
      if (processedPos !== 0 || checkDicSize !== 0) {
        const previous = dic[(dicPos === 0 ? dicBufSize : dicPos) - 1] ?? 0;
        prob += 3 * ((((processedPos << 8) + previous) & lpMask) << lc);
      }
      processedPos++;
      let symbol = 1;
      if (state < kNumLitStates) {
        state -= state < 4 ? state : 3;
        do symbol = symbol * 2 + bit(prob + symbol);
        while (symbol < 0x100);
      } else {
        let matchByte = dic[dicPos - rep0 + (dicPos < rep0 ? dicBufSize : 0)] ?? 0;
        let offs = 0x100;
        state -= state < 10 ? 3 : 6;
        do {
          matchByte += matchByte;
          const b = offs;
          offs &= matchByte;
          if (bit(prob + (offs + b + symbol)) === 0) {
            symbol = symbol * 2;
            offs ^= b;
          } else {
            symbol = symbol * 2 + 1;
          }
        } while (symbol < 0x100);
      }
      dic[dicPos++] = symbol & 0xff;
      continue;
    }

    prob = at(IsRep) + state;
    if (bit(prob) === 0) {
      state += kNumStates;
      prob = at(LenCoder);
    } else {
      prob = at(IsRepG0) + state;
      if (bit(prob) === 0) {
        prob = at(IsRep0Long) + posState + state;
        if (bit(prob) === 0) {
          dic[dicPos] = dic[dicPos - rep0 + (dicPos < rep0 ? dicBufSize : 0)] ?? 0;
          dicPos++;
          processedPos++;
          state = state < kNumLitStates ? 9 : 11;
          continue;
        }
      } else {
        let distance: number;
        prob = at(IsRepG1) + state;
        if (bit(prob) === 0) {
          distance = rep1;
        } else {
          prob = at(IsRepG2) + state;
          if (bit(prob) === 0) {
            distance = rep2;
          } else {
            distance = rep3;
            rep3 = rep2;
          }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = distance;
      }
      state = state < kNumLitStates ? 8 : 11;
      prob = at(RepLenCoder);
    }

    {
      let probLen = prob + LenChoice;
      if (bit(probLen) === 0) {
        probLen = prob + LenLow + posState;
        len = 1;
        len = len * 2 + bit(probLen + len);
        len = len * 2 + bit(probLen + len);
        len = len * 2 + bit(probLen + len);
        len -= 8;
      } else {
        probLen = prob + LenChoice2;
        if (bit(probLen) === 0) {
          probLen = prob + LenLow + posState + (1 << kLenNumLowBits);
          len = 1;
          len = len * 2 + bit(probLen + len);
          len = len * 2 + bit(probLen + len);
          len = len * 2 + bit(probLen + len);
        } else {
          probLen = prob + LenHigh;
          len = 1;
          do len = len * 2 + bit(probLen + len);
          while (len < kLenNumHighSymbols);
          len -= kLenNumHighSymbols;
          len += kLenNumLowSymbols * 2;
        }
      }
    }

    if (state >= kNumStates) {
      prob =
        at(PosSlot) +
        ((len < kNumLenToPosStates ? len : kNumLenToPosStates - 1) << kNumPosSlotBits);
      let distance = 1;
      for (let step = 0; step < 6; step++) distance = distance * 2 + bit(prob + distance);
      distance -= 0x40;
      if (distance >= kStartPosModelIndex) {
        const posSlot = distance;
        let numDirectBits = (distance >>> 1) - 1;
        distance = 2 | (distance & 1);
        if (posSlot < kEndPosModelIndex) {
          distance <<= numDirectBits;
          prob = at(SpecPos);
          let m = 1;
          distance++;
          do {
            if (bit(prob + distance) === 0) {
              distance += m;
              m += m;
            } else {
              m += m;
              distance += m;
            }
          } while (--numDirectBits);
          distance -= m;
        } else {
          numDirectBits -= kNumAlignBits;
          do {
            if (range < kTopValue) {
              range = (range << 8) >>> 0;
              code = ((code << 8) | (input[buf++] ?? 0)) >>> 0;
            }
            range >>>= 1;
            code = (code - range) >>> 0;
            const t = code >>> 31 === 1 ? 0xffff_ffff : 0;
            distance = ((distance << 1) >>> 0) + (t === 0 ? 1 : 0);
            code = (code + (range & t)) >>> 0;
          } while (--numDirectBits);
          prob = at(Align);
          distance = (distance << kNumAlignBits) >>> 0;
          let i = 1;
          i += bit(prob + i) === 0 ? 1 : 2;
          i += bit(prob + i) === 0 ? 2 : 4;
          i += bit(prob + i) === 0 ? 4 : 8;
          if (bit(prob + i) === 0) i -= 8;
          distance = (distance | i) >>> 0;
          if (distance === 0xffff_ffff) {
            len = kMatchSpecLenStart;
            state -= kNumStates;
            break;
          }
        }
      }
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      rep0 = distance + 1;
      state = state < kNumStates + kNumLitStates ? kNumLitStates : kNumLitStates + 3;
      if (distance >= (checkDicSize === 0 ? processedPos : checkDicSize)) {
        len += kMatchSpecLen_Error_Data + kMatchMinLen;
        break;
      }
    }

    len += kMatchMinLen;
    const rem = limit - dicPos;
    if (rem === 0) break;
    let curLen = rem < len ? rem : len;
    let pos = dicPos - rep0 + (dicPos < rep0 ? dicBufSize : 0);
    processedPos += curLen;
    len -= curLen;
    if (curLen <= dicBufSize - pos) {
      const source = pos - dicPos;
      const end = dicPos + curLen;
      do dic[dicPos] = dic[dicPos + source] ?? 0;
      while (++dicPos !== end);
    } else {
      do {
        dic[dicPos++] = dic[pos] ?? 0;
        if (++pos === dicBufSize) pos = 0;
      } while (--curLen !== 0);
    }
  } while (dicPos < limit && buf < bufLimit);

  if (range < kTopValue) {
    range = (range << 8) >>> 0;
    code = ((code << 8) | (input[buf++] ?? 0)) >>> 0;
  }
  p.buf = buf;
  p.range = range;
  p.code = code;
  p.remainLen = len;
  p.dicPos = dicPos;
  p.processedPos = processedPos;
  p.reps = [rep0, rep1, rep2, rep3];
  p.state = state;
  return len >= kMatchSpecLen_Error_Data ? SZ_ERROR_DATA : SZ_OK;
}

/** @upstream Packages/FirmwareCompression/Sources/CLZMA/SDK/LzmaDec.c#LzmaDec_WriteRem */
function writeRem(p: Decoder, limit: number): void {
  let len = p.remainLen;
  if (len === 0) return;
  let dicPos = p.dicPos;
  const rem = limit - dicPos;
  if (rem < len) {
    len = rem;
    if (len === 0) return;
  }
  if (p.checkDicSize === 0 && (p.dicSize - p.processedPos) >>> 0 <= len) {
    p.checkDicSize = p.dicSize;
  }
  p.processedPos += len;
  p.remainLen -= len;
  const dic = p.dic;
  const rep0 = p.reps[0];
  do {
    dic[dicPos] = dic[dicPos - rep0 + (dicPos < rep0 ? p.dicBufSize : 0)] ?? 0;
    dicPos++;
  } while (--len);
  p.dicPos = dicPos;
}

/** @upstream Packages/FirmwareCompression/Sources/CLZMA/SDK/LzmaDec.c#LzmaDec_DecodeReal2 */
function decodeReal2(p: Decoder, limit: number, bufLimit: number): number {
  let bounded = limit;
  if (p.checkDicSize === 0) {
    const rem = (p.dicSize - p.processedPos) >>> 0;
    if (bounded - p.dicPos > rem) bounded = p.dicPos + rem;
  }
  const result = decodeReal(p, bounded, bufLimit);
  if (p.checkDicSize === 0 && p.processedPos >= p.dicSize) p.checkDicSize = p.dicSize;
  return result;
}

// MARK: - LzmaDec_TryDummy

/**
 * Whether the next symbol can be decoded from `input[start, end)`, and what kind
 * it is — without moving the model. `pos` is where it would leave the input.
 *
 * @upstream Packages/FirmwareCompression/Sources/CLZMA/SDK/LzmaDec.c#LzmaDec_TryDummy
 */
function tryDummy(
  p: Decoder,
  input: Uint8Array,
  start: number,
  end: number
): { readonly result: number; readonly pos: number } {
  let range = p.range;
  let code = p.code;
  let buf = start;
  const probs = p.probs;
  let state = p.state;
  const at = (offset: number) => kStartOffset + offset;
  const eof = { result: DUMMY_INPUT_EOF, pos: buf };

  const normalize = (): boolean => {
    if (range < kTopValue) {
      if (buf >= end) return false;
      range = (range << 8) >>> 0;
      code = ((code << 8) | (input[buf++] ?? 0)) >>> 0;
    }
    return true;
  };
  /** IF_BIT_0_CHECK: the bit, or -1 when the input runs out first. */
  const bit = (index: number): number => {
    const ttt = probs[index] ?? 0;
    if (!normalize()) return -1;
    const bound = (range >>> kNumBitModelTotalBits) * ttt;
    if (code < bound) {
      range = bound;
      return 0;
    }
    range = (range - bound) >>> 0;
    code = (code - bound) >>> 0;
    return 1;
  };

  let result: number;
  const posState = (p.processedPos & ((1 << p.pb) - 1)) << 4;
  let prob = at(IsMatch) + posState + state;
  let b = bit(prob);
  if (b < 0) return eof;
  if (b === 0) {
    prob = at(Literal);
    if (p.checkDicSize !== 0 || p.processedPos !== 0) {
      const previous = p.dic[(p.dicPos === 0 ? p.dicBufSize : p.dicPos) - 1] ?? 0;
      prob +=
        LZMA_LIT_SIZE * (((p.processedPos & ((1 << p.lp) - 1)) << p.lc) + (previous >> (8 - p.lc)));
    }
    let symbol = 1;
    if (state < kNumLitStates) {
      do {
        b = bit(prob + symbol);
        if (b < 0) return eof;
        symbol = symbol * 2 + b;
      } while (symbol < 0x100);
    } else {
      const rep0 = p.reps[0];
      let matchByte = p.dic[p.dicPos - rep0 + (p.dicPos < rep0 ? p.dicBufSize : 0)] ?? 0;
      let offs = 0x100;
      do {
        matchByte += matchByte;
        const m = offs;
        offs &= matchByte;
        b = bit(prob + (offs + m + symbol));
        if (b < 0) return eof;
        if (b === 0) {
          symbol = symbol * 2;
          offs ^= m;
        } else {
          symbol = symbol * 2 + 1;
        }
      } while (symbol < 0x100);
    }
    result = DUMMY_LIT;
  } else {
    prob = at(IsRep) + state;
    b = bit(prob);
    if (b < 0) return eof;
    if (b === 0) {
      state = 0;
      prob = at(LenCoder);
      result = DUMMY_MATCH;
    } else {
      result = DUMMY_REP;
      prob = at(IsRepG0) + state;
      b = bit(prob);
      if (b < 0) return eof;
      if (b === 0) {
        prob = at(IsRep0Long) + posState + state;
        b = bit(prob);
        if (b < 0) return eof;
        if (b === 0) {
          if (!normalize()) return { result: DUMMY_INPUT_EOF, pos: buf };
          return { result, pos: buf };
        }
      } else {
        prob = at(IsRepG1) + state;
        b = bit(prob);
        if (b < 0) return eof;
        if (b === 1) {
          prob = at(IsRepG2) + state;
          b = bit(prob);
          if (b < 0) return eof;
        }
      }
      state = kNumStates;
      prob = at(RepLenCoder);
    }

    let limit: number;
    let offset: number;
    let probLen = prob + LenChoice;
    b = bit(probLen);
    if (b < 0) return eof;
    if (b === 0) {
      probLen = prob + LenLow + posState;
      offset = 0;
      limit = 1 << kLenNumLowBits;
    } else {
      probLen = prob + LenChoice2;
      b = bit(probLen);
      if (b < 0) return eof;
      if (b === 0) {
        probLen = prob + LenLow + posState + (1 << kLenNumLowBits);
        offset = kLenNumLowSymbols;
        limit = 1 << kLenNumLowBits;
      } else {
        probLen = prob + LenHigh;
        offset = kLenNumLowSymbols * 2;
        limit = 1 << kLenNumHighBits;
      }
    }
    let len = 1;
    do {
      b = bit(probLen + len);
      if (b < 0) return eof;
      len = len * 2 + b;
    } while (len < limit);
    len = len - limit + offset;

    if (state < 4) {
      prob =
        at(PosSlot) +
        ((len < kNumLenToPosStates - 1 ? len : kNumLenToPosStates - 1) << kNumPosSlotBits);
      let posSlot = 1;
      do {
        b = bit(prob + posSlot);
        if (b < 0) return eof;
        posSlot = posSlot * 2 + b;
      } while (posSlot < 1 << kNumPosSlotBits);
      posSlot -= 1 << kNumPosSlotBits;
      if (posSlot >= kStartPosModelIndex) {
        let numDirectBits = (posSlot >> 1) - 1;
        if (posSlot < kEndPosModelIndex) {
          prob = at(SpecPos) + ((2 | (posSlot & 1)) << numDirectBits);
        } else {
          numDirectBits -= kNumAlignBits;
          do {
            if (!normalize()) return { result: DUMMY_INPUT_EOF, pos: buf };
            range >>>= 1;
            const keep = ((code - range) >>> 0) >>> 31 === 1 ? 0 : 0xffff_ffff;
            code = (code - (range & keep)) >>> 0;
          } while (--numDirectBits);
          prob = at(Align);
          numDirectBits = kNumAlignBits;
        }
        let i = 1;
        let m = 1;
        do {
          b = bit(prob + i);
          if (b < 0) return eof;
          if (b === 0) {
            i += m;
            m += m;
          } else {
            m += m;
            i += m;
          }
        } while (--numDirectBits);
      }
    }
  }
  if (!normalize()) return { result: DUMMY_INPUT_EOF, pos: buf };
  return { result, pos: buf };
}

// MARK: - LzmaDec_DecodeToDic

interface Step {
  readonly result: number;
  readonly status: number;
  readonly srcLen: number;
}

/** @upstream Packages/FirmwareCompression/Sources/CLZMA/SDK/LzmaDec.c#LzmaDec_DecodeToDic */
function decodeToDic(
  p: Decoder,
  dicLimit: number,
  src: Uint8Array,
  srcStart: number,
  length: number,
  finishMode: number
): Step {
  let srcPos = srcStart;
  let inSize = length;
  let srcLen = 0;
  const done = (result: number, status: number): Step => ({ result, status, srcLen });

  if (p.remainLen > kMatchSpecLenStart) {
    if (p.remainLen > kMatchSpecLenStart + 2) {
      return done(
        p.remainLen === kMatchSpecLen_Error_Fail ? SZ_ERROR_FAIL : SZ_ERROR_DATA,
        STATUS_NOT_SPECIFIED
      );
    }
    while (inSize > 0 && p.tempBufSize < RC_INIT_SIZE) {
      p.tempBuf[p.tempBufSize++] = src[srcPos++] ?? 0;
      srcLen++;
      inSize--;
    }
    if (p.tempBufSize !== 0 && p.tempBuf[0] !== 0) return done(SZ_ERROR_DATA, STATUS_NOT_SPECIFIED);
    if (p.tempBufSize < RC_INIT_SIZE) return done(SZ_OK, STATUS_NEEDS_MORE_INPUT);
    const tb = p.tempBuf;
    p.code =
      (((tb[1] ?? 0) << 24) | ((tb[2] ?? 0) << 16) | ((tb[3] ?? 0) << 8) | (tb[4] ?? 0)) >>> 0;
    if (p.checkDicSize === 0 && p.processedPos === 0 && p.code >= kBadRepCode) {
      return done(SZ_ERROR_DATA, STATUS_NOT_SPECIFIED);
    }
    p.range = 0xffff_ffff;
    p.tempBufSize = 0;
    if (p.remainLen > kMatchSpecLenStart + 1) {
      p.probs.fill(kBitModelTotal >> 1);
      p.reps = [1, 1, 1, 1];
      p.state = 0;
    }
    p.remainLen = 0;
  }

  for (;;) {
    if (p.remainLen === kMatchSpecLenStart) {
      if (p.code !== 0) return done(SZ_ERROR_DATA, STATUS_NOT_SPECIFIED);
      return done(SZ_OK, STATUS_FINISHED_WITH_MARK);
    }

    writeRem(p, dicLimit);

    let checkEndMarkNow = false;
    if (p.dicPos >= dicLimit) {
      if (p.remainLen === 0 && p.code === 0) return done(SZ_OK, STATUS_MAYBE_FINISHED_WITHOUT_MARK);
      if (finishMode === FINISH_ANY) return done(SZ_OK, STATUS_NOT_FINISHED);
      if (p.remainLen !== 0) return done(SZ_ERROR_DATA, STATUS_NOT_FINISHED);
      checkEndMarkNow = true;
    }

    if (p.tempBufSize === 0) {
      let bufLimit: number;
      let dummyProcessed = -1;
      if (inSize < LZMA_REQUIRED_INPUT_MAX || checkEndMarkNow) {
        const dummy = tryDummy(p, src, srcPos, srcPos + inSize);
        if (dummy.result === DUMMY_INPUT_EOF) {
          if (inSize >= LZMA_REQUIRED_INPUT_MAX) break;
          srcLen += inSize;
          p.tempBufSize = inSize;
          for (let index = 0; index < inSize; index++) p.tempBuf[index] = src[srcPos + index] ?? 0;
          return done(SZ_OK, STATUS_NEEDS_MORE_INPUT);
        }
        dummyProcessed = dummy.pos - srcPos;
        if (dummyProcessed > LZMA_REQUIRED_INPUT_MAX) break;
        if (checkEndMarkNow && dummy.result !== DUMMY_MATCH) {
          srcLen += dummyProcessed;
          p.tempBufSize = dummyProcessed;
          for (let index = 0; index < dummyProcessed; index++) {
            p.tempBuf[index] = src[srcPos + index] ?? 0;
          }
          return done(SZ_ERROR_DATA, STATUS_NOT_FINISHED);
        }
        bufLimit = srcPos;
      } else {
        bufLimit = srcPos + inSize - LZMA_REQUIRED_INPUT_MAX;
      }

      p.input = src;
      p.buf = srcPos;
      const result = decodeReal2(p, dicLimit, bufLimit);
      const processed = p.buf - srcPos;
      if (dummyProcessed < 0) {
        if (processed > inSize) break;
      } else if (dummyProcessed !== processed) {
        break;
      }
      srcPos += processed;
      inSize -= processed;
      srcLen += processed;
      if (result !== SZ_OK) {
        p.remainLen = kMatchSpecLen_Error_Data;
        return done(SZ_ERROR_DATA, STATUS_NOT_SPECIFIED);
      }
      continue;
    }

    // Some data sits in the temporary buffer: not enough for one symbol in the
    // strict mode this is.
    let rem = p.tempBufSize;
    let ahead = 0;
    let dummyProcessed = -1;
    while (rem < LZMA_REQUIRED_INPUT_MAX && ahead < inSize) {
      p.tempBuf[rem++] = src[srcPos + ahead++] ?? 0;
    }
    if (rem < LZMA_REQUIRED_INPUT_MAX || checkEndMarkNow) {
      const dummy = tryDummy(p, p.tempBuf, 0, rem);
      if (dummy.result === DUMMY_INPUT_EOF) {
        if (rem >= LZMA_REQUIRED_INPUT_MAX) break;
        p.tempBufSize = rem;
        srcLen += ahead;
        return done(SZ_OK, STATUS_NEEDS_MORE_INPUT);
      }
      dummyProcessed = dummy.pos;
      if (dummyProcessed < p.tempBufSize) break;
      if (checkEndMarkNow && dummy.result !== DUMMY_MATCH) {
        srcLen += dummyProcessed - p.tempBufSize;
        p.tempBufSize = dummyProcessed;
        return done(SZ_ERROR_DATA, STATUS_NOT_FINISHED);
      }
    }

    p.input = p.tempBuf;
    p.buf = 0;
    const result = decodeReal2(p, dicLimit, 0);
    let processed = p.buf;
    rem = p.tempBufSize;
    if (dummyProcessed < 0) {
      if (processed > LZMA_REQUIRED_INPUT_MAX || processed < rem) break;
    } else if (dummyProcessed !== processed) {
      break;
    }
    processed -= rem;
    srcPos += processed;
    inSize -= processed;
    srcLen += processed;
    p.tempBufSize = 0;
    if (result !== SZ_OK) {
      p.remainLen = kMatchSpecLen_Error_Data;
      return done(SZ_ERROR_DATA, STATUS_NOT_SPECIFIED);
    }
  }

  // An internal error of the code, memory corruption or hardware failure.
  p.remainLen = kMatchSpecLen_Error_Fail;
  return done(SZ_ERROR_FAIL, STATUS_NOT_SPECIFIED);
}

// MARK: - LzmaDecode, as upstream's clzma_decode calls it

/**
 * Decodes a whole stream laid out as five property bytes, an eight-byte size and
 * the stream, into `output`, to the end: the size is known, so a decode that has
 * filled the buffer is a decode that must be finished.
 *
 * @upstream Packages/FirmwareCompression/Sources/CLZMA/SDK/LzmaDec.c#LzmaDecode
 * @upstream Packages/FirmwareCompression/Sources/CLZMA/SDK/LzmaDec.c#LzmaProps_Decode
 * @upstream Packages/FirmwareCompression/Sources/CLZMA/SDK/LzmaDec.c#LzmaDec_Init
 * @upstream Packages/FirmwareCompression/Sources/CLZMA/SDK/LzmaDec.c#LzmaDec_InitDicAndState
 * @upstream Packages/FirmwareCompression/Sources/CLZMA/CLZMA.c#clzma_decode
 * @upstream-differs one whole-buffer entry: the properties are decoded and the state initialised inline, over a dictionary that is the output buffer
 */
export function lzmaDecodeWhole(
  source: Uint8Array,
  output: Uint8Array
): { readonly result: number; readonly written: number } {
  if (source.length < LZMA_PROPS_SIZE + 8) return { result: SZ_ERROR_INPUT_EOF, written: 0 };
  const inputStart = LZMA_PROPS_SIZE + 8;
  if (source.length - inputStart < RC_INIT_SIZE) return { result: SZ_ERROR_INPUT_EOF, written: 0 };

  // LzmaProps_Decode.
  let dicSize =
    ((source[1] ?? 0) |
      ((source[2] ?? 0) << 8) |
      ((source[3] ?? 0) << 16) |
      ((source[4] ?? 0) << 24)) >>>
    0;
  if (dicSize < LZMA_DIC_MIN) dicSize = LZMA_DIC_MIN;
  let d = source[0] ?? 0;
  if (d >= 9 * 5 * 5) return { result: SZ_ERROR_UNSUPPORTED, written: 0 };
  const lc = d % 9;
  d = Math.floor(d / 9);
  const pb = Math.floor(d / 5);
  const lp = d % 5;

  const p: Decoder = {
    lc,
    lp,
    pb,
    dicSize,
    probs: new Uint16Array(NUM_BASE_PROBS + (LZMA_LIT_SIZE << (lc + lp))),
    dic: output,
    dicBufSize: output.length,
    dicPos: 0,
    input: source,
    buf: 0,
    range: 0,
    code: 0,
    processedPos: 0,
    checkDicSize: 0,
    reps: [0, 0, 0, 0],
    state: 0,
    // LzmaDec_Init: a new dictionary and a new state.
    remainLen: kMatchSpecLenStart + 2,
    tempBuf: new Uint8Array(LZMA_REQUIRED_INPUT_MAX),
    tempBufSize: 0,
  };
  const step = decodeToDic(
    p,
    output.length,
    source,
    inputStart,
    source.length - inputStart,
    FINISH_END
  );
  const result =
    step.result === SZ_OK && step.status === STATUS_NEEDS_MORE_INPUT
      ? SZ_ERROR_INPUT_EOF
      : step.result;
  return { result, written: p.dicPos };
}
