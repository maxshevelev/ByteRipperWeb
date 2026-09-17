import { MatchFinder } from "@/firmware/compression/lzFind";

/**
 * The LZMA encoder — a port of the LZMA SDK's `LzmaEnc.c` (Igor Pavlov, public
 * domain), the file upstream vendors to put an edited buffer back into a
 * compressed section.
 *
 * The other direction of `lzmaDecoder.ts`, and the same standard of port: path
 * for path, with the SDK's names, so the two read side by side. The optimal
 * parser, the price tables it steers by and the range encoder are all here; what
 * is not is the multi-threaded match finder, the LZMA2 entry points and the
 * stream-driven encode, none of which this project asks for — the map records
 * each with its reason.
 *
 * The C's arrays of structures become parallel typed arrays, which is the same
 * memory with the same indices; its pointers into the source become offsets.
 * Where the C wraps silently, the wrap is written out: `>>> 0` for a 32-bit
 * unsigned, and the range coder's `low` is kept as a JavaScript number, exact to
 * 2^53 and so exact for the 33 bits it uses.
 */

// MARK: - The SDK's constants

const kNumBitModelTotalBits = 11;
const kBitModelTotal = 1 << kNumBitModelTotalBits;
const kNumMoveBits = 5;
const kProbInitValue = kBitModelTotal >>> 1;
const kNumMoveReducingBits = 4;
const kNumBitPriceShiftBits = 4;
const kTopValue = 1 << 24;

const REP_LEN_COUNT = 64;
const LZMA_NUM_REPS = 4;
const kNumOpts = 1 << 11;
const kNumLenToPosStates = 4;
const kNumPosSlotBits = 6;
const kDicLogSizeMax = 32;
const kDistTableSizeMax = kDicLogSizeMax * 2;
const kNumAlignBits = 4;
const kAlignTableSize = 1 << kNumAlignBits;
const kAlignMask = kAlignTableSize - 1;
const kStartPosModelIndex = 4;
const kEndPosModelIndex = 14;
const kNumFullDistances = 1 << (kEndPosModelIndex >> 1);
const LZMA_NUM_PB_STATES_MAX = 1 << 4;
const kLenNumLowBits = 3;
const kLenNumLowSymbols = 1 << kLenNumLowBits;
const kLenNumHighBits = 8;
const kLenNumHighSymbols = 1 << kLenNumHighBits;
const kLenNumSymbolsTotal = kLenNumLowSymbols * 2 + kLenNumHighSymbols;
const LZMA_MATCH_LEN_MIN = 2;
const LZMA_MATCH_LEN_MAX = LZMA_MATCH_LEN_MIN + kLenNumSymbolsTotal - 1;
const kNumStates = 12;
const kInfinityPrice = 1 << 30;
const MARK_LIT = 0xffffffff;
const kNumLogBits = 11 + 4 * 3; // (11 + sizeof(size_t) / 8 * 3), size_t being 8 bytes

const kState_LitAfterMatch = 4;
const kState_LitAfterRep = 5;
const kState_MatchAfterLit = 7;
const kState_RepAfterLit = 8;

// The state machine, copied from the tables of the same names in `LzmaEnc.c`:
// which of the twelve states follows each kind of packet. They carry no
// `@upstream` anchors because the anchor check reads a C file for its
// functions, and these are `static const` tables.
const kLiteralNextStates = Uint8Array.of(0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 4, 5);
const kMatchNextStates = Uint8Array.of(7, 7, 7, 7, 7, 7, 7, 10, 10, 10, 10, 10);
const kRepNextStates = Uint8Array.of(8, 8, 8, 8, 8, 8, 8, 11, 11, 11, 11, 11);
const kShortRepNextStates = Uint8Array.of(9, 9, 9, 9, 9, 9, 9, 11, 11, 11, 11, 11);

const isLitState = (state: number) => state < 7;
const getLenToPosState2 = (len: number) =>
  len < kNumLenToPosStates - 1 ? len : kNumLenToPosStates - 1;
const getLenToPosState = (len: number) =>
  len < kNumLenToPosStates + 1 ? len - 2 : kNumLenToPosStates - 1;

/**
 * How hard the encoder works at a stream: the SDK's normal level (5), quick and
 * nearly as small, or level 9 with 273 fast bytes — what the old UEFITool used,
 * the smallest stream and several times the time.
 *
 * The level a stream was made at is not written into it — its header keeps the
 * dictionary size and nothing else of the settings — so a section is compressed
 * again at the normal level, and at the maximum level only when a normal stream
 * does not fit.
 *
 * @upstream Packages/FirmwareCompression/Sources/FirmwareCompression/FirmwareCompression.swift#FirmwareCompression.Effort
 */
export type LzmaEffort = "normal" | "maximum";

/** What an encode came to. */
export type LzmaEncoded =
  | { readonly ok: true; readonly bytes: Uint8Array }
  /** The destination was too small for the stream. */
  | { readonly ok: false };

/**
 * `bytes` as the stream EDK2 writes: five property bytes, the uncompressed size
 * in eight, then the LZMA stream with no end marker.
 *
 * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/CLZMAEncoder.c#clzma_encode
 * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LzmaEncode
 */
export function lzmaCompress(
  bytes: Uint8Array,
  options: {
    readonly dictionarySize: number;
    readonly effort?: LzmaEffort;
    readonly capacity?: number;
    readonly onProgress?: (processed: number) => void;
  }
): LzmaEncoded {
  const header = 5 + 8;
  const capacity = options.capacity ?? bytes.length + Math.floor(bytes.length / 3) + 256;
  if (capacity < header) return { ok: false };

  // The SDK's normal level (5) is quick and nearly as small; level 9 with 273
  // fast bytes is what the old UEFITool compressed sections with, for when a
  // normal stream does not fit its room.
  const maximum = options.effort === "maximum";
  const encoder = new LzmaEncoder({
    dictSize: options.dictionarySize,
    numFastBytes: maximum ? 273 : 32,
    lc: 3,
    lp: 0,
    pb: 2,
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  });

  const out = new Uint8Array(capacity);
  out.set(encoder.writeProperties(), 0);
  let size = bytes.length;
  for (let index = 0; index < 8; index++) {
    out[5 + index] = size & 0xff;
    size = Math.floor(size / 0x100);
  }
  const stream = encoder.encode(bytes, capacity - header);
  if (stream === undefined) return { ok: false };
  out.set(stream, header);
  return { ok: true, bytes: out.subarray(0, header + stream.length) };
}

/**
 * The encoder's whole state, which the C keeps in a `CLzmaEnc` the caller
 * allocates — the range coder, the probability models, the price tables and the
 * parser's window over the optimal prices. It carries no `@upstream` anchor
 * because `CLzmaEnc` is a `typedef struct`, and the anchor check reads a C file
 * for its functions.
 */
class LzmaEncoder {
  private readonly lc: number;
  private readonly lp: number;
  private readonly pb: number;
  private readonly numFastBytes: number;
  private readonly dictSize: number;
  private readonly onProgress: ((processed: number) => void) | undefined;

  private lpMask = 0;
  private pbMask = 0;
  private distTableSize = 0;

  // The range encoder.
  private range = 0;
  private cache = 0;
  private low = 0;
  private cacheSize = 0;
  private out = new Uint8Array(0);
  private outAt = 0;
  private overflow = false;

