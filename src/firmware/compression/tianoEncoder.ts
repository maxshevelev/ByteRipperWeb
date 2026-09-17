/**
 * The Tiano / EFI 1.1 compressor — a port of EDK2's `EfiTianoCompress.c`
 * (Intel, Nikolaj Schlej, BSD-licensed), the file UEFITool vendors and upstream
 * vendors after it.
 *
 * LZ77 over a 8 KiB window, then Huffman coding of the blocks it produces: the
 * other direction of `tianoDecoder.ts`, and the same one switch — the position
 * set's code length array is written with four bits for EFI 1.1 and five for
 * Tiano.
 *
 * Ported routine for routine, with the C's names. The C keeps its whole state in
 * file-level statics, which is why it cannot encode two buffers at once; here
 * that state is one object made where the encode starts, so it can.
 *
 * Two things the C gets from its types are spelled out: `NODE` is a **signed**
 * sixteen-bit number, and the `PERC_FLAG` marking makes a position negative,
 * which is what `mPosition[t] < 0` reads — so those arrays are `Int16Array` and
 * every store through them wraps as the C's does.
 */

// MARK: - The compressor's constants

const UINT8_MAX = 0xff;
const UINT8_BIT = 8;
const THRESHOLD = 3;
const WNDBIT = 13;
const WNDSIZ = 1 << WNDBIT;
const MAXMATCH = 256;
const PERC_FLAG = 0x8000;
const CODE_BIT = 16;
const NIL = 0;
const MAX_HASH_VAL = 3 * WNDSIZ + (WNDSIZ / 512 + 1) * UINT8_MAX;
const CRCPOLY = 0xa001;

/** C: the Char&Len Set; P: the Position Set; T: the exTra Set. */
const NC = UINT8_MAX + MAXMATCH + 2 - THRESHOLD;
const CBIT = 9;
const NP = WNDBIT + 1;
const NT = CODE_BIT + 3;
const TBIT = 5;
const NPT = NT > NP ? NT : NP;

const hash = (p: number, c: number) => p + (c << (WNDBIT - 9)) + WNDSIZ * 2;

/** What an encode came to: the stream, or the size the buffer had to be. */
export type TianoEncoded =
  | { readonly ok: true; readonly bytes: Uint8Array }
  /** The destination was too small; `needed` is what it takes. */
  | { readonly ok: false; readonly needed: number };

/**
 * `bytes` as a Tiano stream when `tiano` is set, as EFI 1.1 otherwise: eight
 * bytes of compressed and original size, then the stream.
 *
 * `capacity` is the buffer the C would have been handed. Too small a one comes
 * back with the size it needs, as `EFI_BUFFER_TOO_SMALL` does.
 *
 * @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#EfiCompress
 * @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#TianoCompress
 * @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/CTianoEncoder.c#ctiano_encode
 */
export function tianoCompress(bytes: Uint8Array, tiano: boolean, capacity: number): TianoEncoded {
  const encoder = new TianoEncoder(bytes, capacity, tiano ? 5 : 4);
  return encoder.compress();
}

/** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#EfiCompress */
class TianoEncoder {
  // The source, and how far the reader has got through it.
  private readonly src: Uint8Array;
  private srcAt = 0;
  // The destination, and the same for the writer. The C writes only while it is
  // under the limit and counts what it would have written past it, so that the
  // caller learns the size it needs; `dstAt` counts the same way.
  private readonly dst: Uint8Array;
  private dstAt = 0;
  private readonly dstLimit: number;

  /**
   * The length of the position set's code length array: 4 for EFI 1.1, 5 for
   * Tiano — the one field the two algorithms differ in.
   *
   * The C's `gPBIT`, a global it sets before it starts; here it is a field made
   * with the encoder, so two buffers can be compressed at once. It carries no
   * `@upstream` anchor because a variable is not a declaration the anchor check
   * reads.
   */
  private readonly pBit: number;

  // The sliding window and the tree over it.
  private readonly text = new Uint8Array(WNDSIZ * 2 + MAXMATCH);
  private readonly level = new Uint8Array(WNDSIZ + UINT8_MAX + 1);
  private readonly childCount = new Uint8Array(WNDSIZ + UINT8_MAX + 1);
  private readonly position = new Int16Array(WNDSIZ + UINT8_MAX + 1);
  private readonly parent = new Int16Array(WNDSIZ * 2);
  private readonly prev = new Int16Array(WNDSIZ * 2);
  private readonly next = new Int16Array(MAX_HASH_VAL + 1);

