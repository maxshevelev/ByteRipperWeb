import { hex, sameBytes, sha1, sha256, sha384 } from "@/firmware/me/crypto/digest";

/**
 * RSA signature validation for CSE manifests.
 *
 * A faithful port of upstream `rsa_sig_val` and the SSA-PSS chain it calls. The
 * manifest is signed with textbook RSA over a protected-data window: the first
 * 0x80 bytes of the struct plus everything from the header's end to the
 * manifest's end. The decrypted signature's low bytes are compared to that
 * window's digest — SHA-1 for `$MAN` at 2048 bits, SHA-256 for `$MN2` at 2048
 * (PKCS #1 v1.5 DigestInfo), and SHA-384 EMSA-PSS for 3072 bits and for
 * anything unrecognised.
 *
 * Where upstream's `BigInt` is four hundred lines of Montgomery multiplication —
 * Swift has no arbitrary-precision integer, so it had to be written — this uses
 * the language's own `bigint`, as the plan directs. Square-and-multiply over a
 * native type is the whole of the arithmetic, and the four hundred lines it
 * replaces were four hundred lines of places to be subtly wrong.
 *
 * Ported from `Packages/MEFirmware/Crypto/RSA.swift`.
 */

/** `0xBC` — the EMSA-PSS trailer byte. */
const PSS_TRAILER = 0xbc;
/** The eight-byte zero prefix in the PSS encoded message. */
const SALT_PADDING = 8;

/**
 * What a check came to.
 *
 * `embeddedHash` is the digest read out of the decrypted signature and
 * `dataHash` the digest recomputed over the protected data — both absent when
 * that branch never produced one, as a PSS signature with bad padding does not.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Crypto/RSA.swift#RSA.Outcome
 */
export interface RSAOutcome {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Crypto/RSA.swift#RSA.Outcome.valid */
  readonly valid: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Crypto/RSA.swift#RSA.Outcome.embeddedHash */
  readonly embeddedHash: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Crypto/RSA.swift#RSA.Outcome.dataHash */
  readonly dataHash: string | undefined;
}

/**
 * All three inputs zero. Upstream calls this "Valid/Empty RSA block": a
 * manifest with no signature in it is not a manifest with a bad one.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Crypto/RSA.swift#RSA.Outcome.emptyRSA
 */
export const EMPTY_RSA: RSAOutcome = { valid: true, embeddedHash: undefined, dataHash: undefined };

/**
 * Validates one manifest's RSA signature.
 *
 * Nothing only when the signature cannot be checked at all — a degenerate
 * modulus, which is not an RSA modulus and which upstream would crash on. That
 * is "not checkable", and a panel must say so rather than show a verdict.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Crypto/RSA.swift#RSA
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Crypto/RSA.swift#RSA.validate
 */
export function validateSignature(options: {
  /** `$MN2` or `$MAN`. */
  readonly tag: string;
  /** The raw `RSAPublicKey` modulus bytes, little-endian, key-length wide. */
  readonly publicKey: Uint8Array;
  readonly exponent: number;
  /** The raw `RSASignature` bytes, little-endian, the same length as the key. */
  readonly signature: Uint8Array;
  /** `buffer[base:base+0x80] + buffer[base+headerEnd:base+size]`. */
  readonly protectedData: Uint8Array;
}): RSAOutcome | undefined {
  const keyLength = options.publicKey.length;
  if (keyLength === 0 || options.signature.length < keyLength) return undefined;

  const modulus = littleEndianValue(options.publicKey);
  const signatureIsZero = options.signature.every((byte) => byte === 0);
  if (modulus === 0n && options.exponent === 0 && signatureIsZero) return EMPTY_RSA;
  // An even or zero modulus cannot be exponentiated into. Not a verdict.
  if (modulus === 0n || (modulus & 1n) === 0n) return undefined;

  const decrypted = bigEndianBytes(
    powerMod(littleEndianValue(options.signature), BigInt(options.exponent), modulus),
    keyLength
  );

  if (options.tag === "$MAN" && keyLength === 0x100) {
    // SHA-1: the low 160 bits of the decrypted signature.
    return compareEmbedded(0x14, decrypted, sha1(options.protectedData));
  }
  if (options.tag === "$MN2" && keyLength === 0x100) {
    // SHA-256 as PKCS #1 v1.5 DigestInfo: the low 256 bits.
    return compareEmbedded(0x20, decrypted, sha256(options.protectedData));
  }
  // 3072-bit, and everything unrecognised, uses SHA-384 EMSA-PSS.
  return pssCheck(decrypted, options.protectedData, keyLength);
}

/**
 * `base^exponent mod modulus`, square-and-multiply over the language's own type.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Crypto/RSA.swift#BigInt
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Crypto/RSA.swift#BigInt.powerMod
 * @upstream-differs JavaScript's bigint does the limb arithmetic upstream writes out as Montgomery multiplication
 */