  // The model.
  private state = 0;
  private readonly reps = new Uint32Array(LZMA_NUM_REPS);
  private litProbs = new Uint16Array(0);
  private readonly posAlignEncoder = new Uint16Array(1 << kNumAlignBits);
  private readonly isRep = new Uint16Array(kNumStates);
  private readonly isRepG0 = new Uint16Array(kNumStates);
  private readonly isRepG1 = new Uint16Array(kNumStates);
  private readonly isRepG2 = new Uint16Array(kNumStates);
  private readonly isMatch = new Uint16Array(kNumStates * LZMA_NUM_PB_STATES_MAX);
  private readonly isRep0Long = new Uint16Array(kNumStates * LZMA_NUM_PB_STATES_MAX);
  private readonly posSlotEncoder = new Uint16Array(kNumLenToPosStates * (1 << kNumPosSlotBits));
  private readonly posEncoders = new Uint16Array(kNumFullDistances);
  /** `CLenEnc`: the low tree per position state, then the high tree. */
  private readonly lenProbs = new Uint16Array(
    (LZMA_NUM_PB_STATES_MAX << (kLenNumLowBits + 1)) + kLenNumHighSymbols
  );
  private readonly repLenProbs = new Uint16Array(this.lenProbs.length);
  private static readonly lenHighAt = LZMA_NUM_PB_STATES_MAX << (kLenNumLowBits + 1);

  // The prices.
  private readonly probPrices = new Uint32Array(kBitModelTotal >>> kNumMoveReducingBits);
  private readonly alignPrices = new Uint32Array(kAlignTableSize);
  private readonly posSlotPrices = new Uint32Array(kNumLenToPosStates * kDistTableSizeMax);
  private readonly distancesPrices = new Uint32Array(kNumLenToPosStates * kNumFullDistances);
  private readonly lenPrices = new Uint32Array(LZMA_NUM_PB_STATES_MAX * kLenNumSymbolsTotal);
  private readonly repLenPrices = new Uint32Array(LZMA_NUM_PB_STATES_MAX * kLenNumSymbolsTotal);
  private lenTableSize = 0;
  private matchPriceCount = 0;
  private repLenEncCounter = 0;
  private readonly fastPos = new Uint8Array(1 << kNumLogBits);

  // The optimal parser's table, as parallel arrays.
  private readonly optPrice = new Uint32Array(kNumOpts);
  private readonly optState = new Uint16Array(kNumOpts);
  private readonly optExtra = new Uint16Array(kNumOpts);
  private readonly optLen = new Uint32Array(kNumOpts);
  private readonly optDist = new Uint32Array(kNumOpts);
  private readonly optReps = new Uint32Array(kNumOpts * LZMA_NUM_REPS);
  private optCur = 0;
  private optEnd = 0;

  private readonly matches = new Uint32Array(LZMA_MATCH_LEN_MAX * 2 + 2);
  private longestMatchLen = 0;
  private numPairs = 0;
  private numAvail = 0;
  private additionalOffset = 0;
  private backRes = 0;

  private mf!: MatchFinder;
  private src: Uint8Array = new Uint8Array(0);

