import { describe, expect, it } from "vitest";
import { UNLOCK_TOKEN_PARTITIONS, unlockTokenFlags } from "@/firmware/me/partition/unlockToken";

/**
 * `UTFL_Header` — the Unlock Token Flags a `UTOK`/`STKN` partition may end with
 * (upstream MEA.py 2038, read at 6637/6650).
 *
 * The real-byte check is a run, not a test: on `CSME 15.bin` (UTOK @0x460000)
 * and `CSME 12.BIN` (UTOK @0x6B000) the structure decodes to Delayed
 * Authentication Mode 0 and 27 erased reserved bytes, identical to what
 * upstream's own `-unp86` prints for both ("No", 0xFF…FF). No dump is
 * committed, so the cases here are synthetic.
 */

/**
 * A partition of `size` bytes whose last 0x20 are the flags structure. `tag` is
 * what those four bytes hold, so a wrong one can be asked about.
 *
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.partition
 */
function partition(
  options: {
    readonly size?: number;
    readonly tag?: string;
    readonly delayedAuthMode?: number;
    readonly reserved?: number;
  } = {}
): Uint8Array {
  const size = options.size ?? 0x2000;
  const out = new Uint8Array(size).fill(0xab);
  const start = size - 0x20;
  const tag = options.tag ?? "UTFL";
  for (let index = 0; index < 4; index++) out[start + index] = tag.charCodeAt(index);
  out[start + 0x04] = options.delayedAuthMode ?? 0;
  out.fill(options.reserved ?? 0xff, start + 0x05, size);
  return out;
}

const flagsOf = (
  bytes: Uint8Array,
  offset: number,
  size: number,
  absoluteOffset = 0,
  name = "UTOK"
) => unlockTokenFlags({ bytes, offset, size, absoluteOffset, partition: name });

describe("the unlock token flags", () => {
  /**
   * The four facts the structure holds, and the position it holds them at: the
   * offset is the structure's own, not the partition's.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testTheFlagsAreReadFromThePartitionsLastBytes
   */
  it("are read from the partition's last bytes", () => {
    const region = partition();

    expect(flagsOf(region, 0, region.length, 0x46_0000)).toEqual({
      partition: "UTOK",
      // The partition's end minus 0x20.
      offset: 0x46_1fe0,
      delayedAuthMode: 0,
      reservedHex: "FF".repeat(0x1b),
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testTheModeByteIsKeptAsItStands
  it("keep the mode byte as it stands", () => {
    for (const value of [0, 1, 7, 0xff]) {
      const region = partition({ delayedAuthMode: value });
      expect(flagsOf(region, 0, region.length, 0, "STKN")?.delayedAuthMode).toBe(value);
    }
  });

  /**
   * The reserved bytes are hex in storage order, so a written value reads the
   * way the bytes sit — upstream prints the same bytes little-endian.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testTheReservedBytesAreHexInStorageOrder
   */
  it("report the reserved bytes in storage order", () => {
    const region = partition({ reserved: 0x00 });
    const start = region.length - 0x20;
    region[start + 0x05] = 0x12;
    region[start + 0x06] = 0x34;

    const flags = flagsOf(region, 0, region.length);

    expect(flags?.reservedHex.startsWith("1234")).toBe(true);
    expect(flags?.reservedHex.length).toBe(0x1b * 2);
  });

  /**
   * The structure is optional in the format: a token that does not end with the
   * tag has none, which is not a defect and not a row.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testAPartitionWithoutTheTagHasNoFlags
   */
  it("are nothing on a partition without the tag", () => {
    const region = partition({ tag: "XXXX" });

    expect(flagsOf(region, 0, region.length)).toBeUndefined();
  });

  /**
   * Located by the partition's end, not by searching: a `UTFL` sitting anywhere
   * else in the token is a coincidence, and reading it as the structure would
   * report flags from the middle of a signed blob.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testATagElsewhereInThePartitionIsNotTheStructure
   */
  it("ignore a tag elsewhere in the partition", () => {
    const region = new Uint8Array(0x2000).fill(0xab);
    region.set(
      Uint8Array.from("UTFL", (one) => one.charCodeAt(0)),
      0x100
    );

    expect(flagsOf(region, 0, region.length)).toBeUndefined();
  });

  /**
   * A partition shorter than the structure, or one whose declared size runs
   * past the region, is read as having none rather than off the end.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testAPartitionTooSmallOrOutOfBoundsHasNoFlags
   */
  it("are nothing on a partition too small or out of bounds", () => {
    const short = partition({ size: 0x40 }).subarray(0, 0x10);
    expect(flagsOf(short, 0, 0x10)).toBeUndefined();

    const region = partition();
    expect(flagsOf(region, 0, region.length + 0x10)).toBeUndefined();
    expect(flagsOf(region, -1, region.length)).toBeUndefined();
  });

  /**
   * The offset is read past the partition's *own* start, so a token found
   * somewhere other than at the region's head still reports the structure where
   * it really is.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testTheFlagsAreFoundAtAnOffsetIntoTheRegion
   */
  it("are found at an offset into the region", () => {
    const region = new Uint8Array(0x1000 + 0x2000);
    region.set(partition({ size: 0x2000 }), 0x1000);

    expect(flagsOf(region, 0x1000, 0x2000, 0x7_1000)?.offset).toBe(0x7_2fe0);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testTheTokenPartitionNames
  it("belong to the two names upstream treats as tokens", () => {
    expect([...UNLOCK_TOKEN_PARTITIONS]).toEqual(["UTOK", "STKN"]);
  });
});
