import type { AgentArguments } from "@/core/agent/agentArguments";
import { AgentToolError, jsonAnswer } from "@/core/agent/agentTool";
import { LocalizedText, withEnglish } from "@/core/localization/localization";
import type { FITReport } from "@/firmware/fit/fitTable";
import { microcodeCpuid } from "@/firmware/uefi/microcodeParser";
import { readyFirmware } from "@/state/firmwareReady";
import { heldPaneFit, planPaneFit, readPaneFit } from "@/state/firmwareStore";
import {
  downloadMicrocode,
  loadMicrocodeCatalogue,
  microcodeCatalogueStore,
  microcodeDownloadMessage,
} from "@/state/microcodeCatalogueStore";
import type { PaneId } from "@/state/paneId";
import {
  catalogueAnswer,
  FIT_TABLE,
  fitTableAnswer,
  MICROCODE_CATALOGUE,
} from "@/tools/fit/agent/fitAgentAnswers";
import { fitDisplay } from "@/tools/fit/fitDisplay";
import { readPickedMicrocode } from "@/tools/fit/fitEditor";
import type { MicrocodeCatalogueEntry } from "@/tools/fit/microcodeCatalogue";
import type {
  ToolAgentChange,
  ToolAgentEdit,
  ToolAgentQuery,
  ToolReadHost,
} from "@/tools/toolAgent";

/**
 * What the FIT module says to an agent: the table, the catalogue set against the image, and the
 * changes the panel makes — the checksum, and a microcode added, replaced or taken out.
 *
 * The changes are the panel's own (`FITEditor`, planned in the firmware worker that holds the
 * tree), so every check the panel makes is made here too: a component that is not a microcode or
 * whose checksum is wrong, the same update already in the table under another of its CPUIDs, a
 * replacement that serves a processor another row already serves, a table or a run that cannot
 * grow, a write into a Boot Guard IBB, a Top Swap backup that differs. The module only works the
 * change out; the app decides whether it is made.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolModule.agentQueries
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolModule.agentEdits
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAgentCatalogueTools.swift#FITAgentCatalogueTools
 * @upstream-differs the reading is the panel's own, from the worker, and the downloads go through the page's catalogue source
 */

/**
 * The table read the way the panel reads it, once the image is.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentQueries.swift#FITAgentQueries.read
 */
async function tableOf(host: ToolReadHost): Promise<FITReport> {
  await readyFirmware(host.pane);
  const held = heldPaneFit(host.pane);
  const report = held ?? (await readPaneFit(host.pane));
  if (report === undefined) {
    throw new AgentToolError("This document has no firmware image to read a FIT from.");
  }
  return report;
}

/** The catalogue's listing: held, or waited for. */
async function listing(): Promise<readonly MicrocodeCatalogueEntry[]> {
  loadMicrocodeCatalogue();
  await new Promise<void>((resolve) => {
    const settled = () => {
      const status = microcodeCatalogueStore.getSnapshot().status;
      return status === "ready" || status === "failed";
    };
    if (settled()) {
      resolve();
      return;
    }
    const stop = microcodeCatalogueStore.subscribe(() => {
      if (!settled()) return;
      stop();
      resolve();
    });
  });
  const state = microcodeCatalogueStore.getSnapshot();
  if (state.status !== "ready") {
    throw new AgentToolError("The catalogue could not be read: the listing is not available.");
  }
  return state.entries;
}

/** @upstream Modules/FITTool/Sources/FITToolUI/FITAgentCatalogueTools.swift#FITAgentCatalogueTools.download */
async function download(
  path: string
): Promise<{ entry: MicrocodeCatalogueEntry; bytes: Uint8Array }> {
  const entry = (await listing()).find((one) => one.path === path);
  if (entry === undefined) {
    throw new AgentToolError(
      `No file \`${path}\` in the catalogue. \`microcode_catalogue\` lists the paths.`
    );
  }
  try {
    return { entry, bytes: await downloadMicrocode(entry) };
  } catch (error) {
    throw new AgentToolError(`The file could not be fetched: ${microcodeDownloadMessage(error)}`);
  }
}

