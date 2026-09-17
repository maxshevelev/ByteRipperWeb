import { FIT } from "@/firmware/fit/fitEntry";
import { type FITProblem, fitProblemMessage, fitSeverity } from "@/firmware/fit/fitProblem";
import type { FITDisplayRow } from "@/tools/fit/fitDisplay";
import type { MicrocodeLatest } from "@/tools/fit/microcodeCatalogue";
import {
  type RowProtection,
  type RowRole,
  type ToolRowMark,
  type ToolRowMarks,
  worstProblem,
} from "@/tools/toolRowMarks";

/**
 * What a row of the FIT table wears besides its text (`Design/ROW_MARKS.md`
 * §5.2), decided here so it is tested without a window — in the icons and
 * colours of the one catalogue every firmware panel draws from, so a red
 * octagon here means what it means in the UEFI tree.
 *
 * Two slots in the Type column: the verdict — how the microcode stands against
 * the catalogue — and, after it, the problem: what the validator found wrong
 * with the row, and a microcode image whose own checksum does not add up. A row
 * can wear both: a microcode that is not the newest *and* is broken.
 *
 * A FIT row has no rail: a table row is not inside a container the way a tree
 * row is.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks
 */
export const FIT_ROW_MARKS = {
  /**
   * Every mark this table draws — what its legend lists.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.legendMarks
   */
  legendMarks: [
    "protectedIBB",
    "protectedFirmware",
    "newest",
    "newerListed",
    "newerMaybe",
    "error",
    "caution",
    "holdsChecks",
    "partlyProtected",
  ] as readonly ToolRowMark[],
} as const;

/**
 * The words on the badge of a row whose component holds what the IBB is checked
 * against — the Boot Guard Key Manifest and Boot Policy — nothing for every
 * other row.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.holdsChecks
 */
export function holdsChecks(type: number): string | undefined {
  switch (type) {
    case FIT.keyManifestType:
      return "Holds the Boot Guard Key Manifest: the key the Boot Policy is signed with";
    case FIT.bootPolicyType:
      return "Holds the Boot Guard Boot Policy: the IBB segments and the hash they are checked against";
    default:
      return undefined;
  }
}

/**
 * The row's marks, from its own problems in `problems` and what it points at.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.marks
 */
export function fitRowMarks(row: FITDisplayRow, problems: readonly FITProblem[]): ToolRowMarks {
  const errors: string[] = [];
  const cautions: string[] = [];
  for (const problem of problems) {
    // A row wears its own copy's problems: the backup's rows the backup's.
    if (problem.entryIndex !== row.index) continue;
    if ((problem.inBackup === true) !== row.isBackup) continue;
    if (fitSeverity(problem.detail) === "error") errors.push(fitProblemMessage(problem));
    else cautions.push(fitProblemMessage(problem));
  }

  const target = row.model.target;
  if (target.kind === "microcode" && !target.header.checksumIsCorrect) {
    const computed = target.header.computedChecksum;
    if (computed !== undefined) {
      errors.push(
        `Invalid microcode image checksum: ${hex(target.header.checksum)}, ` +
          `should be ${hex(computed)}`
      );
    } else {
      cautions.push("The microcode image cannot be read whole, so its checksum is not checked");
    }
  }

  const roles: RowRole[] = [];
  const holds = holdsChecks(row.model.entry.type);
  if (holds !== undefined) roles.push({ kind: "holdsChecks", words: holds });

  // The background by the same rule as the UEFI tree's: wholly inside the IBB,
  // wholly inside what the firmware checks, or — for bytes only partly covered
  // — no tint and the badge.
  let protection: RowProtection | undefined;
  if (row.protection === "ibb") protection = "ibb";
  else if (row.protection === "protected") protection = "firmware";
  else if (row.protection === "partial") roles.push({ kind: "partlyProtected" });

  return {
    ...(protection === undefined ? {} : { protection }),
    problem: worstProblem(errors, cautions),
    roles,
  };
}

/**
 * The verdict a row's "latest" state is drawn as, and what the pointer reads on
 * it — nothing where there is no basis for one.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.verdict
 */
export function verdict(
  state: MicrocodeLatest
): { readonly mark: ToolRowMark; readonly toolTip: string } | undefined {
  switch (state.kind) {
    case "latest":
      return {
        mark: "newest",
        toolTip: "Newest revision the catalogue lists for this processor and platform.",
      };
    case "outdated":
      return {
        mark: "newerListed",
        toolTip: `Catalogue lists a newer revision (r.${revision(state.newestRevision)})`,
      };
    case "undecided":
      return {
        mark: "newerMaybe",
        toolTip:
          `Catalogue lists a newer revision (r.${revision(state.newestRevision)}) ` +
          "whose platforms only partly overlap this one's — whether it serves this " +
          "board depends on the board's own platform ID, which the image does not carry",
      };
    case "notRated":
      return undefined;
  }
}

/** @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.revision */
const revision = (value: number): string => value.toString(16).toUpperCase();

/** @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.hex */
function hex(value: number): string {
  const digits = value.toString(16).toUpperCase();
  return `0x${"0".repeat(Math.max(0, 8 - digits.length))}${digits}`;
}