  private pos = 0;
  private matchPos = 0;
  private avail = 1;
  private remainder = 0;
  private matchLen = 0;

  // The block being built, and the bit writer behind it.
  private readonly buf = new Uint8Array(16 * 1024);
  private readonly bufSiz = 16 * 1024;
  private outputPos = 0;
  private outputMask = 0;
  private cPos = 0;
  private bitCount = 0;
  private subBitBuf = 0;
  private compSize = 0;
  private origSize = 0;
  private crc = 0;
  private readonly crcTable = new Uint16Array(UINT8_MAX + 1);

  // The Huffman sets.
  private readonly cLen = new Uint8Array(NC);
  private readonly ptLen = new Uint8Array(NPT);
  private readonly cFreq = new Uint16Array(2 * NC - 1);
  private readonly cCode = new Uint16Array(NC);
  private readonly pFreq = new Uint16Array(2 * NP - 1);
  private readonly ptCode = new Uint16Array(NPT);
  private readonly tFreq = new Uint16Array(2 * NT - 1);
  private readonly heap = new Int16Array(NC + 1);
  private readonly lenCnt = new Uint16Array(17);
  private readonly left = new Uint16Array(2 * NC - 1);
  private readonly right = new Uint16Array(2 * NC - 1);

  // What `MakeTree` is working on: the C points at the caller's arrays.
  private freq: Uint16Array = this.cFreq;
  private len: Uint8Array = this.cLen;
  private sortPtr: Uint16Array = this.cCode;
  private sortAt = 0;
  private n = 0;
  private heapSize = 0;
  /** `CountLen`'s own static depth. */
  private depth = 0;