export function powerMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus <= 1n) return 0n;
  let result = 1n;
  let value = base % modulus;
  let remaining = exponent;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    remaining >>= 1n;
  }
  return result;
}

/**
 * The bytes read as one little-endian value — the `int.from_bytes(…, 'little')` upstream uses.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Crypto/RSA.swift#BigInt.limbs
 */
export function littleEndianValue(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index--) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0);
  }
  return value;
}

/**
 * `value` as big-endian bytes, zero-padded to the width of an RSA modulus.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Crypto/RSA.swift#BigInt.bigEndianBytes
 */
export function bigEndianBytes(value: bigint, byteCount: number): Uint8Array {
  const out = new Uint8Array(byteCount);
  let remaining = value;
  for (let index = byteCount - 1; index >= 0 && remaining > 0n; index--) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

// MARK: - The PKCS #1 v1.5 half

/**
 * The low `suffixLength` bytes of the decrypted signature — the plain digest —
 * against the digest recomputed over the protected data.
 */
function compareEmbedded(
  suffixLength: number,
  decrypted: Uint8Array,
  dataHash: Uint8Array
): RSAOutcome {
  if (decrypted.length < suffixLength) {
    return { valid: false, embeddedHash: undefined, dataHash: undefined };
  }
  const embedded = decrypted.subarray(decrypted.length - suffixLength);
  return {
    valid: sameBytes(embedded, dataHash),
    embeddedHash: hex(embedded),
    dataHash: hex(dataHash),
  };
}

// MARK: - EMSA-PSS

/**
 * The digest embedded in the signature, checked against the digest recomputed
 * over the message and the salt the signature carries.
 */
function pssCheck(decrypted: Uint8Array, message: Uint8Array, modulusBytes: number): RSAOutcome {
  const digestSize = 48; // SHA-384
  const bad: RSAOutcome = { valid: false, embeddedHash: undefined, dataHash: undefined };

  // The trailer must be 0xBC, and the digest sits just before it.
  if (decrypted.length <= digestSize + 1 || decrypted.at(-1) !== PSS_TRAILER) return bad;
  const embedded = decrypted.subarray(decrypted.length - digestSize - 1, decrypted.length - 1);
  const maskedDB = decrypted.subarray(0, decrypted.length - digestSize - 1);

  const mask = pssMask(embedded, maskedDB.length, digestSize);
  const unmasked = new Uint8Array(maskedDB.length);
  for (let index = 0; index < maskedDB.length; index++) {
    unmasked[index] = (maskedDB[index] ?? 0) ^ (mask[index] ?? 0);
  }

  const salt = pssSalt(unmasked, modulusBytes);
  if (salt === undefined) return bad;

  // SHA-384 over eight zero bytes, the message's digest, and the salt.
  const encoded = new Uint8Array(SALT_PADDING + digestSize + salt.length);
  encoded.set(sha384(message), SALT_PADDING);
  encoded.set(salt, SALT_PADDING + digestSize);
  const recomputed = sha384(encoded);

  return {
    valid: sameBytes(embedded, recomputed),
    embeddedHash: hex(embedded),
    dataHash: hex(recomputed),
  };
}

/** The mask-generating function: `hash(seed ‖ counter)` blocks, concatenated. */
function pssMask(seed: Uint8Array, maskLength: number, digestSize: number): Uint8Array {
  const blocks = Math.ceil(maskLength / digestSize);
  const mask = new Uint8Array(blocks * digestSize);
  const block = new Uint8Array(seed.length + 4);
  block.set(seed);
  const counter = new DataView(block.buffer, seed.length, 4);
  for (let index = 0; index < blocks; index++) {
    counter.setUint32(0, index, false);
    mask.set(sha384(block), index * digestSize);
  }
  return mask;
}

/**
 * The salt, after the leading zero bits and the `00…01` padding of the unmasked
 * data block check out. Nothing when they do not, which is a signature that
 * cannot be what it claims.
 */
function pssSalt(unmaskedDB: Uint8Array, modulusBytes: number): Uint8Array | undefined {
  const first = unmaskedDB[0];
  if (first === undefined) return undefined;
  const leadingZeroBits = 8 - ((modulusBytes - 1) % 8);
  let firstByte = first;
  for (let index = 0; index < leadingZeroBits; index++) firstByte &= ~(0x80 >> index);
  if (firstByte !== 0) return undefined;

  const separator = unmaskedDB.indexOf(0x01);
  if (separator < 0) return undefined;
  for (let index = 1; index < separator; index++) {
    if (unmaskedDB[index] !== 0x00) return undefined;
  }
  return unmaskedDB.subarray(separator + 1);
}