/** The CPUID of a component, for the undo step's name. @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.cpuidText */
function cpuidOf(component: Uint8Array): string {
  const read = readPickedMicrocode(component);
  return read.ok ? microcodeCpuid(read.header.processorSignature) : "";
}

/** @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.requireMicrocodeRow */
function requireMicrocodeRow(entry: number, report: FITReport): void {
  const rows = report.table?.rows ?? [];
  if (!(entry > 0 && entry < rows.length)) {
    throw new AgentToolError(
      `The table has no row ${entry}; its rows are 1 to ${rows.length - 1} after the header.`
    );
  }
  if (rows[entry]?.target.kind !== "microcode") {
    throw new AgentToolError(`Row ${entry} is not a microcode row; \`fit_table\` lists the rows.`);
  }
}

/**
 * The worker's plan as a change, or the panel's own sentence for why not.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.ground
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.remove
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#FITAgentMicrocode.replace
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#Result
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentMicrocode.swift#Result.get
 */
async function change(
  pane: PaneId,
  edit: Parameters<typeof planPaneFit>[1],
  undoDetail: string
): Promise<ToolAgentChange> {
  const plan = await planPaneFit(pane, edit, true);
  if (plan === undefined) throw new AgentToolError("The change was superseded by another.");
  if (plan.problem !== undefined) {
    // The panel numbers its rows from 1 with the header first; an agent knows a row by its `entry`
    // in `fit_table`, from 0.
    throw new AgentToolError(
      plan.problemEntry === undefined
        ? plan.problem
        : `${plan.problem} In \`fit_table\` that row is entry ${plan.problemEntry}.`
    );
  }
  return {
    transaction: { name: plan.name ?? "", writes: plan.writes },
    undoDetail,
    ...(plan.report === undefined ? {} : { report: plan.report }),
  };
}

/**
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolModule.agentQueries
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentQueries.swift#FITAgentQueries.all
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAgentCatalogueTools.swift#FITAgentCatalogueTools.queries
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAgentCatalogueTools.swift#FITAgentCatalogueTools.catalogue
 */
export const fitAgentQueries: readonly ToolAgentQuery[] = [
  {
    name: FIT_TABLE.name,
    title: FIT_TABLE.title,
    description: FIT_TABLE.description,
    properties: FIT_TABLE.properties,
    run: async (host, args) => {
      const report = await tableOf(host);
      return jsonAnswer(withEnglish(() => fitTableAnswer(report, args)));
    },
  },
  {
    name: MICROCODE_CATALOGUE.name,
    title: MICROCODE_CATALOGUE.title,
    description: MICROCODE_CATALOGUE.description,
    properties: MICROCODE_CATALOGUE.properties,
    run: async (host, args: AgentArguments) => {
      const all = await listing();
      const report = args.bool("in_image", false) ? await tableOf(host) : undefined;
      return jsonAnswer(withEnglish(() => catalogueAnswer(all, report, host.contentVersion, args)));
    },
  },
];

/**
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolModule.agentEdits
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentQueries.swift#FITAgentQueries.fixChecksum
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAgentCatalogueTools.swift#FITAgentCatalogueTools.edits
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAgentCatalogueTools.swift#FITAgentCatalogueTools.add
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAgentCatalogueTools.swift#FITAgentCatalogueTools.replace
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAgentCatalogueTools.swift#FITAgentCatalogueTools.remove
 */
