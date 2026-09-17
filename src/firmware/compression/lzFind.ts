/**
 * The LZMA SDK's match finder — a port of `LzFind.c` (Igor Pavlov, public
 * domain), the file upstream vendors beside its encoder.
 *
 * The binary-tree finder over four hash bytes, which is what levels 5 and 9 use
 * and so the only mode a firmware section is ever compressed in here. The other
 * modes of that file — bt2, bt3, bt5 and the hash-chain finders — and the
 * multi-threaded halves are recorded in the module map rather than ported: this
 * encoder never asks for them.
 *
 * The input is always a whole buffer already in memory, which is the SDK's
 * "direct input" mode: the window is a view into the source rather than a block
 * read through a stream, so `ReadBlock` is an advance of one counter and the
 * block move never happens. What that leaves is the tree itself, ported path for
 * path with the SDK's names.
 *
 * The C's pointers become indices: `buffer` is the source and `bufferAt` the
 * position in it, `son` and `hash` are one `Uint32Array` as in the C, with the
 * tree's half starting at `sonAt`.
 */

const kEmptyHashValue = 0;
const kCrcPoly = 0xedb88320;
const kHash2Size = 1 << 10;
const kHash3Size = 1 << 16;
const kFix3HashSize = kHash2Size;
const kFix4HashSize = kHash2Size + kHash3Size;
const kLzHash_CrcShift_1 = 5;

/**
 * The SDK's match finder, in the bt4 configuration EDK2 asks for. It carries no
 * `@upstream` anchor because `CMatchFinder` is a `typedef struct`, and the
 * anchor check reads a C file for its functions.
 */
export class MatchFinder {
  /** The whole source, and where in it the window's cursor stands. */
  private readonly buffer: Uint8Array;
  private bufferAt = 0;
  private directInputRem = 0;

  pos = 0;
  streamPos = 0;
  private posLimit = 0;
  lenLimit = 0;
  private cyclicBufferPos = 0;
  private cyclicBufferSize = 0;
  private matchMaxLen = 0;
  private keepSizeAfter = 0;
  private cutValue = 32;
  private hashMask = 0;
  private fixedHashSize = 0;
  streamEndWasReached = false;

  /** `hash` and `son` are one allocation, as the C makes them. */
  private refs = new Uint32Array(0);
  private sonAt = 0;

  private readonly crc = new Uint32Array(256);

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#MatchFinder_Construct */
  constructor(source: Uint8Array) {
    this.buffer = source;
    this.directInputRem = source.length;
    for (let index = 0; index < 256; index++) {
      let r = index;
      for (let bit = 0; bit < 8; bit++) r = (r >>> 1) ^ (kCrcPoly & -(r & 1));
      this.crc[index] = r >>> 0;
    }
  }

  /**
   * How much of the source is still ahead of the cursor — the C's
   * `Inline_MatchFinder_GetNumAvailableBytes`, a macro in `LzFind.h` and so
   * nothing the anchor check reads.
   */
  get numAvailableBytes(): number {
    return (this.streamPos - this.pos) >>> 0;
  }

  /** The byte `offset` ahead of the cursor. */
  byteAt(offset: number): number {
    return this.buffer[this.bufferAt + offset] ?? 0;
  }

  /** Where the cursor stands in the source, for the encoder's own reads. */
  get cursor(): number {
    return this.bufferAt;
  }

  /**
   * The hash mask for a history size, the way the SDK rounds it.
   *
   * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#MatchFinder_GetHashMask
   */
  private static hashMaskOf(historySize: number): number {
    let hs = historySize;
    if (hs !== 0) hs--;
    hs |= hs >>> 1;
    hs |= hs >>> 2;
    hs |= hs >>> 4;
    hs |= hs >>> 8;
    hs >>>= 1;
    if (hs >= 1 << 24) hs >>>= 1;
    hs |= (1 << 16) - 1;
    return hs >>> 0;
  }

