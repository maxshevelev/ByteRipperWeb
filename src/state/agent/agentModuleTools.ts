import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import {
  type AgentAnswer,
  type AgentTool,
  AgentToolError,
  agentTool,
  EDIT,
  jsonAnswer,
  READ_ONLY,
  VIEW,
} from "@/core/agent/agentTool";
import { isObject, type Json } from "@/core/agent/json";
import { L, withEnglish } from "@/core/localization/localization";
import type { AgentDesk, AgentPlace } from "@/state/agent/agentDesk";
import { agentSessionOn } from "@/state/agent/agentSessions";
import { agentShell } from "@/state/agent/agentShell";
import { recordJump } from "@/state/navigationStore";
import { surfaceOf } from "@/state/paneId";
import { activate, selectPane, sessionOn, toolController } from "@/state/toolController";
import { paneState } from "@/state/workspaceStore";
import type {
  ToolAgentAction,
  ToolAgentComparison,
  ToolAgentEdit,
  ToolAgentQuery,
  ToolReadHost,
} from "@/tools/toolAgent";
import type { ToolModule } from "@/tools/toolModule";

/**
 * The tools the tool-modules contribute, turned into tools the server lists, and `open_panel`, which
 * is how an agent reaches a panel that is not open.
 *
 * A query runs against a read host for the document the agent names — the pane's own shared parse,
 * whatever the left panel shows. An action runs on the live session of its module on the pane
 * holding the document, and when there is none it says so and names `open_panel`. The list is the
 * same whatever is open: a client plans against a list that holds still.
 *
 * @upstream ByteRipperApp/Agent/AgentModuleTools.swift#AgentModuleTools
 */
export class AgentModuleTools {
  /** @upstream ByteRipperApp/Agent/AgentModuleTools.swift#AgentModuleTools.desk */
  readonly desk: AgentDesk;
  private readonly modules: () => readonly ToolModule[];
  /**
   * The one door a module's edit is applied through; set by the service once the edit tools exist.
   *
   * @upstream ByteRipperApp/Agent/AgentModuleTools.swift#AgentModuleTools.edits
   */
  edits:
    | {
        checkEditable(place: AgentPlace): void;
        apply(
          transaction: {
            readonly name: string;
            readonly writes: readonly { readonly offset: number; readonly bytes: Uint8Array }[];
          },
          place: AgentPlace
        ): Promise<Json>;
      }
    | undefined;

  /** @upstream ByteRipperApp/Agent/AgentModuleTools.swift#AgentModuleTools.init */
  constructor(desk: AgentDesk, modules: () => readonly ToolModule[]) {
    this.desk = desk;
    this.modules = modules;
  }

  /**
   * What `open_panel` and the "not open" answers call a module: the last part of its identifier,
   * `uefi-structure` for `dev.maxik.tool.uefi-structure`.
   *
   * @upstream ByteRipperApp/Agent/AgentModuleTools.swift#AgentModuleTools.shortName
   */
  static shortName(module: ToolModule): string {
    return module.id.split(".").at(-1) ?? module.id;
  }

  /**
   * Every module's queries, its comparisons of two documents, its edits, then every module's actions,
   * then `open_panel`.
   *
   * @upstream ByteRipperApp/Agent/AgentModuleTools.swift#AgentModuleTools.tools
   */
  tools(): AgentTool[] {
    const list = this.modules();
    return [
      ...list.flatMap((module) =>
        (module.agentQueries ?? []).map((query) => this.queryTool(query))
      ),
      ...list.flatMap((module) =>
        (module.agentComparisons ?? []).map((one) => this.comparisonTool(one))
      ),
      ...list.flatMap((module) => (module.agentEdits ?? []).map((one) => this.editTool(one))),
      ...list.flatMap((module) =>
        (module.agentActions ?? []).map((one) => this.actionTool(module, one))
      ),
      this.openPanelTool(list),
    ];
  }