export const fitAgentEdits: readonly ToolAgentEdit[] = [
  {
    name: "fit_fix_checksum",
    title: "Fix the FIT checksum",
    description:
      "Writes the checksum the FIT table should have into its header row — and into the Top Swap " +
      "backup's copy when that copy is the same table — as the FIT panel's Fix Checksum does, as one " +
      "undo step. Refused when there is no table, when its checksum is not checked or already " +
      "correct, and without the person's permission to edit.",
    undoName: LocalizedText.of("Fix FIT Checksum"),
    run: async (host) => {
      const report = await tableOf(host);
      const table = report.table;
      if (table === undefined) {
        throw new AgentToolError(
          "There is no FIT table here to fix; `fit_table` says what was found."
        );
      }
      if (!table.checksumIsChecked) {
        throw new AgentToolError(
          "The table's ChecksumValid bit is clear: its checksum is not checked, and nothing needs writing."
        );
      }
      const fix = fitDisplay(report).checksumFix;
      if (fix === undefined) {
        throw new AgentToolError("The FIT checksum is already correct; nothing to write.");
      }
      return fix;
    },
  },
  {
    name: "fit_add_microcode",
    title: "Add a microcode",
    description:
      "Downloads a catalogue file (`path` from `microcode_catalogue`) and adds it to the FIT, as the " +
      "panel's Add Microcode does, as one undo step: where a row's update already serves the same " +
      "processor — its extended signature table counted — the new one takes that row's place " +
      '(`change`: "replaced", with what it `replaced`), otherwise it gets a row of its own ' +
      '("added"). Refused, with the reason, when the very same update is already in the table under ' +
      "another of its CPUIDs, when the file is not a microcode or its checksum is wrong, when the " +
      "table or the run cannot grow, inside a Boot Guard IBB, when a Top Swap backup differs, and " +
      "without the person's permission to edit. Says where the component went, how many " +
      "microcodes behind it `moved`, the `top_swap_backup` it was made in too, and what it means " +
      "for the `protected_ranges`.",
    properties: {
      path: { type: "string", description: "A file's `path` from `microcode_catalogue`." },
    },
    required: ["path"],
    undoName: LocalizedText.of("Add Microcode"),
    run: async (host, args) => {
      const { bytes } = await download(args.string("path"));
      await tableOf(host);
      return change(host.pane, { kind: "addOrReplace", component: bytes }, cpuidOf(bytes));
    },
  },
  {
    name: "fit_replace_microcode",
    title: "Replace a microcode",
    description:
      "Downloads a catalogue file (`path` from `microcode_catalogue`) and puts it in the place of row " +
      "`entry`'s microcode, as the panel's Replace Microcode does, as one undo step — whatever the " +
      "new update's CPUID. Refused when the same update is already in the table, and when the new " +
      "one serves a processor, on a shared platform, that another row's update already serves — " +
      "extended signature tables counted — since the table would then hold two microcodes for one " +
      "processor: that row is the one to replace. Refused too for the reasons `fit_add_microcode` " +
      "gives. Says as it does what changed.",
    properties: {
      entry: {
        type: "integer",
        description: "The microcode row's place in the table, from `fit_table`.",
      },
      path: { type: "string", description: "A file's `path` from `microcode_catalogue`." },
    },
    required: ["entry", "path"],
    undoName: LocalizedText.of("Replace Microcode"),
    run: async (host, args) => {
      const entry = args.integer("entry");
      const { bytes } = await download(args.string("path"));
      requireMicrocodeRow(entry, await tableOf(host));
      return change(
        host.pane,
        { kind: "replaceAt", index: entry, component: bytes },
        cpuidOf(bytes)
      );
    },
  },
  {
    name: "fit_remove_microcode",
    title: "Remove a microcode",
    description:
      "Takes row `entry` and its microcode out of the FIT, as the panel's Remove Microcode does, as " +
      "one undo step: the components behind it move up into the space and the rows follow them, " +
      "and the bytes freed at the end of the run are erased. Refused for the table's last " +
      "microcode, inside a Boot Guard IBB, when a Top Swap backup differs, and without the person's " +
      "permission to edit. Says how many `moved` and what was `erased`.",
    properties: {
      entry: {
        type: "integer",
        description: "The microcode row's place in the table, from `fit_table`.",
      },
    },
    required: ["entry"],
    undoName: LocalizedText.of("Remove Microcode"),
    run: async (host, args) => {
      const entry = args.integer("entry");
      const report = await tableOf(host);
      requireMicrocodeRow(entry, report);
      const row = report.table?.rows[entry];
      const detail =
        row?.target.kind === "microcode"
          ? microcodeCpuid(row.target.header.processorSignature)
          : "";
      return change(host.pane, { kind: "remove", index: entry }, detail);
    },
  },
];
