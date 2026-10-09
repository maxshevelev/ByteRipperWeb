import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import { AgentToolError } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import { type FITProblem, fitProblemMessage, fitSeverity } from "@/firmware/fit/fitProblem";
import type { FITReport, FITRow } from "@/firmware/fit/fitTable";
import {
  microcodeCpuid,
  microcodeDate,
  microcodeProcessorPlatforms,
} from "@/firmware/uefi/microcodeParser";
import { detailFor, type FITDisplayRow, fitDisplay } from "@/tools/fit/fitDisplay";
import type { FITEditOutcome, FITRemovalOutcome } from "@/tools/fit/fitEditor";
import {
  entryRevision,
  filterCatalogue,
  latestOf,
  type MicrocodeCatalogueEntry,
  platformText,
} from "@/tools/fit/microcodeCatalogue";

/**
 * What the FIT panel answers an agent from the bytes alone, with the panel open or not
 * (`Design/PORT_AGENT.md`): the table with its rows and its problems, one row in full, and the
 * microcode catalogue set against the image.
 *
 * Read the way the panel reads it and put in the panel's own words (`fitDisplay`), so what the
 * agent says about a row is what the person sees on it. The caller runs these under the English
 * override.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentQueries.swift#FITAgentQueries
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode
 */

const hex = (value: number): string => `0x${value.toString(16).toUpperCase()}`;
const hex2 = (value: number): string => `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;

// MARK: - fit_table

export const FIT_TABLE = {
  name: "fit_table",
  title: "FIT table",
  description:
    "The Firmware Interface Table as the FIT panel reads it: where the pointer at the top of the " +
    "image leads, the table's place and checksum, and its rows — type, address, size, version and " +
    "what the row points at (a microcode with its CPUID, revision and date; a region the tree " +
    "names). `problems` are the specification's rules the table breaks, each with its row and " +
    "address. The Top Swap backup's copy of the table follows under `backup` when the image keeps " +
    "one. With `entry` (the row's place, 0 is the header) that row's every field as well. Whether " +
    "a newer microcode exists is the panel's to say, not this answer's.",
  properties: {
    entry: AgentSchema.integer("A row's place in the table, 0 for the header: its fields in full."),
  },
} as const;

/** @upstream Modules/FITTool/Sources/FITTool/FITAgentQueries.swift#FITAgentQueries.table */
export function fitTableAnswer(report: FITReport, args: AgentArguments): Json {
  const entry = args.has("entry") ? args.integer("entry") : undefined;
  const display = fitDisplay(report);
  const answer: { [key: string]: Json } = {
    summary: display.summary,
    problems: report.problems.map(problemJson),
  };
  if (report.addressDiffIsAssumed) {
    answer.address_mapping = "assumed: no Volume Top File, so the image is taken to end at 4 GiB";
  }
  const table = report.table;
  if (table !== undefined) {
    answer.table = {
      start: hex(table.range.start),
      end: hex(table.range.end),
      pointer_at: hex(table.pointerOffset),
      pointer: hex(table.pointerAddress),
      checksum: hex2(table.storedChecksum),
      checksum_should_be: hex2(table.computedChecksum),
      checksum_checked: table.checksumIsChecked,
    };
  } else if (report.candidates.length > 0) {
    answer.tables_found_elsewhere = report.candidates.map(hex);
  }
  const main = display.rows.filter((row) => !row.isBackup);
  const backup = display.rows.filter((row) => row.isBackup);
  answer.rows = main.map(rowJson);
  if (backup.length > 0) {
    answer.backup = { heading: display.backupHeading ?? "", rows: backup.map(rowJson) };
  }
  if (entry !== undefined) {
    const chosen = main.find((row) => row.index === entry);
    if (chosen === undefined) {
      throw new AgentToolError(
        `The table has no row ${entry}; its rows are 0 to ${Math.max(0, main.length - 1)}.`
      );
    }
    const detail = detailFor(chosen, report.problems);
    answer.entry = {
      title: detail.title,
      fields: detail.fields.map((field): Json => {
        const members: { [key: string]: Json } = { label: field.label, value: field.value };
        if (field.isProblem) members.problem = true;
        return members;
      }),
    };
  }
  return answer;
}

function rowJson(row: FITDisplayRow): Json {
  const members: { [key: string]: Json } = {
    index: row.index,
    type: row.typeText,
    address: row.addressText,
    size: row.sizeText,
    version: row.versionText,
    row_start: hex(row.rowRange.start),
  };
  if (row.targetText !== "") members.points_at = row.targetText;
  if (row.targetRange !== undefined) {
    members.target_start = hex(row.targetRange.start);
    members.target_end = hex(row.targetRange.end);
  }
  if (row.cpuids.length > 0) {
    members.cpuids = row.cpuids.map((one) => one.toString(16).toUpperCase());
  }
  if (row.hasProblem) members.problem = true;
  return members;
}

function problemJson(problem: FITProblem): Json {
  const members: { [key: string]: Json } = {
    message: fitProblemMessage(problem),
    severity: fitSeverity(problem.detail) === "error" ? "error" : "warning",
  };
  if (problem.entryIndex !== undefined) members.entry = problem.entryIndex;
  if (problem.offset !== undefined) members.offset = hex(problem.offset);
  if (problem.inBackup === true) members.in_backup = true;
  return members;
}

// MARK: - microcode_catalogue

export const MICROCODE_CATALOGUE = {
  name: "microcode_catalogue",
  title: "Microcode catalogue",
  description:
    "The Intel microcode the online collection at github.com/platomav/CPUMicrocodes holds — the " +
    "catalogue the FIT panel's Add Microcode lists — read from the file names, so nothing is " +
    "downloaded. Each file: `path` (pass it to `fit_add_microcode` or `fit_replace_microcode`), " +
    "CPUID, platform mask, revision, date, `production` (false for a pre-release), size. One update " +
    "with an extended signature table is filed once under each processor it serves. With " +
    "`in_image`, only files for processors the image's FIT microcodes serve — their extended " +
    "tables' included — and `installed` says each microcode row's processors and platforms, its " +
    "revision and how it stands against the catalogue (`latest`, `outdated` with the newest " +
    "revision, `undecided` where a newer file's platform mask only partly meets the installed " +
    "one's, so the board's own platform decides, `not_rated`); a file then says which rows it " +
    "`serves_rows` and whether it is `newer_than_installed`. `cpuid` narrows by the CPUID's " +
    "first digits. Pages: `limit` is a ceiling — a page also stops before the answer passes the " +
    'size bound and says `truncated: "size"`; pass `next` back as `after` until it is null.',
  properties: {
    cpuid: AgentSchema.string('Only files whose CPUID starts with this, e.g. "906E".'),
    in_image: AgentSchema.boolean(
      "Only files for processors the image's microcodes serve, and how each row stands. Default false."
    ),
    production_only: AgentSchema.boolean("Leave out pre-release files. Default false."),
    latest_only: AgentSchema.boolean(
      "Only the newest revision for each CPUID and platform mask. Default false."
    ),
    limit: AgentSchema.limit(50, 300),
    after: AgentSchema.after,
  },
} as const;

/**
 * `microcode_catalogue`'s answer over `all`, the catalogue as listed. `report` is the image's FIT
 * read, for `in_image`.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.catalogue
 */
export function catalogueAnswer(
  all: readonly MicrocodeCatalogueEntry[],
  report: FITReport | undefined,
  contentVersion: number,
  args: AgentArguments
): Json {
  const cpuid = args.optionalString("cpuid")?.toUpperCase().replace("0X", "");
  const inImage = args.bool("in_image", false);
  const productionOnly = args.bool("production_only", false);
  const latestOnly = args.bool("latest_only", false);
  const limit = args.limit(50, 300);

  const envelope: { [key: string]: Json } = {};
  let installed: FITRow[] = [];
  let served: Set<number> | undefined;
  if (inImage) {
    const table = report?.table;
    if (table === undefined) {
      throw new AgentToolError("There is no FIT table here; `fit_table` says what was found.");
    }
    installed = table.rows.filter((row) => row.target.kind === "microcode");
    served = new Set(
      installed.flatMap((row) =>
        row.target.kind === "microcode"
          ? microcodeProcessorPlatforms(row.target.header).map((pair) => pair.signature)
          : []
      )
    );
    envelope.installed = installedRows(installed, all);
  }
  const chosen = chosenEntries(all, cpuid, served, productionOnly, latestOnly);
  envelope.total = chosen.length;
  const paging = new AgentPage(
    args,
    AgentPage.fingerprint([
      all.length,
      all[0]?.path ?? null,
      contentVersion,
      cpuid ?? null,
      inImage,
      productionOnly,
      latestOnly,
    ]),
    "The catalogue or the image changed since that page; ask again without `after`."
  );
  const items = chosen
    .slice(paging.first, paging.first + limit)
    .map((one) => entryJson(one, installed));
  return paging.answer(envelope, "files", items, chosen.length, args.answerBound);
}

/**
 * The image's microcode rows, each with the processors its update serves — its extended signature
 * table's included — and how it stands against the catalogue.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.installed
 */
function installedRows(
  rows: readonly FITRow[],
  catalogue: readonly MicrocodeCatalogueEntry[]
): Json[] {
  return rows.flatMap((row): Json[] => {
    if (row.target.kind !== "microcode") return [];
    const header = row.target.header;
    const members: { [key: string]: Json } = {
      entry: row.entry.index,
      cpuids: microcodeProcessorPlatforms(header).map((pair) => ({
        cpuid: microcodeCpuid(pair.signature),
        platforms: hex2(pair.platformIDs),
      })),
      revision: `0x${header.updateRevision.toString(16).toUpperCase()}`,
      date: microcodeDate(header),
    };
    const rating = latestOf(header, catalogue);
    switch (rating.kind) {
      case "latest":
        members.catalogue = "latest";
        break;
      case "outdated":
        members.catalogue = "outdated";
        members.newest_revision = `0x${rating.newestRevision.toString(16).toUpperCase()}`;
        break;
      case "undecided":
        members.catalogue = "undecided";
        members.newest_revision = `0x${rating.newestRevision.toString(16).toUpperCase()}`;
        break;
      case "notRated":
        members.catalogue = "not_rated";
        break;
    }
    return [members];
  });
}

/**
 * A catalogue file, and — when the image is given — the rows whose update serves the same processor
 * on a platform the file's mask meets.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.entry
 */
function entryJson(entry: MicrocodeCatalogueEntry, installed: readonly FITRow[]): Json {
  const members: { [key: string]: Json } = {
    path: entry.path,
    cpuid: entry.cpuidText,
    platforms: `0x${platformText(entry)}`,
    revision: `0x${entry.revisionText}`,
    date: entry.date,
    production: entry.isProduction,
    size: hex(entry.size),
  };
  const rows = installed.filter((row) => {
    if (row.target.kind !== "microcode" || entry.cpuid === undefined) return false;
    const mask = entry.platformID ?? 0;
    return microcodeProcessorPlatforms(row.target.header).some(
      (pair) =>
        pair.signature === entry.cpuid &&
        (mask === 0 || pair.platformIDs === 0 || (pair.platformIDs & mask) !== 0)
    );
  });
  if (rows.length > 0) {
    members.serves_rows = rows.map((row) => row.entry.index);
    const revision = entryRevision(entry);
    if (revision !== undefined) {
      const revisions = rows.flatMap((row) =>
        row.target.kind === "microcode" ? [row.target.header.updateRevision] : []
      );
      members.newer_than_installed = revisions.every((one) => revision > one);
    }
  }
  return members;
}

/**
 * The Intel files to list: those whose CPUID starts with `cpuid`, only those for a processor the
 * image's microcodes serve when `inImage`, and only the newest revision for each processor and
 * platform mask when `latestOnly` — sorted by CPUID, then platform mask, newest first.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.chosen
 */
export function chosenEntries(
  catalogue: readonly MicrocodeCatalogueEntry[],
  cpuid: string | undefined,
  served: ReadonlySet<number> | undefined,
  productionOnly: boolean,
  latestOnly: boolean
): MicrocodeCatalogueEntry[] {
  let entries = filterCatalogue(catalogue, {
    vendor: "Intel",
    search: cpuid ?? "",
    cpuidsInTheImage: served,
  });
  if (productionOnly) entries = entries.filter((one) => one.isProduction);
  entries = [...entries].sort((one, two) => {
    if (one.cpuid !== two.cpuid) return (one.cpuid ?? 0) - (two.cpuid ?? 0);
    if (one.platformID !== two.platformID) return (one.platformID ?? 0) - (two.platformID ?? 0);
    return (entryRevision(two) ?? 0) - (entryRevision(one) ?? 0);
  });
  if (!latestOnly) return entries;
  const seen = new Set<string>();
  return entries.filter((one) => {
    const key = `${one.cpuidText}/${platformText(one)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// MARK: - What a change says

/**
 * What a change says beside its writes: where the component went, what it replaced, how many
 * behind it moved, whether it was checked against the protected ranges and the Top Swap backup it
 * was made in as well.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.report
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.caveats
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.range
 */
export function editReport(outcome: FITEditOutcome | FITRemovalOutcome): { [key: string]: Json } {
  const span = (range: { start: number; end: number }): Json => ({
    start: hex(range.start),
    end: hex(range.end),
  });
  const members: { [key: string]: Json } = {};
  if ("range" in outcome) {
    members.change = outcome.kind === "added" ? "added" : "replaced";
    members.entry = outcome.entryIndex;
    members.component = span(outcome.range);
    members.moved = outcome.moved;
    if (outcome.replaced !== undefined) {
      members.replaced = {
        cpuid: microcodeCpuid(outcome.replaced.processorSignature),
        revision: `0x${outcome.replaced.updateRevision.toString(16).toUpperCase()}`,
        date: microcodeDate(outcome.replaced),
      };
    }
  } else {
    members.change = "removed";
    members.entry = outcome.entryIndex;
    members.moved = outcome.moved;
    if (outcome.erased !== undefined) members.erased = span(outcome.erased);
  }
  const warnings = outcome.protectionWarnings;
  members.protected_ranges =
    warnings === undefined
      ? "not checked: the image's protected ranges could not be read"
      : warnings.length === 0
        ? "nothing written inside a Boot Guard or vendor protected range"
        : [...warnings];
  if (outcome.topSwapBackup !== undefined) members.top_swap_backup = span(outcome.topSwapBackup);
  return members;
}
