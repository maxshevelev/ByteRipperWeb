/**
 * The facts a repair bench asks of a dump it is about to write to a board, none of
 * them MEAnalyzer's: whether the image closes End of Manufacturing on its first boot,
 * what the board the dump came from has done, which Boot Guard profile the image is
 * built for, which OEM public key hash it carries, and whether it binds its SPI part
 * to the chipset.
 *
 * Ported from `Packages/MEFirmware/Models/FirmwareAnalysis.swift`, the types the window
 * `9ceb2c4..bb5e9a2` added; what each is decided from is `fileSystem/manufacturing.ts`
 * and `layout/bootGuard.ts`.
 */

/**
 * What the platform will do with End of Manufacturing — the question a bench asks of
 * a dump it is about to write to a board whose chipset is fresh: will the first boot of
 * *this image* close Manufacturing? Ours: MEAnalyzer has no such row.
 *
 * The switch is CSME 15/16's `CsePlugin:EomNvar:EOM#EomFirstBootEnabled`, which MFIT
 * writes into the image's **OEM Configuration** partition as a record of the MFS file
 * `/home/mca/eom_config`: bit 0 is the flag, bits 1–2 are `FlexibleEomSettings`. The
 * record is read from the image's own configuration first, and from the live file
 * system only when the image carries none. What the *board* has already done takes no
 * part in this verdict (`ManufacturingLock`). The engine never reads the PCH fuses
 * themselves — no dump can say what they hold.
 *
 * - `willClose`: the first boot of this image closes Manufacturing — the descriptor
 *   carries the factory rights that close it, or the flag orders it explicitly.
 * - `willNotClose`: the flag is clear and the descriptor's access rights are open — the
 *   image a bench prepares for itself.
 * - `unexpectedCombination`: the flag is set while the descriptor's BIOS master is open,
 *   which MFIT refuses to build — the image was edited outside MFIT, or predates the rule.
 * - `unknown`: the flag is clear or absent and no descriptor was read with the region.
 * - `noSwitch`: this firmware does not decide it at all — before CSME 11.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManufacturingState
 */
export type ManufacturingState =
  | "willClose"
  | "willNotClose"
  | "unexpectedCombination"
  | "unknown"
  | "noSwitch";

/**
 * What the board the dump came from has already done, out of the live file system's
 * `/home/mca/manuf_lock` — one byte written by the platform, never by a build. On every
 * factory dump at hand it reads 1, and on a board flashed an image whose first boot had
 * nothing to close it read 0 after that boot: it tracks whether the machine has closed
 * End of Manufacturing. It is *not* the image's flag.
 *
 * - `locked`: the byte reads 1 — the machine has been through End of Manufacturing.
 * - `open`: the byte reads 0.
 * - `other`: any other byte — a layout this reading does not know.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManufacturingLock
 */
export type ManufacturingLock =
  | { readonly kind: "locked" }
  | { readonly kind: "open" }
  | { readonly kind: "other"; readonly byte: number };

/**
 * What the Manufacturing row was decided from — the same idea as `MFSStateBasis`: a
 * reader must be able to tell a verdict the image states from one that only a page
 * that could not be read left standing.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManufacturingBasis
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManufacturingBasis.init
 */
export interface ManufacturingBasis {
  /**
   * The flag: **bit 0** of `/home/mca/eom_config`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManufacturingBasis.flag
   */
  readonly flag: boolean | undefined;
  /**
   * **Bits 1–2** of the same record: `FlexibleEomSettings`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManufacturingBasis.flexible
   */
  readonly flexible: number | undefined;
  /**
   * Which page `flag` and `flexible` came from: the live MFS file, or the OEM
   * Configuration partition's record for it.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManufacturingBasis.page
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManufacturingBasis.Page
   */
  readonly page: "liveMFS" | "imageConfiguration" | undefined;
  /**
   * Whether the descriptor's BIOS master is open — its read *and* write masks all ones.
   * `undefined` when no descriptor was handed to the analyser or it does not read as one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManufacturingBasis.descriptorOpen
   */
  readonly descriptorOpen: boolean | undefined;
  /**
   * Whether the live file system could be looked in at all: false when the image has an
   * MFS volume but the File IDs of its files are unknown — a missing database rather
   * than a fact about the firmware.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ManufacturingBasis.liveFilesResolved
   */
  readonly liveFilesResolved: boolean;
}

/**
 * Whether the platform binds its SPI part to the chipset — Flash Image Tool's
 * "Hardware Binding Enabled", one byte of `/home/bup/bup_sku/hw_binding`. A byte rather
 * than a yes/no, because the file can hold what the tool's class does not name.
 *
 * - `disabled`: 0x00 — the platform may take a new SPI part.
 * - `enabled`: 0x01 — the part is bound.
 * - `other`: a byte the value class `DisabledEnabledValues` does not name.
 * - `notInImage`: neither page carries the file; nothing is claimed about the binding.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#HardwareBinding
 */
export type HardwareBinding =
  | { readonly kind: "disabled" }
  | { readonly kind: "enabled" }
  | { readonly kind: "other"; readonly byte: number }
  | { readonly kind: "notInImage" };

/**
 * The OEM public key hash an image carries — the hash of the manufacturer's public key,
 * which MFIT calls `OemPublicKeyHash`. The four answers are four *findings*, not four
 * ways of saying nothing.
 *
 * - `hash`: the bytes the entry's key field holds, as uppercase hex — 32 of them on
 *   CSME 12 to 14 (a SHA-256), 48 on CSME 15 and later (a SHA-384).
 * - `allZeros`: MFIT's own "OEM signing is disabled when this hash is set to all 0s".
 * - `erased`: all `0xFF` — the area was never written, so no key was ever put there.
 * - `unrecognized`: the field holds something that is not a key, or the area has no
 *   entry where this one expects it: nothing is claimed about the image's key.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#OEMKeyHash
 */
export type OEMKeyHash =
  | { readonly kind: "hash"; readonly hex: string }
  | { readonly kind: "allZeros" }
  | { readonly kind: "erased" }
  | { readonly kind: "unrecognized" };

/**
 * The Boot Guard profile an image is built for, by the raw value MFIT, ECFinder and
 * MEInfo all print: `0` No_FVME, `3` VM (verified and measured boot), `4` FVE (firmware
 * verified), `5` FVME (both). The profile is the one the platform burns into the PCH's
 * fuses when Manufacturing closes, which is why it is worth reading *before* flashing a
 * dump.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BootGuardProfile
 */
export type BootGuardProfile = "0" | "3" | "4" | "5";

const PROFILES_BY_INDEX: readonly BootGuardProfile[] = ["0", "3", "4", "5"];

/**
 * The profile a CDMD JSON index names: MFIT writes the index into its own list of four.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BootGuardProfile.init
 */
export const bootGuardProfileOfIndex = (index: number): BootGuardProfile | undefined =>
  PROFILES_BY_INDEX[index];

/**
 * The index this profile is written as.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#BootGuardProfile.index
 */
export const bootGuardProfileIndex = (profile: BootGuardProfile): number =>
  PROFILES_BY_INDEX.indexOf(profile);