  constructor(src: Uint8Array, capacity: number, pBit: number) {
    this.src = src;
    this.dst = new Uint8Array(capacity);
    this.dstLimit = capacity;
    this.pBit = pBit;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#EfiCompress */
  compress(): TianoEncoded {
    this.putDword(0);
    this.putDword(0);
    this.makeCrcTable();

    this.origSize = 0;
    this.compSize = 0;
    this.crc = 0;

    this.encode();

    // Null terminate the compressed data.
    if (this.dstAt < this.dstLimit) this.dst[this.dstAt++] = 0;

    // Fill in compressed size and original size.
    this.dstAt = 0;
    this.putDword(this.compSize + 1);
    this.putDword(this.origSize);

    const length = this.compSize + 1 + 8;
    if (length > this.dstLimit) return { ok: false, needed: length };
    return { ok: true, bytes: this.dst.subarray(0, length) };
  }

  // MARK: - The stream

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#PutDword */
  private putDword(data: number): void {
    for (let shift = 0; shift < 32; shift += 8) {
      if (this.dstAt < this.dstLimit) this.dst[this.dstAt++] = (data >>> shift) & 0xff;
    }
  }

  /**
   * Outputs the rightmost `n` bits of `x`.
   *
   * @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#PutBits
   */
  private putBits(n: number, x: number): void {
    if (n < this.bitCount) {
      this.bitCount -= n;
      this.subBitBuf |= (x << this.bitCount) >>> 0;
      return;
    }
    let bits = n - this.bitCount;
    let temp = (this.subBitBuf | (x >>> bits)) & 0xff;
    if (this.dstAt < this.dstLimit) this.dst[this.dstAt++] = temp;
    this.compSize++;

    if (bits < UINT8_BIT) {
      this.bitCount = UINT8_BIT - bits;
      this.subBitBuf = (x << this.bitCount) >>> 0;
      return;
    }
    temp = (x >>> (bits - UINT8_BIT)) & 0xff;
    if (this.dstAt < this.dstLimit) this.dst[this.dstAt++] = temp;
    this.compSize++;
    this.bitCount = 2 * UINT8_BIT - bits;
    this.subBitBuf = (x << this.bitCount) >>> 0;
    bits = 0;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#InitPutBits */
  private initPutBits(): void {
    this.bitCount = UINT8_BIT;
    this.subBitBuf = 0;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#MakeCrcTable */
  private makeCrcTable(): void {
    for (let index = 0; index <= UINT8_MAX; index++) {
      let r = index;
      for (let bit = 0; bit < UINT8_BIT; bit++) {
        r = (r & 1) !== 0 ? (r >>> 1) ^ CRCPOLY : r >>> 1;
      }
      this.crcTable[index] = r & 0xffff;
    }
  }

  /**
   * Reads source data into the window, keeping the CRC the format carries but
   * never writes down.
   *
   * @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#FreadCrc
   */
  private freadCrc(at: number, count: number): number {
    let read = 0;
    while (this.srcAt < this.src.length && read < count) {
      this.text[at + read] = this.src[this.srcAt++] ?? 0;
      read++;
    }
    this.origSize += read;
    for (let index = 0; index < read; index++) {
      const byte = this.text[at + index] ?? 0;
      this.crc =
        ((this.crcTable[(this.crc ^ byte) & 0xff] ?? 0) ^ (this.crc >>> UINT8_BIT)) & 0xffff;
    }
    return read;
  }

  // MARK: - The window's tree

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#InitSlide */
  private initSlide(): void {
    for (let index = WNDSIZ; index <= WNDSIZ + UINT8_MAX; index++) {
      this.level[index] = 1;
      this.position[index] = NIL; // sentinel
    }
    for (let index = WNDSIZ; index < WNDSIZ * 2; index++) this.parent[index] = NIL;
    this.avail = 1;
    for (let index = 1; index < WNDSIZ - 1; index++) this.next[index] = index + 1;
    this.next[WNDSIZ - 1] = NIL;
    for (let index = WNDSIZ * 2; index <= MAX_HASH_VAL; index++) this.next[index] = NIL;
  }

  /**
   * The child of `q` along the edge `c`, or `NIL`.
   *
   * @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#Child
   */
  private child(q: number, c: number): number {
    let r = this.next[hash(q, c)] ?? NIL;
    this.parent[NIL] = q; // sentinel
    while ((this.parent[r] ?? NIL) !== q) r = this.next[r] ?? NIL;
    return r;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#MakeChild */
  private makeChild(q: number, c: number, r: number): void {
    const h = hash(q, c);
    const t = this.next[h] ?? NIL;
    this.next[h] = r;
    this.next[r] = t;
    this.prev[t] = r;
    this.prev[r] = h;
    this.parent[r] = q;
    this.childCount[q] = ((this.childCount[q] ?? 0) + 1) & 0xff;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#Split */
  private split(old: number): void {
    const fresh = this.avail;
    this.avail = this.next[fresh] ?? NIL;
    this.childCount[fresh] = 0;
    let t = this.prev[old] ?? NIL;
    this.prev[fresh] = t;
    this.next[t] = fresh;
    t = this.next[old] ?? NIL;
    this.next[fresh] = t;
    this.prev[t] = fresh;
    this.parent[fresh] = this.parent[old] ?? NIL;
    this.level[fresh] = this.matchLen & 0xff;
    this.position[fresh] = this.pos;
    this.makeChild(fresh, this.text[this.matchPos + this.matchLen] ?? 0, old);
    this.makeChild(fresh, this.text[this.pos + this.matchLen] ?? 0, this.pos);
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#InsertNode */
  private insertNode(): void {
    let q = 0;
    let r = 0;
    let t = 0;

    if (this.matchLen >= 4) {
      // A long match: the target tree is at MatchPos + 1, and the way up to a
      // proper starting point is through the parents. PERC_FLAG is what keeps
      // the later deletion clean.
      this.matchLen--;
      r = asInt16((this.matchPos + 1) | WNDSIZ);
      for (;;) {
        q = this.parent[r] ?? NIL;
        if (q !== NIL) break;
        r = this.next[r] ?? NIL;
      }
      while ((this.level[q] ?? 0) >= this.matchLen) {
        r = q;
        q = this.parent[q] ?? NIL;
      }
      t = q;
      while ((this.position[t] ?? 0) < 0) {
        this.position[t] = this.pos;
        t = this.parent[t] ?? NIL;
      }
      if (t < WNDSIZ) this.position[t] = asInt16(this.pos | PERC_FLAG);
    } else {
      // Locate the target tree.
      q = asInt16((this.text[this.pos] ?? 0) + WNDSIZ);
      const c = this.text[this.pos + 1] ?? 0;
      r = this.child(q, c);
      if (r === NIL) {
        this.makeChild(q, c, this.pos);
        this.matchLen = 1;
        return;
      }
      this.matchLen = 2;
    }

    // Down the tree to a match, updating Position on the way; a node may be
    // split or made.
    for (;;) {
      let j: number;
      if (r >= WNDSIZ) {
        j = MAXMATCH;
        this.matchPos = r;
      } else {
        j = this.level[r] ?? 0;
        this.matchPos = asInt16((this.position[r] ?? 0) & ~PERC_FLAG);
      }
      if (this.matchPos >= this.pos) this.matchPos -= WNDSIZ;
      let t1 = this.pos + this.matchLen;
      let t2 = this.matchPos + this.matchLen;
      while (this.matchLen < j) {
        if (this.text[t1] !== this.text[t2]) {
          this.split(r);
          return;
        }
        this.matchLen++;
        t1++;
        t2++;
      }
      if (this.matchLen >= MAXMATCH) break;
      this.position[r] = this.pos;
      q = r;
      r = this.child(q, this.text[t1] ?? 0);
      if (r === NIL) {
        this.makeChild(q, this.text[t1] ?? 0, this.pos);
        return;
      }
      this.matchLen++;
    }
    t = this.prev[r] ?? NIL;
    this.prev[this.pos] = t;
    this.next[t] = this.pos;
    t = this.next[r] ?? NIL;
    this.next[this.pos] = t;
    this.prev[t] = this.pos;
    this.parent[this.pos] = q;
    this.parent[r] = NIL;
    // Special usage of 'next'.
    this.next[r] = this.pos;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#DeleteNode */
  private deleteNode(): void {
    if ((this.parent[this.pos] ?? NIL) === NIL) return;

    let r = this.prev[this.pos] ?? NIL;
    let s = this.next[this.pos] ?? NIL;
    this.next[r] = s;
    this.prev[s] = r;
    r = this.parent[this.pos] ?? NIL;
    this.parent[this.pos] = NIL;
    if (r >= WNDSIZ) return;
    this.childCount[r] = ((this.childCount[r] ?? 0) - 1) & 0xff;
    if ((this.childCount[r] ?? 0) > 1) return;

    let t = asInt16((this.position[r] ?? 0) & ~PERC_FLAG);
    if (t >= this.pos) t -= WNDSIZ;
    s = t;
    let q = this.parent[r] ?? NIL;
    let u = this.position[q] ?? 0;
    while ((u & PERC_FLAG) !== 0) {
      u = asInt16(u & ~PERC_FLAG);
      if (u >= this.pos) u -= WNDSIZ;
      if (u > s) s = u;
      this.position[q] = asInt16(s | WNDSIZ);
      q = this.parent[q] ?? NIL;
      u = this.position[q] ?? 0;
    }
    if (q < WNDSIZ) {
      if (u >= this.pos) u -= WNDSIZ;
      if (u > s) s = u;
      this.position[q] = asInt16(s | WNDSIZ | PERC_FLAG);
    }
    s = this.child(r, this.text[t + (this.level[r] ?? 0)] ?? 0);
    t = this.prev[s] ?? NIL;
    u = this.next[s] ?? NIL;
    this.next[t] = u;
    this.prev[u] = t;
    t = this.prev[r] ?? NIL;
    this.next[t] = s;
    this.prev[s] = t;
    t = this.next[r] ?? NIL;
    this.prev[t] = s;
    this.next[s] = t;
    this.parent[s] = this.parent[r] ?? NIL;
    this.parent[r] = NIL;
    this.next[r] = this.avail;
    this.avail = r;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#GetNextMatch */
  private getNextMatch(): void {
    this.remainder--;
    this.pos++;
    if (this.pos === WNDSIZ * 2) {
      this.text.copyWithin(0, WNDSIZ, WNDSIZ * 2 + MAXMATCH);
      this.remainder += this.freadCrc(WNDSIZ + MAXMATCH, WNDSIZ);
      this.pos = WNDSIZ;
    }
    this.deleteNode();
    this.insertNode();
  }

  // MARK: - The encode

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#Encode */
  private encode(): void {
    this.initSlide();
    this.hufEncodeStart();

    this.remainder = this.freadCrc(WNDSIZ, WNDSIZ + MAXMATCH);
    this.matchLen = 0;
    this.pos = WNDSIZ;
    this.insertNode();
    if (this.matchLen > this.remainder) this.matchLen = this.remainder;

    while (this.remainder > 0) {
      let lastMatchLen = this.matchLen;
      const lastMatchPos = this.matchPos;
      this.getNextMatch();
      if (this.matchLen > this.remainder) this.matchLen = this.remainder;

      if (this.matchLen > lastMatchLen || lastMatchLen < THRESHOLD) {
        // Not enough is gained by a pointer: the character goes out as it is.
        this.output(this.text[this.pos - 1] ?? 0, 0);
      } else {
        this.output(
          lastMatchLen + (UINT8_MAX + 1 - THRESHOLD),
          (this.pos - lastMatchPos - 2) & (WNDSIZ - 1)
        );
        while (--lastMatchLen > 0) this.getNextMatch();
        if (this.matchLen > this.remainder) this.matchLen = this.remainder;
      }
    }
    this.hufEncodeEnd();
  }

  /**
   * An original character or a pointer, into the block being built.
   *
   * @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#Output
   */
  private output(c: number, p: number): void {
    this.outputMask >>>= 1;
    if (this.outputMask === 0) {
      this.outputMask = 1 << (UINT8_BIT - 1);
      if (this.outputPos >= this.bufSiz - 3 * UINT8_BIT) {
        this.sendBlock();
        this.outputPos = 0;
      }
      this.cPos = this.outputPos++;
      this.buf[this.cPos] = 0;
    }
    this.buf[this.outputPos++] = c & 0xff;
    this.cFreq[c] = ((this.cFreq[c] ?? 0) + 1) & 0xffff;
    if (c >= 1 << UINT8_BIT) {
      this.buf[this.cPos] = ((this.buf[this.cPos] ?? 0) | this.outputMask) & 0xff;
      this.buf[this.outputPos++] = (p >>> UINT8_BIT) & 0xff;
      this.buf[this.outputPos++] = p & 0xff;
      let bits = 0;
      let rest = p;
      while (rest !== 0) {
        rest >>>= 1;
        bits++;
      }
      this.pFreq[bits] = ((this.pFreq[bits] ?? 0) + 1) & 0xffff;
    }
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#HufEncodeStart */
  private hufEncodeStart(): void {
    this.cFreq.fill(0, 0, NC);
    this.pFreq.fill(0, 0, NP);
    this.outputPos = 0;
    this.outputMask = 0;
    this.initPutBits();
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#HufEncodeEnd */
  private hufEncodeEnd(): void {
    this.sendBlock();
    // Flush remaining bits.
    this.putBits(UINT8_BIT - 1, 0);
  }

  // MARK: - The Huffman coding

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#CountTFreq */
  private countTFreq(): void {
    this.tFreq.fill(0, 0, NT);
    let n = NC;
    while (n > 0 && (this.cLen[n - 1] ?? 0) === 0) n--;
    let index = 0;
    while (index < n) {
      const k = this.cLen[index++] ?? 0;
      if (k === 0) {
        let count = 1;
        while (index < n && (this.cLen[index] ?? 0) === 0) {
          index++;
          count++;
        }
        if (count <= 2) this.tFreq[0] = ((this.tFreq[0] ?? 0) + count) & 0xffff;
        else if (count <= 18) this.tFreq[1] = ((this.tFreq[1] ?? 0) + 1) & 0xffff;
        else if (count === 19) {
          this.tFreq[0] = ((this.tFreq[0] ?? 0) + 1) & 0xffff;
          this.tFreq[1] = ((this.tFreq[1] ?? 0) + 1) & 0xffff;
        } else this.tFreq[2] = ((this.tFreq[2] ?? 0) + 1) & 0xffff;
      } else {
        this.tFreq[k + 2] = ((this.tFreq[k + 2] ?? 0) + 1) & 0xffff;
      }
    }
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#WritePTLen */
  private writePTLen(n: number, nbit: number, special: number): void {
    let count = n;
    while (count > 0 && (this.ptLen[count - 1] ?? 0) === 0) count--;
    this.putBits(nbit, count);
    let index = 0;
    while (index < count) {
      const k = this.ptLen[index++] ?? 0;
      if (k <= 6) this.putBits(3, k);
      else this.putBits(k - 3, (1 << (k - 3)) - 2);
      if (index === special) {
        while (index < 6 && (this.ptLen[index] ?? 0) === 0) index++;
        this.putBits(2, (index - 3) & 3);
      }
    }
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#WriteCLen */
  private writeCLen(): void {
    let n = NC;
    while (n > 0 && (this.cLen[n - 1] ?? 0) === 0) n--;
    this.putBits(CBIT, n);
    let index = 0;
    while (index < n) {
      const k = this.cLen[index++] ?? 0;
      if (k === 0) {
        let count = 1;
        while (index < n && (this.cLen[index] ?? 0) === 0) {
          index++;
          count++;
        }
        if (count <= 2) {
          for (let repeat = 0; repeat < count; repeat++) {
            this.putBits(this.ptLen[0] ?? 0, this.ptCode[0] ?? 0);
          }
        } else if (count <= 18) {
          this.putBits(this.ptLen[1] ?? 0, this.ptCode[1] ?? 0);
          this.putBits(4, count - 3);
        } else if (count === 19) {
          this.putBits(this.ptLen[0] ?? 0, this.ptCode[0] ?? 0);
          this.putBits(this.ptLen[1] ?? 0, this.ptCode[1] ?? 0);
          this.putBits(4, 15);
        } else {
          this.putBits(this.ptLen[2] ?? 0, this.ptCode[2] ?? 0);
          this.putBits(CBIT, count - 20);
        }
      } else {
        this.putBits(this.ptLen[k + 2] ?? 0, this.ptCode[k + 2] ?? 0);
      }
    }
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#EncodeC */
  private encodeC(c: number): void {
    this.putBits(this.cLen[c] ?? 0, this.cCode[c] ?? 0);
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#EncodeP */
  private encodeP(p: number): void {
    let c = 0;
    let q = p;
    while (q !== 0) {
      q >>>= 1;
      c++;
    }
    this.putBits(this.ptLen[c] ?? 0, this.ptCode[c] ?? 0);
    if (c > 1) this.putBits(c - 1, p & (0xffff >>> (17 - c)));
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#SendBlock */
  private sendBlock(): void {
    let flags = 0;
    let root = this.makeTree(NC, this.cFreq, this.cLen, this.cCode);
    const size = this.cFreq[root] ?? 0;
    this.putBits(16, size);
    if (root >= NC) {
      this.countTFreq();
      root = this.makeTree(NT, this.tFreq, this.ptLen, this.ptCode);
      if (root >= NT) {
        this.writePTLen(NT, TBIT, 3);
      } else {
        this.putBits(TBIT, 0);
        this.putBits(TBIT, root);
      }
      this.writeCLen();
    } else {
      this.putBits(TBIT, 0);
      this.putBits(TBIT, 0);
      this.putBits(CBIT, 0);
      this.putBits(CBIT, root);
    }
    root = this.makeTree(NP, this.pFreq, this.ptLen, this.ptCode);
    if (root >= NP) {
      this.writePTLen(NP, this.pBit, -1);
    } else {
      this.putBits(this.pBit, 0);
      this.putBits(this.pBit, root);
    }
    let at = 0;
    for (let index = 0; index < size; index++) {
      if (index % UINT8_BIT === 0) flags = this.buf[at++] ?? 0;
      else flags = (flags << 1) & 0xffffffff;
      if ((flags & (1 << (UINT8_BIT - 1))) !== 0) {
        this.encodeC((this.buf[at++] ?? 0) + (1 << UINT8_BIT));
        let k = (this.buf[at++] ?? 0) << UINT8_BIT;
        k += this.buf[at++] ?? 0;
        this.encodeP(k);
      } else {
        this.encodeC(this.buf[at++] ?? 0);
      }
    }
    this.cFreq.fill(0, 0, NC);
    this.pFreq.fill(0, 0, NP);
  }

  /**
   * Counts the code lengths of a Huffman tree.
   *
   * @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#CountLen
   */
  private countLen(index: number): void {
    if (index < this.n) {
      const at = this.depth < 16 ? this.depth : 16;
      this.lenCnt[at] = ((this.lenCnt[at] ?? 0) + 1) & 0xffff;
      return;
    }
    this.depth++;
    this.countLen(this.left[index] ?? 0);
    this.countLen(this.right[index] ?? 0);
    this.depth--;
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#MakeLen */
  private makeLen(root: number): void {
    this.lenCnt.fill(0, 0, 17);
    this.countLen(root);

    // No code may come out longer than the length it was given.
    let cum = 0;
    for (let index = 16; index > 0; index--) cum += (this.lenCnt[index] ?? 0) << (16 - index);
    while (cum !== 1 << 16) {
      this.lenCnt[16] = ((this.lenCnt[16] ?? 0) - 1) & 0xffff;
      for (let index = 15; index > 0; index--) {
        if ((this.lenCnt[index] ?? 0) !== 0) {
          this.lenCnt[index] = ((this.lenCnt[index] ?? 0) - 1) & 0xffff;
          this.lenCnt[index + 1] = ((this.lenCnt[index + 1] ?? 0) + 2) & 0xffff;
          break;
        }
      }
      cum--;
    }
    for (let index = 16; index > 0; index--) {
      let k = this.lenCnt[index] ?? 0;
      while (--k >= 0) {
        this.len[this.sortPtr[this.sortAt++] ?? 0] = index & 0xff;
      }
    }
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#DownHeap */
  private downHeap(start: number): void {
    let index = start;
    const k = this.heap[index] ?? 0;
    for (;;) {
      let j = 2 * index;
      if (j > this.heapSize) break;
      if (
        j < this.heapSize &&
        (this.freq[this.heap[j] ?? 0] ?? 0) > (this.freq[this.heap[j + 1] ?? 0] ?? 0)
      ) {
        j++;
      }
      if ((this.freq[k] ?? 0) <= (this.freq[this.heap[j] ?? 0] ?? 0)) break;
      this.heap[index] = this.heap[j] ?? 0;
      index = j;
    }
    this.heap[index] = asInt16(k);
  }

  /** @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#MakeCode */
  private makeCode(n: number, len: Uint8Array, code: Uint16Array): void {
    const start = new Uint16Array(18);
    for (let index = 1; index <= 16; index++) {
      start[index + 1] = (((start[index] ?? 0) + (this.lenCnt[index] ?? 0)) << 1) & 0xffff;
    }
    for (let index = 0; index < n; index++) {
      const length = len[index] ?? 0;
      code[index] = start[length] ?? 0;
      start[length] = ((start[length] ?? 0) + 1) & 0xffff;
    }
  }

  /**
   * Huffman codes for a frequency distribution; the root of the tree comes back.
   *
   * @upstream Packages/FirmwareCompression/Sources/CTianoEncoder/Tiano/EfiTianoCompress.c#MakeTree
   */
  private makeTree(nParm: number, freq: Uint16Array, len: Uint8Array, code: Uint16Array): number {
    this.n = nParm;
    this.freq = freq;
    this.len = len;
    let avail = this.n;
    this.heapSize = 0;
    this.heap[1] = 0;
    for (let index = 0; index < this.n; index++) {
      len[index] = 0;
      if ((freq[index] ?? 0) !== 0) this.heap[++this.heapSize] = asInt16(index);
    }
    if (this.heapSize < 2) {
      code[this.heap[1] ?? 0] = 0;
      return this.heap[1] ?? 0;
    }
    for (let index = Math.floor(this.heapSize / 2); index >= 1; index--) this.downHeap(index);

    this.sortPtr = code;
    this.sortAt = 0;
    let k = 0;
    do {
      let i = this.heap[1] ?? 0;
      if (i < this.n) this.sortPtr[this.sortAt++] = i & 0xffff;
      this.heap[1] = this.heap[this.heapSize--] ?? 0;
      this.downHeap(1);
      const j = this.heap[1] ?? 0;
      if (j < this.n) this.sortPtr[this.sortAt++] = j & 0xffff;
      k = avail++;
      freq[k] = ((freq[i] ?? 0) + (freq[j] ?? 0)) & 0xffff;
      this.heap[1] = asInt16(k);
      this.downHeap(1);
      this.left[k] = i & 0xffff;
      this.right[k] = j & 0xffff;
      i = 0;
    } while (this.heapSize > 1);

    this.sortPtr = code;
    this.sortAt = 0;
    this.makeLen(k);
    this.makeCode(nParm, len, code);
    return k;
  }
}

/** The C's `NODE`, which is a signed sixteen-bit number. */
const asInt16 = (value: number) => (value << 16) >> 16;