  constructor(props: {
    dictSize: number;
    numFastBytes: number;
    lc: number;
    lp: number;
    pb: number;
    onProgress?: (processed: number) => void;
  }) {
    this.lc = props.lc;
    this.lp = props.lp;
    this.pb = props.pb;
    this.numFastBytes = props.numFastBytes;
    this.dictSize = props.dictSize;
    this.onProgress = props.onProgress;
    this.initFastPos();
    this.initPriceTables();
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LzmaEnc_FastPosInit */
  private initFastPos(): void {
    this.fastPos[0] = 0;
    this.fastPos[1] = 1;
    let at = 2;
    for (let slot = 2; slot < kNumLogBits * 2; slot++) {
      const k = 1 << ((slot >> 1) - 1);
      for (let j = 0; j < k; j++) this.fastPos[at + j] = slot;
      at += k;
    }
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LzmaEnc_InitPriceTables */
  private initPriceTables(): void {
    for (let index = 0; index < kBitModelTotal >>> kNumMoveReducingBits; index++) {
      const kCyclesBits = kNumBitPriceShiftBits;
      let w = (index << kNumMoveReducingBits) + (1 << (kNumMoveReducingBits - 1));
      let bitCount = 0;
      for (let cycle = 0; cycle < kCyclesBits; cycle++) {
        w = (w * w) % 0x1_0000_0000;
        bitCount <<= 1;
        while (w >= 1 << 16) {
          w = Math.floor(w / 2);
          bitCount++;
        }
      }
      this.probPrices[index] = (kNumBitModelTotalBits << kCyclesBits) - 15 - bitCount;
    }
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LzmaEnc_WriteProperties */
  writeProperties(): Uint8Array {
    const props = new Uint8Array(5);
    props[0] = (this.pb * 5 + this.lp) * 9 + this.lc;
    let v: number;
    if (this.dictSize >= 1 << 21) {
      const kDictMask = (1 << 20) - 1;
      v = (this.dictSize + kDictMask) & ~kDictMask;
      if (v < this.dictSize) v = this.dictSize;
    } else {
      let i = 11 * 2;
      do {
        v = (2 + (i & 1)) * 2 ** (i >> 1);
        i++;
      } while (v < this.dictSize);
    }
    props[1] = v & 0xff;
    props[2] = (v >>> 8) & 0xff;
    props[3] = (v >>> 16) & 0xff;
    props[4] = (v >>> 24) & 0xff;
    return props;
  }

  /**
   * The stream for `source`, or nothing when it does not fit `capacity`.
   *
   * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LzmaEnc_MemEncode
   * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LzmaEnc_MemPrepare
   * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LzmaEnc_AllocAndInit
   */
  encode(source: Uint8Array, capacity: number): Uint8Array | undefined {
    this.src = source as Uint8Array<ArrayBuffer>;
    this.out = new Uint8Array(capacity);
    this.outAt = 0;
    this.overflow = false;

    // LzmaEnc_AllocAndInit: the distance table follows the dictionary.
    let i = kEndPosModelIndex / 2;
    for (; i < kDicLogSizeMax; i++) if (this.dictSize <= 2 ** i) break;
    this.distTableSize = i * 2;

    this.mf = new MatchFinder(source);
    // The C asks for (numFastBytes + LZMA_MATCH_LEN_MAX + 1) after the cursor,
    // and kNumOpts before it.
    // `mc`, the search depth, is what LzmaEncProps_Normalize works out from the
    // fast-byte count: 32 at the normal level, 152 at the maximum.
    const cutValue = 16 + (this.numFastBytes >> 1);
    this.mf.create(this.dictSize, kNumOpts, this.numFastBytes, LZMA_MATCH_LEN_MAX + 1, cutValue);

    this.init();
    this.initPrices();
    this.mf.init();

    this.codeOneBlock();
    if (this.overflow) return undefined;
    return this.out.subarray(0, this.outAt);
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LzmaEnc_Init */
  private init(): void {
    this.state = 0;
    this.reps.fill(1);

    // RangeEnc_Init
    this.range = 0xffffffff;
    this.cache = 0;
    this.low = 0;
    this.cacheSize = 0;

    this.posAlignEncoder.fill(kProbInitValue);
    this.isMatch.fill(kProbInitValue);
    this.isRep0Long.fill(kProbInitValue);
    this.isRep.fill(kProbInitValue);
    this.isRepG0.fill(kProbInitValue);
    this.isRepG1.fill(kProbInitValue);
    this.isRepG2.fill(kProbInitValue);
    this.posSlotEncoder.fill(kProbInitValue);
    this.posEncoders.fill(kProbInitValue);

    this.litProbs = new Uint16Array(0x300 << (this.lp + this.lc));
    this.litProbs.fill(kProbInitValue);
    this.lenProbs.fill(kProbInitValue);
    this.repLenProbs.fill(kProbInitValue);

    this.optEnd = 0;
    this.optCur = 0;
    this.optPrice.fill(kInfinityPrice);
    this.additionalOffset = 0;

    this.pbMask = (1 << this.pb) - 1;
    this.lpMask = ((0x100 << this.lp) - (0x100 >>> this.lc)) >>> 0;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LzmaEnc_InitPrices */
  private initPrices(): void {
    this.fillDistancesPrices();
    this.fillAlignPrices();
    this.lenTableSize = this.numFastBytes + 1 - LZMA_MATCH_LEN_MIN;
    this.repLenEncCounter = REP_LEN_COUNT;
    this.updateLenTables(this.lenPrices, this.lenProbs);
    this.updateLenTables(this.repLenPrices, this.repLenProbs);
  }

  // MARK: - The range encoder

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#RangeEnc_ShiftLow */
  private shiftLow(): void {
    const low = this.low % 0x1_0000_0000;
    const high = Math.floor(this.low / 0x1_0000_0000);
    this.low = (low * 256) % 0x1_0000_0000;
    if (low < 0xff000000 || high !== 0) {
      this.writeByte((this.cache + high) & 0xff);
      this.cache = (low >>> 24) & 0xff;
      if (this.cacheSize === 0) return;
      const byte = (high + 0xff) & 0xff;
      for (;;) {
        this.writeByte(byte);
        if (--this.cacheSize === 0) return;
      }
    }
    this.cacheSize++;
  }

  private writeByte(byte: number): void {
    if (this.outAt >= this.out.length) {
      this.overflow = true;
      return;
    }
    this.out[this.outAt++] = byte;
  }

  /** The C's `RC_NORM` macro; a macro is not a declaration the check reads. */
  private norm(): void {
    if (this.range < kTopValue) {
      this.range = (this.range * 256) % 0x1_0000_0000;
      this.shiftLow();
    }
  }

  /**
   * One bit through its probability model — the C's `RC_BIT` macro, which is
   * why there is no anchor to it.
   */
  private encodeBit(probs: Uint16Array, at: number, bit: number): void {
    const ttt = probs[at] ?? 0;
    const newBound = Math.floor(this.range / kBitModelTotal) * ttt;
    if (bit === 0) {
      this.range = newBound;
      probs[at] = ttt + ((kBitModelTotal - ttt) >>> kNumMoveBits);
    } else {
      this.low += newBound;
      this.range -= newBound;
      probs[at] = ttt - (ttt >>> kNumMoveBits);
    }
    this.norm();
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#RangeEnc_FlushData */
  private flushData(): void {
    for (let index = 0; index < 5; index++) this.shiftLow();
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LitEnc_Encode */
  private litEncode(probs: Uint16Array, at: number, symbol: number): void {
    let sym = symbol | 0x100;
    do {
      const index = at + (sym >>> 8);
      const bit = (sym >>> 7) & 1;
      sym <<= 1;
      this.encodeBit(probs, index, bit);
    } while (sym < 0x10000);
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LitEnc_EncodeMatched */
  private litEncodeMatched(
    probs: Uint16Array,
    at: number,
    symbol: number,
    matchByteIn: number
  ): void {
    let offs = 0x100;
    let sym = symbol | 0x100;
    let matchByte = matchByteIn;
    do {
      matchByte <<= 1;
      const index = offs + (matchByte & offs) + (sym >>> 8);
      const bit = (sym >>> 7) & 1;
      sym <<= 1;
      offs &= ~(matchByte ^ sym);
      this.encodeBit(probs, at + index, bit);
    } while (sym < 0x10000);
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#RcTree_ReverseEncode */
  private reverseEncode(probs: Uint16Array, at: number, numBits: number, symbol: number): void {
    let m = 1;
    let sym = symbol;
    let bits = numBits;
    do {
      const bit = sym & 1;
      sym >>>= 1;
      this.encodeBit(probs, at + m, bit);
      m = (m << 1) | bit;
    } while (--bits !== 0);
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LenEnc_Encode */
  private lenEncode(probs: Uint16Array, symbol: number, posState: number): void {
    let sym = symbol;
    // The C walks a pointer: `probs` is the low tree, and the middle case moves
    // it on by one symbol before the final zero bit and the three-bit tree.
    let base = 0;
    if (sym >= kLenNumLowSymbols) {
      this.encodeBit(probs, base, 1);
      base += kLenNumLowSymbols;
      if (sym >= kLenNumLowSymbols * 2) {
        this.encodeBit(probs, base, 1);
        this.litEncode(probs, LzmaEncoder.lenHighAt, sym - kLenNumLowSymbols * 2);
        return;
      }
      sym -= kLenNumLowSymbols;
    }
    this.encodeBit(probs, base, 0);
    const at = base + (posState << (1 + kLenNumLowBits));
    let bit = (sym >>> 2) & 1;
    this.encodeBit(probs, at + 1, bit);
    let m = 2 + bit;
    bit = (sym >>> 1) & 1;
    this.encodeBit(probs, at + m, bit);
    m = (m << 1) + bit;
    bit = sym & 1;
    this.encodeBit(probs, at + m, bit);
  }

  // MARK: - The prices

  private price(prob: number, bit: number): number {
    return this.probPrices[(prob ^ (-bit & (kBitModelTotal - 1))) >>> kNumMoveReducingBits] ?? 0;
  }

  private price0(prob: number): number {
    return this.probPrices[prob >>> kNumMoveReducingBits] ?? 0;
  }

  private price1(prob: number): number {
    return this.probPrices[(prob ^ (kBitModelTotal - 1)) >>> kNumMoveReducingBits] ?? 0;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LitEnc_GetPrice */
  private litPrice(probs: Uint16Array, at: number, symbol: number): number {
    let price = 0;
    let sym = symbol | 0x100;
    do {
      const bit = sym & 1;
      sym >>>= 1;
      price += this.price(probs[at + sym] ?? 0, bit);
    } while (sym >= 2);
    return price;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LitEnc_Matched_GetPrice */
  private litMatchedPrice(
    probs: Uint16Array,
    at: number,
    symbol: number,
    matchByteIn: number
  ): number {
    let price = 0;
    let offs = 0x100;
    let sym = symbol | 0x100;
    let matchByte = matchByteIn;
    do {
      matchByte <<= 1;
      price += this.price(
        probs[at + offs + (matchByte & offs) + (sym >>> 8)] ?? 0,
        (sym >>> 7) & 1
      );
      sym <<= 1;
      offs &= ~(matchByte ^ sym);
    } while (sym < 0x10000);
    return price;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#SetPrices_3 */
  private setPrices3(
    probs: Uint16Array,
    at: number,
    startPrice: number,
    prices: Uint32Array,
    pricesAt: number
  ): void {
    for (let i = 0; i < 8; i += 2) {
      let price = startPrice;
      price += this.price(probs[at + 1] ?? 0, i >> 2);
      price += this.price(probs[at + 2 + (i >> 2)] ?? 0, (i >> 1) & 1);
      const prob = probs[at + 4 + (i >> 1)] ?? 0;
      prices[pricesAt + i] = price + this.price0(prob);
      prices[pricesAt + i + 1] = price + this.price1(prob);
    }
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LenPriceEnc_UpdateTables */
  private updateLenTables(prices: Uint32Array, enc: Uint16Array): void {
    const numPosStates = 1 << this.pb;
    let b: number;
    {
      const prob = enc[0] ?? 0;
      b = this.price1(prob);
      const a = this.price0(prob);
      const c = b + this.price0(enc[kLenNumLowSymbols] ?? 0);
      for (let posState = 0; posState < numPosStates; posState++) {
        const at = posState * kLenNumSymbolsTotal;
        const probsAt = posState << (1 + kLenNumLowBits);
        this.setPrices3(enc, probsAt, a, prices, at);
        this.setPrices3(enc, probsAt + kLenNumLowSymbols, c, prices, at + kLenNumLowSymbols);
      }
    }
    let i = this.lenTableSize;
    if (i > kLenNumLowSymbols * 2) {
      const pricesAt = kLenNumLowSymbols * 2;
      i -= kLenNumLowSymbols * 2 - 1;
      i >>= 1;
      b += this.price1(enc[kLenNumLowSymbols] ?? 0);
      do {
        let sym = --i + (1 << (kLenNumHighBits - 1));
        let price = b;
        do {
          const bit = sym & 1;
          sym >>= 1;
          price += this.price(enc[LzmaEncoder.lenHighAt + sym] ?? 0, bit);
        } while (sym >= 2);
        const prob = enc[LzmaEncoder.lenHighAt + i + (1 << (kLenNumHighBits - 1))] ?? 0;
        prices[pricesAt + i * 2] = price + this.price0(prob);
        prices[pricesAt + i * 2 + 1] = price + this.price1(prob);
      } while (i !== 0);

      const num = this.lenTableSize - kLenNumLowSymbols * 2;
      for (let posState = 1; posState < numPosStates; posState++) {
        prices.copyWithin(
          posState * kLenNumSymbolsTotal + kLenNumLowSymbols * 2,
          kLenNumLowSymbols * 2,
          kLenNumLowSymbols * 2 + num
        );
      }
    }
  }

  private lenPrice(prices: Uint32Array, posState: number, len: number): number {
    return prices[posState * kLenNumSymbolsTotal + len - LZMA_MATCH_LEN_MIN] ?? 0;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#FillAlignPrices */
  private fillAlignPrices(): void {
    for (let i = 0; i < kAlignTableSize / 2; i++) {
      let price = 0;
      let sym = i;
      let m = 1;
      for (let step = 0; step < 3; step++) {
        const bit = sym & 1;
        sym >>= 1;
        price += this.price(this.posAlignEncoder[m] ?? 0, bit);
        m = (m << 1) + bit;
      }
      const prob = this.posAlignEncoder[m] ?? 0;
      this.alignPrices[i] = price + this.price0(prob);
      this.alignPrices[i + 8] = price + this.price1(prob);
    }
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#GetPosSlot1 */
  private posSlot1(pos: number): number {
    return this.fastPos[pos] ?? 0;
  }

  /** The C's `GetPosSlot2` macro, which the anchor check does not read. */
  private posSlot2(pos: number): number {
    const zz = pos < 1 << (kNumLogBits + 6) ? 6 : 6 + kNumLogBits - 1;
    return (this.fastPos[pos >>> zz] ?? 0) + zz * 2;
  }

  /** The C's `GetPosSlot` macro, which the anchor check does not read. */
  private posSlot(pos: number): number {
    if (pos < kNumFullDistances) return this.fastPos[pos & (kNumFullDistances - 1)] ?? 0;
    return this.posSlot2(pos);
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#FillDistancesPrices */
  private fillDistancesPrices(): void {
    const tempPrices = new Uint32Array(kNumFullDistances);
    this.matchPriceCount = 0;

    for (let i = kStartPosModelIndex / 2; i < kNumFullDistances / 2; i++) {
      const posSlot = this.posSlot1(i);
      let footerBits = (posSlot >> 1) - 1;
      let base = (2 | (posSlot & 1)) << footerBits;
      const probsAt = base * 2;
      let price = 0;
      let m = 1;
      let sym = i;
      const offset = 1 << footerBits;
      base += i;
      if (footerBits !== 0) {
        do {
          const bit = sym & 1;
          sym >>= 1;
          price += this.price(this.posEncoders[probsAt + m] ?? 0, bit);
          m = (m << 1) + bit;
        } while (--footerBits !== 0);
      }
      const prob = this.posEncoders[probsAt + m] ?? 0;
      tempPrices[base] = price + this.price0(prob);
      tempPrices[base + offset] = price + this.price1(prob);
    }

    for (let lps = 0; lps < kNumLenToPosStates; lps++) {
      const distTableSize2 = (this.distTableSize + 1) >> 1;
      const slotAt = lps * kDistTableSizeMax;
      const probsAt = lps * (1 << kNumPosSlotBits);

      for (let slot = 0; slot < distTableSize2; slot++) {
        let sym = slot + (1 << (kNumPosSlotBits - 1));
        let price = 0;
        for (let step = 0; step < 5; step++) {
          const bit = sym & 1;
          sym >>= 1;
          price += this.price(this.posSlotEncoder[probsAt + sym] ?? 0, bit);
        }
        const prob = this.posSlotEncoder[probsAt + slot + (1 << (kNumPosSlotBits - 1))] ?? 0;
        this.posSlotPrices[slotAt + slot * 2] = price + this.price0(prob);
        this.posSlotPrices[slotAt + slot * 2 + 1] = price + this.price1(prob);
      }
      {
        let delta = (kEndPosModelIndex / 2 - 1 - kNumAlignBits) << kNumBitPriceShiftBits;
        for (let slot = kEndPosModelIndex / 2; slot < distTableSize2; slot++) {
          this.posSlotPrices[slotAt + slot * 2] =
            (this.posSlotPrices[slotAt + slot * 2] ?? 0) + delta;
          this.posSlotPrices[slotAt + slot * 2 + 1] =
            (this.posSlotPrices[slotAt + slot * 2 + 1] ?? 0) + delta;
          delta += 1 << kNumBitPriceShiftBits;
        }
      }
      {
        const dpAt = lps * kNumFullDistances;
        for (let index = 0; index < 4; index++) {
          this.distancesPrices[dpAt + index] = this.posSlotPrices[slotAt + index] ?? 0;
        }
        for (let i = 4; i < kNumFullDistances; i += 2) {
          const slotPrice = this.posSlotPrices[slotAt + this.posSlot1(i)] ?? 0;
          this.distancesPrices[dpAt + i] = slotPrice + (tempPrices[i] ?? 0);
          this.distancesPrices[dpAt + i + 1] = slotPrice + (tempPrices[i + 1] ?? 0);
        }
      }
    }
  }

  // MARK: - Reading matches

  /** The C's `MOVE_POS` macro, which the anchor check does not read. */
  private movePos(num: number): void {
    if (num === 0) return;
    this.additionalOffset += num;
    this.mf.skip(num);
  }

  /**
   * The matches at the cursor, and the longest of them. The count of numbers
   * written is the C's out-parameter, which is `numPairs` here: the C's callers
   * keep it in a local and copy it into `p->numPairs` where the parse breaks
   * out with a match to carry over, and that is the only place they read it
   * back, so a field written every time says the same thing.
   *
   * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#ReadMatchDistances
   */
  private readMatchDistances(): number {
    this.additionalOffset++;
    this.numAvail = this.mf.numAvailableBytes;
    const numPairs = this.mf.getMatches(this.matches);
    this.numPairs = numPairs;
    if (numPairs === 0) return 0;
    const len = this.matches[numPairs - 2] ?? 0;
    if (len !== this.numFastBytes) return len;
    let numAvail = this.numAvail;
    if (numAvail > LZMA_MATCH_LEN_MAX) numAvail = LZMA_MATCH_LEN_MAX;
    const p1 = this.mf.cursor - 1;
    let p2 = p1 + len;
    const dif = -1 - (this.matches[numPairs - 1] ?? 0);
    const lim = p1 + numAvail;
    for (; p2 !== lim && this.src[p2] === this.src[p2 + dif]; p2++) {}
    return p2 - p1;
  }

  private litProbsAt(pos: number, prevByte: number): number {
    return 3 * ((((pos << 8) + prevByte) & this.lpMask) << this.lc);
  }

  private getPriceShortRep(state: number, posState: number): number {
    return (
      this.price0(this.isRepG0[state] ?? 0) +
      this.price0(this.isRep0Long[state * LZMA_NUM_PB_STATES_MAX + posState] ?? 0)
    );
  }

  private getPriceRep0(state: number, posState: number): number {
    return (
      this.price1(this.isMatch[state * LZMA_NUM_PB_STATES_MAX + posState] ?? 0) +
      this.price1(this.isRep0Long[state * LZMA_NUM_PB_STATES_MAX + posState] ?? 0) +
      this.price1(this.isRep[state] ?? 0) +
      this.price0(this.isRepG0[state] ?? 0)
    );
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#GetPrice_PureRep */
  private getPricePureRep(repIndex: number, state: number, posState: number): number {
    let price: number;
    let prob = this.isRepG0[state] ?? 0;
    if (repIndex === 0) {
      price = this.price0(prob);
      price += this.price1(this.isRep0Long[state * LZMA_NUM_PB_STATES_MAX + posState] ?? 0);
    } else {
      price = this.price1(prob);
      prob = this.isRepG1[state] ?? 0;
      if (repIndex === 1) {
        price += this.price0(prob);
      } else {
        price += this.price1(prob);
        price += this.price(this.isRepG2[state] ?? 0, repIndex - 2);
      }
    }
    return price;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#Backward */
  private backward(curIn: number): number {
    let cur = curIn;
    let wr = cur + 1;
    this.optEnd = wr;
    for (;;) {
      let dist = this.optDist[cur] ?? 0;
      let len = this.optLen[cur] ?? 0;
      const extra = this.optExtra[cur] ?? 0;
      cur -= len;

      if (extra !== 0) {
        wr--;
        this.optLen[wr] = len;
        cur -= extra;
        len = extra;
        if (extra === 1) {
          this.optDist[wr] = dist;
          dist = MARK_LIT;
        } else {
          this.optDist[wr] = 0;
          len--;
          wr--;
          this.optDist[wr] = MARK_LIT;
          this.optLen[wr] = 1;
        }
      }

      if (cur === 0) {
        this.backRes = dist;
        this.optCur = wr;
        return len;
      }

      wr--;
      this.optDist[wr] = dist;
      this.optLen[wr] = len;
    }
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#GetOptimum */
  private getOptimum(positionIn: number): number {
    let position = positionIn;
    const src = this.src;
    const reps = new Uint32Array(LZMA_NUM_REPS);
    const repLens = new Uint32Array(LZMA_NUM_REPS);
    let last = 0;
    let cur = 0;

    {
      this.optCur = 0;
      this.optEnd = 0;

      let mainLen: number;
      let numPairs: number;
      if (this.additionalOffset === 0) {
        mainLen = this.readMatchDistances();
        numPairs = this.numPairs;
      } else {
        mainLen = this.longestMatchLen;
        numPairs = this.numPairs;
      }

      let numAvail = this.numAvail;
      if (numAvail < 2) {
        this.backRes = MARK_LIT;
        return 1;
      }
      if (numAvail > LZMA_MATCH_LEN_MAX) numAvail = LZMA_MATCH_LEN_MAX;

      const data = this.mf.cursor - 1;
      let repMaxIndex = 0;

      for (let i = 0; i < LZMA_NUM_REPS; i++) {
        reps[i] = this.reps[i] ?? 0;
        const data2 = data - (reps[i] ?? 0);
        if (src[data] !== src[data2] || src[data + 1] !== src[data2 + 1]) {
          repLens[i] = 0;
          continue;
        }
        let len = 2;
        for (; len < numAvail && src[data + len] === src[data2 + len]; len++) {}
        repLens[i] = len;
        if (len > (repLens[repMaxIndex] ?? 0)) repMaxIndex = i;
        if (len === LZMA_MATCH_LEN_MAX) break;
      }

      if ((repLens[repMaxIndex] ?? 0) >= this.numFastBytes) {
        this.backRes = repMaxIndex;
        const len = repLens[repMaxIndex] ?? 0;
        this.movePos(len - 1);
        return len;
      }

      const matches = this.matches;
      if (mainLen >= this.numFastBytes) {
        this.backRes = (matches[numPairs - 1] ?? 0) + LZMA_NUM_REPS;
        this.movePos(mainLen - 1);
        return mainLen;
      }

      const curByte = src[data] ?? 0;
      const matchByte = src[data - (reps[0] ?? 0)] ?? 0;

      last = repLens[repMaxIndex] ?? 0;
      if (last <= mainLen) last = mainLen;

      if (last < 2 && curByte !== matchByte) {
        this.backRes = MARK_LIT;
        return 1;
      }

      this.optState[0] = this.state;
      const posState = position & this.pbMask;

      {
        const probsAt = this.litProbsAt(position, src[data - 1] ?? 0);
        this.optPrice[1] =
          this.price0(this.isMatch[this.state * LZMA_NUM_PB_STATES_MAX + posState] ?? 0) +
          (!isLitState(this.state)
            ? this.litMatchedPrice(this.litProbs, probsAt, curByte, matchByte)
            : this.litPrice(this.litProbs, probsAt, curByte));
      }
      this.optDist[1] = MARK_LIT;
      this.optExtra[1] = 0;

      const matchPrice = this.price1(
        this.isMatch[this.state * LZMA_NUM_PB_STATES_MAX + posState] ?? 0
      );
      const repMatchPrice = matchPrice + this.price1(this.isRep[this.state] ?? 0);

      if (matchByte === curByte && repLens[0] === 0) {
        const shortRepPrice = repMatchPrice + this.getPriceShortRep(this.state, posState);
        if (shortRepPrice < (this.optPrice[1] ?? 0)) {
          this.optPrice[1] = shortRepPrice;
          this.optDist[1] = 0;
          this.optExtra[1] = 0;
        }
        if (last < 2) {
          this.backRes = this.optDist[1] ?? 0;
          return 1;
        }
      }

      this.optLen[1] = 1;
      for (let i = 0; i < LZMA_NUM_REPS; i++) this.optReps[i] = reps[i] ?? 0;

      // ---------- REP ----------
      for (let i = 0; i < LZMA_NUM_REPS; i++) {
        let repLen = repLens[i] ?? 0;
        if (repLen < 2) continue;
        const price = repMatchPrice + this.getPricePureRep(i, this.state, posState);
        do {
          const price2 = price + this.lenPrice(this.repLenPrices, posState, repLen);
          if (price2 < (this.optPrice[repLen] ?? 0)) {
            this.optPrice[repLen] = price2;
            this.optLen[repLen] = repLen;
            this.optDist[repLen] = i;
            this.optExtra[repLen] = 0;
          }
        } while (--repLen >= 2);
      }

      // ---------- MATCH ----------
      {
        let len = (repLens[0] ?? 0) + 1;
        if (len <= mainLen) {
          let offs = 0;
          const normalMatchPrice = matchPrice + this.price0(this.isRep[this.state] ?? 0);
          if (len < 2) len = 2;
          else while (len > (matches[offs] ?? 0)) offs += 2;

          for (; ; len++) {
            const dist = matches[offs + 1] ?? 0;
            let price = normalMatchPrice + this.lenPrice(this.lenPrices, posState, len);
            const lenToPosState = getLenToPosState(len);
            if (dist < kNumFullDistances) {
              price +=
                this.distancesPrices[
                  lenToPosState * kNumFullDistances + (dist & (kNumFullDistances - 1))
                ] ?? 0;
            } else {
              const slot = this.posSlot2(dist);
              price += this.alignPrices[dist & kAlignMask] ?? 0;
              price += this.posSlotPrices[lenToPosState * kDistTableSizeMax + slot] ?? 0;
            }
            if (price < (this.optPrice[len] ?? 0)) {
              this.optPrice[len] = price;
              this.optLen[len] = len;
              this.optDist[len] = dist + LZMA_NUM_REPS;
              this.optExtra[len] = 0;
            }
            if (len === (matches[offs] ?? 0)) {
              offs += 2;
              if (offs === numPairs) break;
            }
          }
        }
      }
      cur = 0;
    }

    // ---------- Optimal Parsing ----------
    for (;;) {
      if (++cur === last) break;

      if (cur >= kNumOpts - 64) {
        let best = cur;
        let price = this.optPrice[cur] ?? 0;
        for (let j = cur + 1; j <= last; j++) {
          const price2 = this.optPrice[j] ?? 0;
          if (price >= price2) {
            price = price2;
            best = j;
          }
        }
        const delta = best - cur;
        if (delta !== 0) this.movePos(delta);
        cur = best;
        break;
      }

      let newLen = this.readMatchDistances();
      let numPairs = this.numPairs;
      if (newLen >= this.numFastBytes) {
        this.longestMatchLen = newLen;
        break;
      }

      position++;
      let prev = cur - (this.optLen[cur] ?? 0);
      let state: number;

      if ((this.optLen[cur] ?? 0) === 1) {
        state = this.optState[prev] ?? 0;
        state =
          (this.optDist[cur] ?? 0) === 0
            ? (kShortRepNextStates[state] ?? 0)
            : (kLiteralNextStates[state] ?? 0);
      } else {
        const dist = this.optDist[cur] ?? 0;
        const extra = this.optExtra[cur] ?? 0;
        if (extra !== 0) {
          prev -= extra;
          state = kState_RepAfterLit;
          if (extra === 1) state = dist < LZMA_NUM_REPS ? kState_RepAfterLit : kState_MatchAfterLit;
        } else {
          state = this.optState[prev] ?? 0;
          state =
            dist < LZMA_NUM_REPS ? (kRepNextStates[state] ?? 0) : (kMatchNextStates[state] ?? 0);
        }
        const prevAt = prev * LZMA_NUM_REPS;
        let b0 = this.optReps[prevAt] ?? 0;
        if (dist < LZMA_NUM_REPS) {
          if (dist === 0) {
            reps[0] = b0;
            reps[1] = this.optReps[prevAt + 1] ?? 0;
            reps[2] = this.optReps[prevAt + 2] ?? 0;
            reps[3] = this.optReps[prevAt + 3] ?? 0;
          } else {
            reps[1] = b0;
            b0 = this.optReps[prevAt + 1] ?? 0;
            if (dist === 1) {
              reps[0] = b0;
              reps[2] = this.optReps[prevAt + 2] ?? 0;
              reps[3] = this.optReps[prevAt + 3] ?? 0;
            } else {
              reps[2] = b0;
              reps[0] = this.optReps[prevAt + dist] ?? 0;
              reps[3] = this.optReps[prevAt + (dist ^ 1)] ?? 0;
            }
          }
        } else {
          reps[0] = dist - LZMA_NUM_REPS + 1;
          reps[1] = b0;
          reps[2] = this.optReps[prevAt + 1] ?? 0;
          reps[3] = this.optReps[prevAt + 2] ?? 0;
        }
      }

      this.optState[cur] = state;
      const curAt = cur * LZMA_NUM_REPS;
      for (let i = 0; i < LZMA_NUM_REPS; i++) this.optReps[curAt + i] = reps[i] ?? 0;

      const data = this.mf.cursor - 1;
      const curByte = src[data] ?? 0;
      const matchByte = src[data - (reps[0] ?? 0)] ?? 0;
      const posState = position & this.pbMask;

      let litPrice: number;
      let matchPrice: number;
      {
        const curPrice = this.optPrice[cur] ?? 0;
        const prob = this.isMatch[state * LZMA_NUM_PB_STATES_MAX + posState] ?? 0;
        matchPrice = curPrice + this.price1(prob);
        litPrice = curPrice + this.price0(prob);
      }

      const next = cur + 1;
      let nextIsLit = false;

      if (
        ((this.optPrice[next] ?? 0) < kInfinityPrice && matchByte === curByte) ||
        litPrice > (this.optPrice[next] ?? 0)
      ) {
        litPrice = 0;
      } else {
        const probsAt = this.litProbsAt(position, src[data - 1] ?? 0);
        litPrice += !isLitState(state)
          ? this.litMatchedPrice(this.litProbs, probsAt, curByte, matchByte)
          : this.litPrice(this.litProbs, probsAt, curByte);
        if (litPrice < (this.optPrice[next] ?? 0)) {
          this.optPrice[next] = litPrice;
          this.optLen[next] = 1;
          this.optDist[next] = MARK_LIT;
          this.optExtra[next] = 0;
          nextIsLit = true;
        }
      }

      const repMatchPrice = matchPrice + this.price1(this.isRep[state] ?? 0);

      let numAvailFull = this.numAvail;
      {
        const temp = kNumOpts - 1 - cur;
        if (numAvailFull > temp) numAvailFull = temp;
      }

      // ---------- SHORT_REP ----------
      if (
        isLitState(state) &&
        matchByte === curByte &&
        repMatchPrice < (this.optPrice[next] ?? 0) &&
        ((this.optLen[next] ?? 0) < 2 || (this.optDist[next] ?? 0) !== 0)
      ) {
        const shortRepPrice = repMatchPrice + this.getPriceShortRep(state, posState);
        if (shortRepPrice < (this.optPrice[next] ?? 0)) {
          this.optPrice[next] = shortRepPrice;
          this.optLen[next] = 1;
          this.optDist[next] = 0;
          this.optExtra[next] = 0;
          nextIsLit = false;
        }
      }

      if (numAvailFull < 2) continue;
      const numAvail = numAvailFull <= this.numFastBytes ? numAvailFull : this.numFastBytes;

      // ---------- LIT : REP_0 ----------
      if (!nextIsLit && litPrice !== 0 && matchByte !== curByte && numAvailFull > 2) {
        const data2 = data - (reps[0] ?? 0);
        if (src[data + 1] === src[data2 + 1] && src[data + 2] === src[data2 + 2]) {
          let limit = this.numFastBytes + 1;
          if (limit > numAvailFull) limit = numAvailFull;
          let len = 3;
          for (; len < limit && src[data + len] === src[data2 + len]; len++) {}

          const state2 = kLiteralNextStates[state] ?? 0;
          const posState2 = (position + 1) & this.pbMask;
          const price = litPrice + this.getPriceRep0(state2, posState2);
          const offset = cur + len;
          if (last < offset) last = offset;
          const len2 = len - 1;
          const price2 = price + this.lenPrice(this.repLenPrices, posState2, len2);
          if (price2 < (this.optPrice[offset] ?? 0)) {
            this.optPrice[offset] = price2;
            this.optLen[offset] = len2;
            this.optDist[offset] = 0;
            this.optExtra[offset] = 1;
          }
        }
      }

      let startLen = 2;

      // ---------- REP ----------
      for (let repIndex = 0; repIndex < LZMA_NUM_REPS; repIndex++) {
        const data2 = data - (reps[repIndex] ?? 0);
        if (src[data] !== src[data2] || src[data + 1] !== src[data2 + 1]) continue;
        let len = 2;
        for (; len < numAvail && src[data + len] === src[data2 + len]; len++) {}
        {
          const offset = cur + len;
          if (last < offset) last = offset;
        }
        let price = repMatchPrice + this.getPricePureRep(repIndex, state, posState);
        {
          let len2 = len;
          do {
            const price2 = price + this.lenPrice(this.repLenPrices, posState, len2);
            const at = cur + len2;
            if (price2 < (this.optPrice[at] ?? 0)) {
              this.optPrice[at] = price2;
              this.optLen[at] = len2;
              this.optDist[at] = repIndex;
              this.optExtra[at] = 0;
            }
          } while (--len2 >= 2);
        }
        if (repIndex === 0) startLen = len + 1;

        // ---------- REP : LIT : REP_0 ----------
        {
          let len2 = len + 1;
          let limit = len2 + this.numFastBytes;
          if (limit > numAvailFull) limit = numAvailFull;
          len2 += 2;
          if (
            len2 <= limit &&
            src[data + len2 - 2] === src[data2 + len2 - 2] &&
            src[data + len2 - 1] === src[data2 + len2 - 1]
          ) {
            let state2 = kRepNextStates[state] ?? 0;
            let posState2 = (position + len) & this.pbMask;
            price +=
              this.lenPrice(this.repLenPrices, posState, len) +
              this.price0(this.isMatch[state2 * LZMA_NUM_PB_STATES_MAX + posState2] ?? 0) +
              this.litMatchedPrice(
                this.litProbs,
                this.litProbsAt(position + len, src[data + len - 1] ?? 0),
                src[data + len] ?? 0,
                src[data2 + len] ?? 0
              );
            state2 = kState_LitAfterRep;
            posState2 = (posState2 + 1) & this.pbMask;
            price += this.getPriceRep0(state2, posState2);

            for (; len2 < limit && src[data + len2] === src[data2 + len2]; len2++) {}
            len2 -= len;
            const offset = cur + len + len2;
            if (last < offset) last = offset;
            const len3 = len2 - 1;
            const price2 = price + this.lenPrice(this.repLenPrices, posState2, len3);
            if (price2 < (this.optPrice[offset] ?? 0)) {
              this.optPrice[offset] = price2;
              this.optLen[offset] = len3;
              this.optExtra[offset] = len + 1;
              this.optDist[offset] = repIndex;
            }
          }
        }
      }

      // ---------- MATCH ----------
      const matches = this.matches;
      if (newLen > numAvail) {
        newLen = numAvail;
        for (numPairs = 0; newLen > (matches[numPairs] ?? 0); numPairs += 2) {}
        matches[numPairs] = newLen;
        numPairs += 2;
        // The C keeps this count to itself: `p->numPairs` is written only where
        // the parse breaks out with a match to carry over.
      }

      if (newLen >= startLen) {
        const normalMatchPrice = matchPrice + this.price0(this.isRep[state] ?? 0);
        {
          const offset = cur + newLen;
          if (last < offset) last = offset;
        }
        let offs = 0;
        while (startLen > (matches[offs] ?? 0)) offs += 2;
        let dist = matches[offs + 1] ?? 0;
        let posSlot = this.posSlot2(dist);

        for (let len = startLen; ; len++) {
          let price = normalMatchPrice + this.lenPrice(this.lenPrices, posState, len);
          {
            const lenNorm = getLenToPosState2(len - 2);
            if (dist < kNumFullDistances) {
              price +=
                this.distancesPrices[
                  lenNorm * kNumFullDistances + (dist & (kNumFullDistances - 1))
                ] ?? 0;
            } else {
              price +=
                (this.posSlotPrices[lenNorm * kDistTableSizeMax + posSlot] ?? 0) +
                (this.alignPrices[dist & kAlignMask] ?? 0);
            }
            const at = cur + len;
            if (price < (this.optPrice[at] ?? 0)) {
              this.optPrice[at] = price;
              this.optLen[at] = len;
              this.optDist[at] = dist + LZMA_NUM_REPS;
              this.optExtra[at] = 0;
            }
          }

          if (len === (matches[offs] ?? 0)) {
            // ---------- MATCH : LIT : REP_0 ----------
            const data2 = data - dist - 1;
            let len2 = len + 1;
            let limit = len2 + this.numFastBytes;
            if (limit > numAvailFull) limit = numAvailFull;
            len2 += 2;
            if (
              len2 <= limit &&
              src[data + len2 - 2] === src[data2 + len2 - 2] &&
              src[data + len2 - 1] === src[data2 + len2 - 1]
            ) {
              for (; len2 < limit && src[data + len2] === src[data2 + len2]; len2++) {}
              len2 -= len;
              let state2 = kMatchNextStates[state] ?? 0;
              let posState2 = (position + len) & this.pbMask;
              price += this.price0(this.isMatch[state2 * LZMA_NUM_PB_STATES_MAX + posState2] ?? 0);
              price += this.litMatchedPrice(
                this.litProbs,
                this.litProbsAt(position + len, src[data + len - 1] ?? 0),
                src[data + len] ?? 0,
                src[data2 + len] ?? 0
              );
              state2 = kState_LitAfterMatch;
              posState2 = (posState2 + 1) & this.pbMask;
              price += this.getPriceRep0(state2, posState2);
              const offset = cur + len + len2;
              if (last < offset) last = offset;
              const len3 = len2 - 1;
              const price2 = price + this.lenPrice(this.repLenPrices, posState2, len3);
              if (price2 < (this.optPrice[offset] ?? 0)) {
                this.optPrice[offset] = price2;
                this.optLen[offset] = len3;
                this.optExtra[offset] = len + 1;
                this.optDist[offset] = dist + LZMA_NUM_REPS;
              }
            }

            offs += 2;
            if (offs === numPairs) break;
            dist = matches[offs + 1] ?? 0;
            posSlot = this.posSlot2(dist);
          }
        }
      }
    }

    let at = last;
    do {
      this.optPrice[at] = kInfinityPrice;
    } while (--at !== 0);

    return this.backward(cur);
  }

  // MARK: - The encode loop

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#LzmaEnc_CodeOneBlock */
  private codeOneBlock(): void {
    const src = this.src;
    let nowPos32 = 0;

    if (this.mf.numAvailableBytes === 0) {
      this.flush();
      return;
    }

    {
      this.readMatchDistances();
      this.encodeBit(this.isMatch, 0, 0);
      const curByte = src[this.mf.cursor - this.additionalOffset] ?? 0;
      this.litEncode(this.litProbs, 0, curByte);
      this.additionalOffset--;
      nowPos32++;
    }

    if (this.mf.numAvailableBytes !== 0) {
      for (;;) {
        let len: number;
        const oci = this.optCur;
        if (this.optEnd === oci) {
          len = this.getOptimum(nowPos32);
        } else {
          len = this.optLen[oci] ?? 0;
          this.backRes = this.optDist[oci] ?? 0;
          this.optCur = oci + 1;
        }

        const posState = nowPos32 & this.pbMask;
        let dist = this.backRes;
        const matchAt = this.state * LZMA_NUM_PB_STATES_MAX + posState;

        if (dist === MARK_LIT) {
          this.encodeBit(this.isMatch, matchAt, 0);
          const data = this.mf.cursor - this.additionalOffset;
          const probsAt = this.litProbsAt(nowPos32, src[data - 1] ?? 0);
          const curByte = src[data] ?? 0;
          const state = this.state;
          this.state = kLiteralNextStates[state] ?? 0;
          if (isLitState(state)) this.litEncode(this.litProbs, probsAt, curByte);
          else {
            this.litEncodeMatched(
              this.litProbs,
              probsAt,
              curByte,
              src[data - (this.reps[0] ?? 0)] ?? 0
            );
          }
        } else {
          this.encodeBit(this.isMatch, matchAt, 1);
          if (dist < LZMA_NUM_REPS) {
            this.encodeBit(this.isRep, this.state, 1);
            if (dist === 0) {
              this.encodeBit(this.isRepG0, this.state, 0);
              this.encodeBit(this.isRep0Long, matchAt, len !== 1 ? 1 : 0);
              if (len === 1) this.state = kShortRepNextStates[this.state] ?? 0;
            } else {
              this.encodeBit(this.isRepG0, this.state, 1);
              if (dist === 1) {
                this.encodeBit(this.isRepG1, this.state, 0);
                dist = this.reps[1] ?? 0;
              } else {
                this.encodeBit(this.isRepG1, this.state, 1);
                if (dist === 2) {
                  this.encodeBit(this.isRepG2, this.state, 0);
                  dist = this.reps[2] ?? 0;
                } else {
                  this.encodeBit(this.isRepG2, this.state, 1);
                  dist = this.reps[3] ?? 0;
                  this.reps[3] = this.reps[2] ?? 0;
                }
                this.reps[2] = this.reps[1] ?? 0;
              }
              this.reps[1] = this.reps[0] ?? 0;
              this.reps[0] = dist;
            }
            if (len !== 1) {
              this.lenEncode(this.repLenProbs, len - LZMA_MATCH_LEN_MIN, posState);
              this.repLenEncCounter--;
              this.state = kRepNextStates[this.state] ?? 0;
            }
          } else {
            this.encodeBit(this.isRep, this.state, 0);
            this.state = kMatchNextStates[this.state] ?? 0;
            this.lenEncode(this.lenProbs, len - LZMA_MATCH_LEN_MIN, posState);
            dist -= LZMA_NUM_REPS;
            this.reps[3] = this.reps[2] ?? 0;
            this.reps[2] = this.reps[1] ?? 0;
            this.reps[1] = this.reps[0] ?? 0;
            this.reps[0] = dist + 1;
            this.matchPriceCount++;

            const posSlot = this.posSlot(dist);
            {
              let sym = posSlot + (1 << kNumPosSlotBits);
              const probsAt = getLenToPosState(len) * (1 << kNumPosSlotBits);
              do {
                const bit = (sym >>> (kNumPosSlotBits - 1)) & 1;
                this.encodeBit(this.posSlotEncoder, probsAt + (sym >>> kNumPosSlotBits), bit);
                sym <<= 1;
              } while (sym < 1 << (kNumPosSlotBits * 2));
            }

            if (dist >= kStartPosModelIndex) {
              const footerBits = (posSlot >> 1) - 1;
              if (dist < kNumFullDistances) {
                const base = (2 | (posSlot & 1)) << footerBits;
                this.reverseEncode(this.posEncoders, base, footerBits, dist);
              } else {
                // The direct bits, then the four aligned ones.
                let pos2 = ((dist | 0xf) * 2 ** (32 - footerBits)) % 0x1_0000_0000;
                do {
                  this.range = Math.floor(this.range / 2);
                  if (pos2 >= 0x8000_0000) this.low += this.range;
                  pos2 = (pos2 * 2) % 0x1_0000_0000;
                  this.norm();
                } while (pos2 !== 0xf0000000);
                let rest = dist;
                let m = 1;
                for (let step = 0; step < 4; step++) {
                  const bit = rest & 1;
                  rest >>>= 1;
                  this.encodeBit(this.posAlignEncoder, m, bit);
                  m = (m << 1) + bit;
                }
              }
            }
          }
        }

        nowPos32 += len;
        this.additionalOffset -= len;

        if (this.additionalOffset === 0) {
          if (this.matchPriceCount >= 64) {
            this.fillAlignPrices();
            this.fillDistancesPrices();
            this.updateLenTables(this.lenPrices, this.lenProbs);
          }
          if (this.repLenEncCounter <= 0) {
            this.repLenEncCounter = REP_LEN_COUNT;
            this.updateLenTables(this.repLenPrices, this.repLenProbs);
          }
          if (this.mf.numAvailableBytes === 0) break;
          // @upstream-differs the progress is reported from inside the block
          // rather than between blocks: a whole-buffer encode is one block, so
          // upstream's report would arrive only once, at the end, and a worker
          // that cannot show movement is a worker that looks hung
          this.onProgress?.(nowPos32);
        }
      }
    }

    this.flush();
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzmaEnc.c#Flush */
  private flush(): void {
    this.flushData();
  }
}