  /**
   * Sizes the tables for a history size, as `MatchFinder_Create` does for bt4.
   *
   * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#MatchFinder_Create
   */
  create(
    historySize: number,
    keepAddBufferBefore: number,
    matchMaxLen: number,
    keepAddBufferAfter: number,
    cutValue: number
  ): void {
    this.cutValue = cutValue;
    // The C keeps one byte more than the history for its block move, which
    // direct input never makes; what is left of `keepSizeBefore` is the
    // argument itself.
    void keepAddBufferBefore;
    let after = keepAddBufferAfter + matchMaxLen;
    if (after < 4) after = 4; // numHashBytes
    this.keepSizeAfter = after;

    const hs = MatchFinder.hashMaskOf(historySize);
    this.hashMask = hs;
    this.fixedHashSize = kHash2Size + kHash3Size;
    const hashSizeSum = hs + 1 + this.fixedHashSize;

    this.matchMaxLen = matchMaxLen;
    const newCyclicBufferSize = historySize + 1; // do not change it
    this.cyclicBufferSize = newCyclicBufferSize;
    const numSons = newCyclicBufferSize * 2; // btMode
    const newSize = (hashSizeSum + numSons + 0xf) & ~0xf;

    this.refs = new Uint32Array(newSize);
    this.sonAt = hashSizeSum;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#MatchFinder_Init */
  init(): void {
    this.refs.fill(kEmptyHashValue, 0, this.fixedHashSize + this.hashMask + 1);
    // The C keeps (pos = 1) as the smallest value the empty-hash marker allows.
    this.pos = 1;
    this.streamPos = 1;
    this.streamEndWasReached = false;
    this.readBlock();
    this.cyclicBufferPos = this.pos;
    this.setLimits();
  }

  /**
   * Direct input: the whole source is there, so this only says how much of it
   * the finder may look at.
   *
   * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#MatchFinder_ReadBlock
   */
  private readBlock(): void {
    if (this.streamEndWasReached) return;
    let curSize = 0xffffffff - this.numAvailableBytes;
    if (curSize > this.directInputRem) curSize = this.directInputRem;
    this.streamPos = (this.streamPos + curSize) >>> 0;
    this.directInputRem -= curSize;
    if (this.directInputRem === 0) this.streamEndWasReached = true;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#MatchFinder_SetLimits */
  private setLimits(): void {
    // kMaxValForNormalize is zero, so the first term is the whole range.
    let n = 0xffffffff;
    let k = this.cyclicBufferSize - this.cyclicBufferPos;
    if (k < n) n = k;
    k = this.numAvailableBytes;
    const ksa = this.keepSizeAfter;
    let mm = this.matchMaxLen;
    if (k > ksa) {
      k -= ksa;
    } else if (k >= mm) {
      k -= mm;
      k++;
    } else {
      mm = k;
      if (k !== 0) k = 1;
    }
    this.lenLimit = mm;
    if (k < n) n = k;
    this.posLimit = this.pos + n;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#MatchFinder_CheckLimits */
  private checkLimits(): void {
    if (this.keepSizeAfter === this.numAvailableBytes) this.readBlock();
    // Normalization never runs here: kMaxValForNormalize is zero and `pos`
    // starts at one, so `pos == kMaxValForNormalize` is false for every buffer
    // this project compresses.
    if (this.cyclicBufferPos === this.cyclicBufferSize) this.cyclicBufferPos = 0;
    this.setLimits();
  }

  /**
   * One position on, which is the whole of the C's `MOVE_POS` macro.
   *
   * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#MatchFinder_MovePos
   */
  private movePos(): void {
    this.cyclicBufferPos++;
    this.bufferAt++;
    this.pos = (this.pos + 1) >>> 0;
    if (this.pos === this.posLimit) this.checkLimits();
  }

  /**
   * The matches at the cursor, longest last, written into `distances` as pairs
   * of length and distance − 1; the count of numbers written comes back.
   *
   * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#Bt4_MatchFinder_GetMatches
   */
  getMatches(distances: Uint32Array): number {
    const lenLimit = this.lenLimit;
    if (lenLimit < 4) {
      this.movePos();
      return 0;
    }
    const cur = this.bufferAt;
    const buffer = this.buffer;

    // HASH4_CALC
    let temp = ((this.crc[buffer[cur] ?? 0] ?? 0) ^ (buffer[cur + 1] ?? 0)) >>> 0;
    const h2 = temp & (kHash2Size - 1);
    temp = (temp ^ ((buffer[cur + 2] ?? 0) << 8)) >>> 0;
    const h3 = temp & (kHash3Size - 1);
    const hv =
      ((temp ^ (((this.crc[buffer[cur + 3] ?? 0] ?? 0) << kLzHash_CrcShift_1) >>> 0)) &
        this.hashMask) >>>
      0;

    const pos = this.pos;
    let d2 = (pos - (this.refs[h2] ?? 0)) >>> 0;
    const d3 = (pos - (this.refs[kFix3HashSize + h3] ?? 0)) >>> 0;
    const curMatch = this.refs[kFix4HashSize + hv] ?? 0;

    this.refs[h2] = pos;
    this.refs[kFix3HashSize + h3] = pos;
    this.refs[kFix4HashSize + hv] = pos;

    const mmm = pos < this.cyclicBufferSize ? pos : this.cyclicBufferSize;
    let maxLen = 3;
    let at = 0;

    for (;;) {
      if (d2 < mmm && buffer[cur - d2] === buffer[cur]) {
        distances[0] = 2;
        distances[1] = d2 - 1;
        at = 2;
        if (buffer[cur - d2 + 2] === buffer[cur + 2]) {
          // The pair already says what it is.
        } else if (d3 < mmm && buffer[cur - d3] === buffer[cur]) {
          d2 = d3;
          distances[at + 1] = d3 - 1;
          at += 2;
        } else break;
      } else if (d3 < mmm && buffer[cur - d3] === buffer[cur]) {
        d2 = d3;
        distances[1] = d3 - 1;
        at = 2;
      } else break;

      // UPDATE_maxLen
      let c = cur + maxLen;
      const lim = cur + lenLimit;
      for (; c !== lim; c++) if (buffer[c - d2] !== buffer[c]) break;
      maxLen = c - cur;
      distances[at - 2] = maxLen;
      if (maxLen === lenLimit) {
        this.skipMatchesSpec(lenLimit, curMatch);
        this.movePos();
        return at;
      }
      break;
    }

    const written = this.getMatchesSpec1(lenLimit, curMatch, distances, at, maxLen);
    this.movePos();
    return written;
  }

  /**
   * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#GetMatchesSpec1
   */
  private getMatchesSpec1(
    lenLimit: number,
    curMatchIn: number,
    distances: Uint32Array,
    atIn: number,
    maxLenIn: number
  ): number {
    const son = this.refs;
    const base = this.sonAt;
    const cur = this.bufferAt;
    const buffer = this.buffer;
    const cyclicBufferPos = this.cyclicBufferPos;
    const cyclicBufferSize = this.cyclicBufferSize;
    let cutValue = this.cutValue;
    let curMatch = curMatchIn;
    let at = atIn;
    let maxLen = maxLenIn;

    let ptr0 = base + cyclicBufferPos * 2 + 1;
    let ptr1 = base + cyclicBufferPos * 2;
    let len0 = 0;
    let len1 = 0;

    let cmCheck = (this.pos - cyclicBufferSize) >>> 0;
    if (this.pos < cyclicBufferSize) cmCheck = 0;

    if (cmCheck < curMatch) {
      do {
        const delta = (this.pos - curMatch) >>> 0;
        const pair =
          base + (cyclicBufferPos - delta + (cyclicBufferPos < delta ? cyclicBufferSize : 0)) * 2;
        const pb = cur - delta;
        let len = len0 < len1 ? len0 : len1;
        const pair0 = son[pair] ?? 0;
        if (buffer[pb + len] === buffer[cur + len]) {
          if (++len !== lenLimit && buffer[pb + len] === buffer[cur + len]) {
            while (++len !== lenLimit) if (buffer[pb + len] !== buffer[cur + len]) break;
          }
          if (maxLen < len) {
            maxLen = len;
            distances[at++] = len;
            distances[at++] = delta - 1;
            if (len === lenLimit) {
              son[ptr1] = pair0;
              son[ptr0] = son[pair + 1] ?? 0;
              return at;
            }
          }
        }
        if ((buffer[pb + len] ?? 0) < (buffer[cur + len] ?? 0)) {
          son[ptr1] = curMatch;
          curMatch = son[pair + 1] ?? 0;
          ptr1 = pair + 1;
          len1 = len;
        } else {
          son[ptr0] = curMatch;
          curMatch = son[pair] ?? 0;
          ptr0 = pair;
          len0 = len;
        }
      } while (--cutValue !== 0 && cmCheck < curMatch);
    }

    son[ptr0] = kEmptyHashValue;
    son[ptr1] = kEmptyHashValue;
    return at;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#SkipMatchesSpec */
  private skipMatchesSpec(lenLimit: number, curMatchIn: number): void {
    const son = this.refs;
    const base = this.sonAt;
    const cur = this.bufferAt;
    const buffer = this.buffer;
    const cyclicBufferPos = this.cyclicBufferPos;
    const cyclicBufferSize = this.cyclicBufferSize;
    let cutValue = this.cutValue;
    let curMatch = curMatchIn;

    let ptr0 = base + cyclicBufferPos * 2 + 1;
    let ptr1 = base + cyclicBufferPos * 2;
    let len0 = 0;
    let len1 = 0;

    let cmCheck = (this.pos - cyclicBufferSize) >>> 0;
    if (this.pos < cyclicBufferSize) cmCheck = 0;

    if (cmCheck < curMatch) {
      do {
        const delta = (this.pos - curMatch) >>> 0;
        const pair =
          base + (cyclicBufferPos - delta + (cyclicBufferPos < delta ? cyclicBufferSize : 0)) * 2;
        const pb = cur - delta;
        let len = len0 < len1 ? len0 : len1;
        if (buffer[pb + len] === buffer[cur + len]) {
          while (++len !== lenLimit) if (buffer[pb + len] !== buffer[cur + len]) break;
          if (len === lenLimit) {
            son[ptr1] = son[pair] ?? 0;
            son[ptr0] = son[pair + 1] ?? 0;
            return;
          }
        }
        if ((buffer[pb + len] ?? 0) < (buffer[cur + len] ?? 0)) {
          son[ptr1] = curMatch;
          curMatch = son[pair + 1] ?? 0;
          ptr1 = pair + 1;
          len1 = len;
        } else {
          son[ptr0] = curMatch;
          curMatch = son[pair] ?? 0;
          ptr0 = pair;
          len0 = len;
        }
      } while (--cutValue !== 0 && cmCheck < curMatch);
    }

    son[ptr0] = kEmptyHashValue;
    son[ptr1] = kEmptyHashValue;
  }

  /**
   * Walks `num` positions on without collecting their matches, keeping the tree
   * up to date.
   *
   * @upstream Packages/FirmwareCompression/Sources/CLZMAEncoder/SDK/LzFind.c#Bt4_MatchFinder_Skip
   */
  skip(num: number): void {
    let left = num;
    do {
      const lenLimit = this.lenLimit;
      if (lenLimit < 4) {
        this.movePos();
        continue;
      }
      const cur = this.bufferAt;
      const buffer = this.buffer;
      let temp = ((this.crc[buffer[cur] ?? 0] ?? 0) ^ (buffer[cur + 1] ?? 0)) >>> 0;
      const h2 = temp & (kHash2Size - 1);
      temp = (temp ^ ((buffer[cur + 2] ?? 0) << 8)) >>> 0;
      const h3 = temp & (kHash3Size - 1);
      const hv =
        ((temp ^ (((this.crc[buffer[cur + 3] ?? 0] ?? 0) << kLzHash_CrcShift_1) >>> 0)) &
          this.hashMask) >>>
        0;
      const curMatch = this.refs[kFix4HashSize + hv] ?? 0;
      this.refs[h2] = this.pos;
      this.refs[kFix3HashSize + h3] = this.pos;
      this.refs[kFix4HashSize + hv] = this.pos;
      this.skipMatchesSpec(lenLimit, curMatch);
      this.movePos();
    } while (--left !== 0);
  }
}
