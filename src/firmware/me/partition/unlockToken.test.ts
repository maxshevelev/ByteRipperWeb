import { describe, expect, it } from "vitest";
import {
  UNLOCK_TOKEN_FLAGS_SIZE,
  UNLOCK_TOKEN_PARTITION_NAMES,
  unlockTokenFlags,
} from "@/firmware/me/partition/unlockToken";

/**
 * `UTFL_Header` — the Unlock Token Flags a `UTOK`/`STKN` partition may end with
 * (upstream MEA.py 2038, read at 6637/6650).
 *
 * The real-byte check is a run, not a test: on `CSME 15.bin` (UTOK @0x460000)
 * and `CSME 12.BIN` (UTOK @0x6B000) the structure decodes to Delayed
 * Authentication Mode 0 and 27 erased reserved bytes, identical to what
 * upstream's own `-unp86` prints for both ("No", 0xFF…FF). No dump is committed,
 * so the cases here are synthetic.
 */

/** A partition of `size` bytes whose last 0x20 are the flags structure. */
function partition(
  options: { size?: number; tag?: string; delayedAuthMode?: number; reserved?: number } = {}
): Uint8Array {
  const { size = 0x2000, tag = "UTFL", delayedAuthMode = 0, reserved = 0xff } = options;
  const out = new Uint8Array(size).fill(0xab);
  const start = size - 0x20;
  for (let at = 0; at < 4; at++) out[start + at] = tag.charCodeAt(at);
  out[start + 0x04] = delayedAuthMode;
  out.fill(reserved, start + 0x05, size);
  return out;
}

describe("the unlock token flags", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testTheFlagsAreReadFromThePartitionsLastBytes
  it("reads the flags from the partition's last bytes", () => {
    const region = partition();
    const flags = unlockTokenFlags({
      region,
      offset: 0,
      size: region.length,
      absoluteOffset: 0x46_0000,
      partition: "UTOK",
    });
    expect(flags?.partition).toBe("UTOK");
    expect(flags?.offset).toBe(0x461_fe0);
    expect(flags?.delayedAuthMode).toBe(0);
    expect(flags?.reservedHex).toBe("FF".repeat(0x1b));
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testTheModeByteIsKeptAsItStands
  it("keeps the mode byte as it stands", () => {
    for (const value of [0, 1, 7, 0xff]) {
      const region = partition({ delayedAuthMode: value });
      const flags = unlockTokenFlags({
        region,
        offset: 0,
        size: region.length,
        absoluteOffset: 0,
        partition: "STKN",
      });
      expect(flags?.delayedAuthMode).toBe(value);
    }
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testTheReservedBytesAreHexInStorageOrder
  it("reads the reserved bytes as hex in storage order", () => {
    const region = partition({ reserved: 0x00 });
    const start = region.length - 0x20;
    region[start + 0x05] = 0x12;
    region[start + 0x06] = 0x34;
    const flags = unlockTokenFlags({
      region,
      offset: 0,
      size: region.length,
      absoluteOffset: 0,
      partition: "UTOK",
    });
    expect(flags?.reservedHex.startsWith("1234")).toBe(true);
    expect(flags?.reservedHex.length).toBe(0x1b * 2);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testAPartitionWithoutTheTagHasNoFlags
  it("has no flags for a partition without the tag", () => {
    const region = partition({ tag: "XXXX" });
    expect(
      unlockTokenFlags({
        region,
        offset: 0,
        size: region.length,
        absoluteOffset: 0,
        partition: "UTOK",
      })
    ).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testATagElsewhereInThePartitionIsNotTheStructure
  it("is not the structure when the tag sits elsewhere", () => {
    const region = new Uint8Array(0x2000).fill(0xab);
    region.set(
      Uint8Array.from("UTFL", (one) => one.charCodeAt(0)),
      0x100
    );
    expect(
      unlockTokenFlags({
        region,
        offset: 0,
        size: region.length,
        absoluteOffset: 0,
        partition: "UTOK",
      })
    ).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testAPartitionTooSmallOrOutOfBoundsHasNoFlags
  it("has no flags for a partition too small or out of bounds", () => {
    const short = partition({ size: 0x40 }).subarray(0, 0x10);
    expect(
      unlockTokenFlags({
        region: short,
        offset: 0,
        size: 0x10,
        absoluteOffset: 0,
        partition: "UTOK",
      })
    ).toBeUndefined();
    const region = partition();
    expect(
      unlockTokenFlags({
        region,
        offset: 0,
        size: region.length + 0x10,
        absoluteOffset: 0,
        partition: "UTOK",
      })
    ).toBeUndefined();
    expect(
      unlockTokenFlags({
        region,
        offset: -1,
        size: region.length,
        absoluteOffset: 0,
        partition: "UTOK",
      })
    ).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testTheFlagsAreFoundAtAnOffsetIntoTheRegion
  it("finds the flags at an offset into the region", () => {
    const region = new Uint8Array(0x1000 + 0x2000);
    region.set(partition({ size: 0x2000 }), 0x1000);
    const flags = unlockTokenFlags({
      region,
      offset: 0x1000,
      size: 0x2000,
      absoluteOffset: 0x7_1000,
      partition: "UTOK",
    });
    expect(flags?.offset).toBe(0x7_2fe0);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UnlockTokenTests.swift#UnlockTokenTests.testTheTokenPartitionNames
  it("names the two token partitions", () => {
    expect(UNLOCK_TOKEN_PARTITION_NAMES).toEqual(["UTOK", "STKN"]);
    expect(UNLOCK_TOKEN_FLAGS_SIZE).toBe(0x20);
  });
});
