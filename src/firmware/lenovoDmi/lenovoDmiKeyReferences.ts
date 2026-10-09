import {
  keyId,
  LenovoDMIFormat,
  type LenovoDMIKey,
  u16,
} from "@/firmware/lenovoDmi/lenovoDmiFormat";

/**
 * Which entries of the store a driver's code asks for — read off its bytes,
 * without disassembling it.
 *
 * A driver asks `LENOVO_VARIABLE_PROTOCOL` for an entry by its 16-byte key, and
 * on the images examined the key reaches the call in one of three ways:
 *
 * - **A constant** in the driver's data: the namespace and the type, 16 bytes in
 *   a row (`OneKeyRecovery`, `LfcMbvUid`).
 * - **Built on the stack** from immediates: `mov dword [frame+d], imm32` four
 *   times — three for the namespace's first 12 bytes, the fourth for its last
 *   two and the type (`InstallMsdm`: `…AB43 0100`, type `0x0001`).
 * - **Built with the type left open**: the last two namespace bytes as a word
 *   (`mov word [frame+d], 0x43AB`), and the type then set byte by byte —
 *   `mov byte [frame+d+2], lo`, `mov byte [frame+d+3], hi` — before each call.
 *   `L05SmbiosOverride` reads ten entries this way, one after another.
 *
 * A key a driver computes at run time from a register is not seen; what is
 * found is what the driver names by constant, which is most of them.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIKeyReferences.swift#LenovoDMIKeyReferences
 */

/**
 * The keys under `namespaces` that `code` names.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIKeyReferences.swift#LenovoDMIKeyReferences.keys
 * @upstream-differs the keys in a list, each once, where upstream answers a set
 */
export function keyReferences(
  code: Uint8Array,
  namespaces: readonly (readonly number[])[]
): LenovoDMIKey[] {
  const found = new Map<string, LenovoDMIKey>();
  const add = (key: LenovoDMIKey) => {
    const id = keyId(key);
    if (!found.has(id)) found.set(id, key);
  };
  for (const namespace of namespaces) {
    if (namespace.length !== LenovoDMIFormat.namespaceSize) continue;
    for (const key of constants(code, namespace)) add(key);
    for (const key of built(code, namespace)) add(key);
  }
  return [...found.values()];
}

// MARK: - A constant

function constants(code: Uint8Array, namespace: readonly number[]): LenovoDMIKey[] {
  const found: LenovoDMIKey[] = [];
  for (const start of occurrences(namespace, code)) {
    const end = start + namespace.length;
    if (end + 2 > code.length) continue;
    found.push({ namespace, type: u16(code, end) });
  }
  return found;
}

// MARK: - Built on the stack

/**
 * A store of an immediate into the frame: how it addresses the frame, its
 * displacement byte, and whether it stores a word.
 */
interface FrameStore {
  /** `0x45` for `[rbp+d8]`, `0x44` for `[rsp+d8]` (with a `0x24` SIB). */
  readonly base: number;
  readonly displacement: number;
  readonly isWord: boolean;
}

/**
 * The store whose immediate starts at `immediate`, if the bytes before it are
 * `C7 45 d` / `C7 44 24 d`, or the same after a `66` word prefix.
 */
function storeBefore(immediate: number, code: Uint8Array): FrameStore | undefined {
  // [rbp+d8]: C7 45 d imm
  if (immediate >= 3 && code[immediate - 3] === 0xc7 && code[immediate - 2] === 0x45) {
    const word = immediate >= 4 && code[immediate - 4] === 0x66;
    return { base: 0x45, displacement: code[immediate - 1] ?? 0, isWord: word };
  }
  // [rsp+d8]: C7 44 24 d imm
  if (
    immediate >= 4 &&
    code[immediate - 4] === 0xc7 &&
    code[immediate - 3] === 0x44 &&
    code[immediate - 2] === 0x24
  ) {
    const word = immediate >= 5 && code[immediate - 5] === 0x66;
    return { base: 0x44, displacement: code[immediate - 1] ?? 0, isWord: word };
  }
  return undefined;
}

function built(code: Uint8Array, namespace: readonly number[]): LenovoDMIKey[] {
  const found: LenovoDMIKey[] = [];
  const third = namespace.slice(8, 12);
  const tail = namespace.slice(12, 14);
  for (const at of occurrences(third, code)) {
    // The fourth store follows within a few instructions.
    let immediate: number | undefined;
    for (let index = at + 4; index < Math.min(code.length - 2, at + 40); index++) {
      if (
        code[index] === tail[0] &&
        code[index + 1] === tail[1] &&
        storeBefore(index, code) !== undefined
      ) {
        immediate = index;
        break;
      }
    }
    if (immediate === undefined) continue;
    const store = storeBefore(immediate, code);
    if (store === undefined) continue;
    if (!store.isWord) {
      if (immediate + 4 > code.length) continue;
      found.push({ namespace, type: u16(code, immediate + 2) });
    } else {
      for (const type of typesSetLater(immediate + 2, store, code)) found.push({ namespace, type });
    }
  }
  return found;
}

/**
 * The types written into the open slot after a word store — the low byte at
 * `d+2`, the high byte at `d+3`, or both at once — each one a key the driver
 * goes on to ask for. Read up to the function's end, or 1 KiB.
 */
function typesSetLater(start: number, store: FrameStore, code: Uint8Array): number[] {
  const low = (store.displacement + 2) & 0xff;
  const high = (store.displacement + 3) & 0xff;
  const prefix = store.base === 0x45 ? [0x45] : [0x44, 0x24];
  let lo = 0;
  let hi = 0;
  const types: number[] = [];
  const end = Math.min(code.length, start + 0x400);
  for (let at = start; at < end; at++) {
    // `ret` then padding: the function is over.
    if (code[at] === 0xc3 && at + 1 < end && code[at + 1] === 0xcc) break;
    // mov byte [frame+d], imm8
    if (code[at] === 0xc6 && matches(prefix, code, at + 1) && at + 2 + prefix.length < end) {
      const slot = code[at + 1 + prefix.length];
      const value = code[at + 2 + prefix.length] ?? 0;
      // The low byte is set once, to clear the slot, before the high byte names
      // each type in turn; a store to it alone is not yet a key the driver asks
      // for.
      if (slot === low) lo = value;
      if (slot === high) {
        hi = value;
        types.push((hi << 8) | lo);
      }
    }
    // mov word [frame+d+2], imm16
    if (
      code[at] === 0x66 &&
      at + 1 < end &&
      code[at + 1] === 0xc7 &&
      matches(prefix, code, at + 2) &&
      at + 3 + prefix.length + 2 <= end &&
      code[at + 2 + prefix.length] === low
    ) {
      lo = code[at + 3 + prefix.length] ?? 0;
      hi = code[at + 4 + prefix.length] ?? 0;
      types.push((hi << 8) | lo);
    }
  }
  return types;
}

function matches(bytes: readonly number[], code: Uint8Array, at: number): boolean {
  return (
    at + bytes.length <= code.length && bytes.every((byte, index) => code[at + index] === byte)
  );
}

/** Every place `pattern` starts in `code`, overlapping ones included. */
function occurrences(pattern: readonly number[], code: Uint8Array): number[] {
  const found: number[] = [];
  const first = pattern[0];
  if (first === undefined || code.length < pattern.length) return found;
  let at = code.indexOf(first);
  while (at !== -1 && at + pattern.length <= code.length) {
    if (matches(pattern, code, at)) found.push(at);
    at = code.indexOf(first, at + 1);
  }
  return found;
}
