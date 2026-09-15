import { filledWith, find, has, tagBytes, u24 } from "@/firmware/me/bytes";
import type { FPTPartition, FPTResult } from "@/firmware/me/layout/fpt";
import type { FITVersion, FirmwareFamily, FirmwareType } from "@/firmware/me/models/firmwareFacts";

/**
 * What kind of image this is: stock, an update, or extracted.
 *
 * The families that do not sit on that axis at all — the independent firmware,
 * and anything unidentified — come back `unknown` rather than being placed on
 * it. So do the pre-CSE branches upstream defers to fixes this port does not
 * have: guessing there would put a confident word where there is no fact.
 *
 * Ported from `Packages/MEFirmware/Engine/FirmwareTypeClassifier.swift`.
 */

const KRND = tagBytes("KRND\0");

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/FirmwareTypeClassifier.swift#FirmwareTypeClassifier
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/FirmwareTypeClassifier.swift#FirmwareTypeClassifier.classify
 */
export function classifyFirmwareType(options: {
  readonly family: FirmwareFamily;
  readonly major: number;
  /** A boot descriptor table marked the image an IFWI. */
  readonly isIFWI: boolean;
  readonly fpt: FPTResult | undefined;
  readonly bytes: Uint8Array;
}): FirmwareType {
  const { family, major, isIFWI, fpt, bytes } = options;
  // An IFWI image is always extracted.
  if (isIFWI) return "extracted";
  // No region detected at all: an update.
  if (fpt === undefined) return "update";
  // The oldest server firmware is hand-built.
  if (family === "sps") return "extracted";

  if (family === "me" && major >= 2 && major <= 7) {
    return me2to7(fpt.partitions, bytes, major);
  }
  if (isCSMELike(family, major)) return csmeLike(fpt, bytes, family, major);
  // The independent families do not sit on this axis; upstream labels them
  // independent, and a "stock" here would be a claim about nothing.
  return "unknown";
}

/**
 * The family set that reaches the stock/update/extracted branch at all.
 *
 * It is also the only set whose real-FIT branch records a Flash Image Tool
 * version, so the type and that version share one predicate — which is why it
 * is a function rather than a condition written twice.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/FirmwareTypeClassifier.swift#FirmwareTypeClassifier.isCSMELike
 */
export function isCSMELike(family: FirmwareFamily, major: number): boolean {
  return (
    (family === "me" && major >= 8) ||
    family === "csme" ||
    family === "cstxe" ||
    family === "txe" ||
    family === "cssps" ||
    family === "gsc"
  );
}

/**
 * The Flash Image Tool version of a non-IFWI image — the `$FPT` header's, and
 * only where the image resolved to extracted *by* that header.
 *
 * Every other path leaves it absent: an update image's real-looking header FIT
 * is never surfaced because the update check wins before the FIT is read, and
 * the extracted-by-placeholder paths reach this branch on a header that carries
 * no FIT at all. An IFWI image's version comes from its boot descriptor instead.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Engine/FirmwareTypeClassifier.swift#FirmwareTypeClassifier.fptHeaderFIT
 */
export function fptHeaderFIT(options: {
  readonly family: FirmwareFamily;
  readonly major: number;
  readonly type: FirmwareType;
  readonly fpt: FPTResult | undefined;
  readonly isIFWI: boolean;
}): FITVersion | undefined {
  const { family, major, type, fpt, isIFWI } = options;
  if (isIFWI || fpt === undefined || type !== "extracted") return undefined;
  if (!isCSMELike(family, major)) return undefined;
  if (fpt.fitBuild === 0 || fpt.fitBuild === 0xffff) return undefined;
  return {
    major: fpt.fitMajor,
    minor: fpt.fitMinor,
    hotfix: fpt.fitHotfix,
    build: fpt.fitBuild,
  };
}

// MARK: - The pre-CSE engines

function me2to7(
  partitions: readonly FPTPartition[],
  bytes: Uint8Array,
  major: number
): FirmwareType {
  // A dirty factory-defaults partition means the image was extracted from a
  // machine that had run.
  const clean = major >= 3 ? fovdClean(partitions, "FOVD") : nvkrCleanME2(partitions, bytes);
  if (!clean) return "extracted";

  if (find(bytes, KRND, 0, bytes.length) >= 0) {
    // The branch upstream defers to a fix this port does not have.
    return major === 4 ? "unknown" : "extracted";
  }
  if (major === 2 || major === 3) return "unknown";
  return "stock";
}

// MARK: - The CSE engines

function csmeLike(
  fpt: FPTResult,
  bytes: Uint8Array,
  family: FirmwareFamily,
  major: number
): FirmwareType {
  // An update image's table lists only the update trio among its non-empty
  // partitions.
  const nonEmpty = fpt.partitions
    .filter((one) => !one.empty)
    .map((one) => one.name)
    .sort();
  if (nonEmpty.length === 3 && nonEmpty.join(",") === "FTPR,FTUP,NFTP") return "update";

  // A clean table carries no Flash Image Tool build.
  if (fpt.fitBuild === 0 || fpt.fitBuild === 0xffff) {
    // A dirty factory-defaults partition means extracted anyway.
    if (!fovdClean(fpt.partitions, "FOVD")) return "extracted";

    // A placeholder table: its own head and the window past its flags read as
    // one erased run.
    const head = erased(bytes, fpt.fptStart, 0x10);
    const tail = erased(bytes, fpt.fptStart + 0x1c, 0x14);
    if (head && tail) return "extracted";

    // The newer update images carry placeholder ROM-Bypass vectors, erased
    // where a stock image pads with zeros.
    if (family === "csme" && major >= 13 && head) return "extracted";
    return "stock";
  }

  // A real Flash Image Tool version in the header: the image was built with it.
  return "extracted";
}

/**
 * Whether the factory-defaults partition is clean: an empty row is, a non-empty
 * one is not, and a row that is not there at all is.
 */
function fovdClean(partitions: readonly FPTPartition[], name: string): boolean {
  for (const partition of partitions) {
    if (partition.name === name) return partition.empty;
  }
  return true;
}

/** The same question for the oldest engine, whose partition has its own shape. */
function nvkrCleanME2(partitions: readonly FPTPartition[], bytes: Uint8Array): boolean {
  for (const partition of partitions) {
    if (partition.name !== "NVKR") continue;
    if (partition.empty) return true;
    const base = partition.offset;
    if (!has(bytes, base, 0x1c)) return false;
    return erased(bytes, base + 0x1c, u24(bytes, base + 0x19));
  }
  return true;
}

/**
 * Whether a window is wholly erased. An empty or out-of-range window is *not*,
 * which keeps a short region from reading as a placeholder table.
 */
function erased(bytes: Uint8Array, at: number, count: number): boolean {
  return count > 0 && filledWith(bytes, at, count, 0xff);
}