  /** A host that reads and nothing else: a query must not draw zones or put up dialogs on a panel that is not there. */
  hostFor(place: AgentPlace): ToolReadHost {
    const pane = place.onScreenOrBackground();
    return {
      pane,
      fileName: place.name,
      get contentSize() {
        return place.document.size;
      },
      read: (start, end) => place.document.read(start, end - start),
      get contentVersion() {
        return place.document.contentGeneration;
      },
    };
  }

  // MARK: - Queries

  private queryTool(query: ToolAgentQuery): AgentTool {
    return agentTool({
      name: query.name,
      title: query.title,
      description: query.description,
      inputSchema: AgentSchema.object(
        {
          ...query.properties,
          document: AgentSchema.string(
            "The document's id from `documents`. Default: the focused one."
          ),
        },
        [...(query.required ?? [])]
      ),
      run: (call) => this.runQuery(query, call.arguments),
    });
  }

  private async runQuery(query: ToolAgentQuery, args: AgentArguments): Promise<AgentAnswer> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    const answer = await query.run(this.hostFor(place), args);
    return withDocument(answer, { document: place.id });
  }

  // MARK: - Comparisons

  private comparisonTool(comparison: ToolAgentComparison): AgentTool {
    return agentTool({
      name: comparison.name,
      title: comparison.title,
      description: comparison.description,
      inputSchema: AgentSchema.object(
        {
          ...comparison.properties,
          document: AgentSchema.string(
            "The first document's id from `documents`. Default: the focused one."
          ),
          against: AgentSchema.string(
            "The id of the document to set beside it, from `documents` or `open_dump`."
          ),
        },
        [...(comparison.required ?? []), "against"]
      ),
      run: (call) => this.runComparison(comparison, call.arguments),
    });
  }

  private async runComparison(
    comparison: ToolAgentComparison,
    args: AgentArguments
  ): Promise<AgentAnswer> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    const other = this.desk.placeNamed(args.string("against"));
    if (other.document === place.document) {
      throw new AgentToolError(`\`document\` and \`against\` are the same document, ${place.id}.`);
    }
    const answer = await comparison.run(this.hostFor(place), this.hostFor(other), args);
    return withDocument(answer, { document: place.id, against: other.id });
  }

  // MARK: - Edits

  private editTool(edit: ToolAgentEdit): AgentTool {
    return agentTool({
      name: edit.name,
      title: edit.title,
      description: edit.description,
      inputSchema: AgentSchema.object(
        {
          ...edit.properties,
          document: AgentSchema.string(
            "The document's id from `documents`. Default: the focused one."
          ),
        },
        [...(edit.required ?? [])]
      ),
      annotations: EDIT,
      run: (call) => this.runEdit(edit, call.arguments),
    });
  }

  /**
   * The module works the change out; the edit tools decide whether it is made — asked first too, so
   * a refused edit costs no parse.
   *
   * @upstream ByteRipperApp/Agent/AgentModuleTools.swift#AgentModuleTools.runEdit
   */
  private async runEdit(edit: ToolAgentEdit, args: AgentArguments): Promise<AgentAnswer> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    const edits = this.edits;
    if (edits === undefined) throw new AgentToolError("Editing is not available.");
    edits.checkEditable(place);
    const host = this.hostFor(place);
    const version = host.contentVersion;
    const done = await edit.run(host, args);
    if (host.contentVersion !== version) {
      throw new AgentToolError(
        `${place.id} changed while the edit was being worked out; nothing was written. Ask again.`
      );
    }
    const change = "transaction" in done ? done : { transaction: done };
    const detail = change.undoDetail ?? "";
    // The undo step is named in the app's own language, from the module's name and the agent's detail.
    const name = L("Agent: %1$@", detail === "" ? edit.undoName() : `${edit.undoName()} ${detail}`);
    const answer = await edits.apply({ name, writes: change.transaction.writes }, place);
    return jsonAnswer(isObject(answer) ? { ...answer, ...(change.report ?? {}) } : answer);
  }

  // MARK: - Actions

  private actionTool(module: ToolModule, action: ToolAgentAction): AgentTool {
    const short = AgentModuleTools.shortName(module);
    return agentTool({
      name: action.name,
      title: action.title,
      description: action.description,
      inputSchema: AgentSchema.object(
        {
          ...action.properties,
          document: AgentSchema.string(
            "The document's id from `documents`. Default: the focused one."
          ),
        },
        [...(action.required ?? [])]
      ),
      annotations: action.changesView ? VIEW : READ_ONLY,
      run: (call) => this.runAction(action, module, short, call.arguments),
    });
  }

  private async runAction(
    action: ToolAgentAction,
    module: ToolModule,
    short: string,
    args: AgentArguments
  ): Promise<AgentAnswer> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    const pane = place.onScreen();
    const running = sessionOn(toolController.getSnapshot(), surfaceOf(pane));
    const session =
      running.activeIdentifier === module.id && running.boundPane === pane
        ? agentSessionOn(pane, module.id)
        : undefined;
    if (session === undefined) {
      throw new AgentToolError(
        `The ${module.title} panel is not open on ${place.id}. ` +
          `Call \`open_panel\` with module "${short}" first, or show the bytes with \`reveal\`.`
      );
    }
    if (action.changesView) agentShell.bringForward?.(pane);
    return action.run(session, args);
  }

  // MARK: - open_panel

  private openPanelTool(list: readonly ToolModule[]): AgentTool {
    const names = list.map((module) => AgentModuleTools.shortName(module));
    const catalogue = list
      .map(
        (module) => `"${AgentModuleTools.shortName(module)}" (${withEnglish(() => module.title)})`
      )
      .join(", ");
    return agentTool({
      name: "open_panel",
      title: "Open a tool panel",
      description:
        "Opens a tool panel on a document, the way the Tools menu does: the panel beside its dump " +
        "switches to `module` and reads that document. The panel that was there keeps its place for " +
        "when the person returns to it, and the switch is a step of the navigation history. " +
        `Refused while the person is in the middle of something — a dialog. Modules: ${catalogue}.`,
      inputSchema: AgentSchema.object(
        {
          module: AgentSchema.choice(names, "Which panel."),
          document: AgentSchema.string(
            "The document's id from `documents`. Default: the focused one."
          ),
        },
        ["module"]
      ),
      annotations: VIEW,
      run: async (call) => this.openPanel(call.arguments, names),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentModuleTools.swift#AgentModuleTools.openPanel */
  private openPanel(args: AgentArguments, names: readonly string[]): AgentAnswer {
    const short = args.choice("module", names);
    const module = this.modules().find((one) => AgentModuleTools.shortName(one) === short);
    if (module === undefined) {
      throw new AgentToolError(`No module "${short}" in this copy of ByteRipper.`);
    }
    const place = this.desk.placeNamed(args.optionalString("document"));
    const pane = place.onScreen();
    const busy = agentShell.busy?.();
    if (busy !== undefined) throw new AgentToolError(`${busy} Ask the person to finish it first.`);
    const surface = surfaceOf(pane);
    const running = sessionOn(toolController.getSnapshot(), surface);
    const alreadyOpen = running.activeIdentifier === module.id && running.boundPane === pane;
    if (!alreadyOpen) {
      agentShell.bringForward?.(pane);
      recordJump(pane);
      activate(module.id, surface);
      if (sessionOn(toolController.getSnapshot(), surface).boundPane !== pane) selectPane(pane);
    }
    const now = sessionOn(toolController.getSnapshot(), surface);
    if (
      now.activeIdentifier !== module.id ||
      now.boundPane !== pane ||
      paneState(pane) === undefined
    ) {
      throw new AgentToolError(`The ${module.title} panel could not be opened on ${place.id}.`);
    }
    return jsonAnswer({
      document: place.id,
      module: short,
      panel: withEnglish(() => module.title),
      was_open: alreadyOpen,
    });
  }
}

/** The answer with the document ids the app adds beside the module's own members. */
function withDocument(answer: AgentAnswer, ids: { [key: string]: string }): AgentAnswer {
  if (answer.kind === "json" && isObject(answer.value)) {
    return jsonAnswer({ ...answer.value, ...ids });
  }
  return answer;
}
