import type {
  ManufacturingBasis,
  ManufacturingLock,
  ManufacturingState,
} from "@/firmware/me/models/manufacturingFacts";

/**
 * Whether an image closes Manufacturing on the first boot of a board, and what says
 * so.
 *
 * **Two mechanisms, and the descriptor's is the one that is usually at work.**
 *
 *   * The **access rights in the flash descriptor** are what a manufacturer normally
 *     relies on. A serial image leaves the host CPU / BIOS master with the factory
 *     rights (`0x00F` / `0x00A`, not the `0xFFF` / `0xFFF` of a service image that lets
 *     the host rewrite the whole flash), and the platform closes Manufacturing on its
 *     first boot.
 *   * The **`CsePlugin:EomNvar` flag** — bit 0 of the MFS file `/home/mca/eom_config` —
 *     is an explicit order on top of that, which only MFIT sets. It appears in the
 *     **OEM Configuration** partition (`FITC`), the record the build wrote, and in the
 *     **MFS volume's own files**, the only copy in a region handed over without its OEM
 *     Configuration partition. The image's page decides; the file system's is the
 *     fallback. Bits 1–2 of the record are `FlexibleEomSettings`.
 *
 * So a flag reading **0 does not mean Manufacturing stays open**: the descriptor
 * answers then, and the one case where nothing closes Manufacturing is the flag clear
 * *and* the descriptor open. The flag set with the descriptor open is the combination
 * MFIT refuses to build. What the *board* has already done takes no part in the
 * verdict (`ManufacturingLock`).
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/Manufacturing.swift#ManufacturingDecoder
 */

/**
 * The `FTBL` keys that name the records this switch is about (`FileTable.dat`'s own
 * IDs). A record with another ID is some other setting and is ignored.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/Manufacturing.swift#ManufacturingDecoder.FileID
 */
export const ManufacturingFileID = {
  /**
   * `/home/mca/eom_config` — 2 bytes, the setting.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/Manufacturing.swift#ManufacturingDecoder.FileID.eomConfig
   */
  eomConfig: 0x1001_ee00,
  /**
   * `/home/mca/eom` — 1 byte, the board's own record that Manufacturing has been
   * closed. Read only to tell that the file system was read at all.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/Manufacturing.swift#ManufacturingDecoder.FileID.eom
   */
  eom: 0x1002_0000,
  /**
   * `/home/mca/manuf_lock` — 1 byte, the platform's record that it has been through End
   * of Manufacturing.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/Manufacturing.swift#ManufacturingDecoder.FileID.manufLock
   */
  manufLock: 0x1002_0100,
} as const;

/**
 * What the pages said, as the analyzer read them out of the image.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/Manufacturing.swift#ManufacturingDecoder.Inputs
 */
export interface ManufacturingInputs {
  /**
   * The **image configuration** record for `/home/mca/eom_config` — what the build wrote
   * and the platform applies at EOM.
   */
  readonly imageEOMConfig?: number | undefined;
  /** The live `/home/mca/eom_config` record of the MFS volume. */
  readonly liveEOMConfig?: number | undefined;
  /** Whether the descriptor's BIOS master is open; `undefined` with no descriptor. */
  readonly descriptorOpen?: boolean | undefined;
  /** Whether this generation decides End of Manufacturing at all: CSME 11 and later. */
  readonly hasSwitch: boolean;
  /** Whether the live file system could be looked in (its File IDs were resolved). */
  readonly liveFilesResolved: boolean;
}

/**
 * The board's own record (`/home/mca/manuf_lock`): 1 locked, 0 open, any other byte one
 * this reading does not know.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/Manufacturing.swift#ManufacturingDecoder.lock
 */
export function manufacturingLock(byte: number): ManufacturingLock {
  if (byte === 0) return { kind: "open" };
  if (byte === 1) return { kind: "locked" };
  return { kind: "other", byte: byte & 0xff };
}

/**
 * The verdict and what it was decided from.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/Manufacturing.swift#ManufacturingDecoder.decide
 */
export function decideManufacturing(inputs: ManufacturingInputs): {
  readonly state: ManufacturingState;
  readonly basis: ManufacturingBasis;
} {
  // The flag: the image's own record first (the page the platform applies at End of
  // Manufacturing), the live one as the fallback for a region handed over without its
  // OEM Configuration.
  const flagWord = inputs.imageEOMConfig ?? inputs.liveEOMConfig;
  const basis: ManufacturingBasis = {
    flag: flagWord === undefined ? undefined : (flagWord & 1) !== 0,
    flexible: flagWord === undefined ? undefined : (flagWord >> 1) & 0x3,
    page:
      flagWord === undefined
        ? undefined
        : inputs.imageEOMConfig !== undefined
          ? "imageConfiguration"
          : "liveMFS",
    descriptorOpen: inputs.descriptorOpen,
    liveFilesResolved: inputs.liveFilesResolved,
  };
  // No End of Manufacturing machinery in this firmware.
  if (!inputs.hasSwitch) return { state: "noSwitch", basis };
  // The flag set is an explicit order, MFIT's own: it closes Manufacturing whatever the
  // descriptor says, which is why the pair with an open descriptor is a combination MFIT
  // refuses to build.
  if (basis.flag === true) {
    return {
      state: inputs.descriptorOpen === true ? "unexpectedCombination" : "willClose",
      basis,
    };
  }
  // The flag is clear, or the image carries no such record at all — a serial image that
  // relies on its descriptor rights. Open rights are the one state in which nothing
  // closes Manufacturing, and an unreadable descriptor leaves the question open.
  switch (inputs.descriptorOpen) {
    case false:
      return { state: "willClose", basis };
    case true:
      return { state: "willNotClose", basis };
    default:
      return { state: "unknown", basis };
  }
}
