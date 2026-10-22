import type { AgentArguments } from "@/core/agent/agentArguments";
import type { RelayCommand } from "@/core/agent/agentClientConfiguration";
import { AgentConnection } from "@/core/agent/agentConnection";
import { type AgentCallRecord, AgentServer, isRunning } from "@/core/agent/agentServer";
import {
  type AgentAnswer,
  type AgentCall,
  type AgentTool,
  AgentToolError,
  jsonAnswer,
} from "@/core/agent/agentTool";
import {
  type AgentToolEntry,
  type AgentToolGroup,
  type AgentToolKind,
  type AgentToolStats,
  addToStats,
  HOST_GROUPS,
} from "@/core/agent/agentToolCatalogue";
import { isObject } from "@/core/agent/json";
import { type AgentBridge, agentBridge } from "@/platform/desktop/agentBridge";
import { desktopOwnWindows, ownWindowKind } from "@/platform/desktop/desktopWindows";
import { AgentAnnotationTools } from "@/state/agent/agentAnnotationTools";
import {
  AGENT_BACKGROUND_LIMITS,
  defaultMemoryMiB,
  defaultPhysicalMemory,
  memoryChoicesMiB,
  snapped,
} from "@/state/agent/agentBackgroundDocuments";
import { AgentDesk } from "@/state/agent/agentDesk";
import { AgentDiffTools, placeJson } from "@/state/agent/agentDiffTools";
import { AgentDumpTools } from "@/state/agent/agentDumpTools";
import { AgentEditTools } from "@/state/agent/agentEditTools";
import { AgentFindTools } from "@/state/agent/agentFindTools";
import { AgentHostTools } from "@/state/agent/agentHostTools";
import { AgentModuleTools } from "@/state/agent/agentModuleTools";
import { AgentRefsTools } from "@/state/agent/agentRefsTools";
import {
  loadAgentSettings,
  onSettingsFromOtherWindows,
  rememberAgentBackgroundFiles,
  rememberAgentBackgroundMemoryMiB,
  rememberAgentEditsAllowed,
  rememberAgentEnabled,
  rememberAgentLaunchesApp,
} from "@/state/settingsStore";
import { createStore } from "@/state/store";
import {
  agentPanelIsUp,
  closeAgentPanel,
  openAgentPanel,
  type PaneId,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";
import { TOOLS } from "@/tools/registry";
import type { ToolModule } from "@/tools/toolModule";
import { appVersionText } from "@/ui/shell/appVersion";

/**
 * The agent service: the endpoint an agent's client reaches the app on, the connections made to
 * it, and the log of what they asked (`Design/PORT_AGENT.md`).
 *
 * A service of the app, not a tool-module: one tool-module is open per tab and it stops when
 * another is picked, while an agent has to keep working whatever the left panel shows. It lives as
 * long as the page, and is off until the person switches it on in Settings.
 *
 * The page runs the protocol and the tools; the Electron shell only copies bytes between an
 * endpoint's connections and here (`desktop/agent.cjs`).
 *
 * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService
 */

/** How many calls the log keeps. @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.logLimit */
export const AGENT_LOG_LIMIT = 500;

/**
 * How long the service stays active after the last running call has ended, in milliseconds.
 *
 * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.activityHold
 */
export const AGENT_ACTIVITY_HOLD = 2000;

/** What the Agent window and the status mark show. */
export interface AgentServiceState {
  /**
   * Whether an agent is at work: a call is running, or one ended less than
   * {@link AGENT_ACTIVITY_HOLD} ago. A call often takes a few milliseconds, and a mark that showed
   * only the running ones would never be seen; held a moment after each, a run of calls reads as one
   * stretch of work.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.isActive
   */
  readonly active: boolean;
  /** The switch. @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.isEnabled */
  readonly enabled: boolean;
  /** Whether an agent may write into an open file. @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.editsAllowed */
  readonly editsAllowed: boolean;
  /**
   * Whether the configuration handed out lets the relay start the app: the launch switch of the
   * Settings tab, off until the person turns it on. The relay reads no setting of the app's, so the
   * choice travels in the client's configuration, and takes effect once it is copied there again.
   *
   * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentClientConfiguration.launchesApp
   * @upstream-differs kept with the service's other switches, where the page loads them
   */
  readonly launchesApp: boolean;
  /**
   * How many files an agent opened by path stay parsed at once.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.backgroundFileLimit
   */
  readonly backgroundFileLimit: number;
  /**
   * How many MiB those files may hold between them.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.backgroundMemoryLimitMiB
   */
  readonly backgroundMemoryLimitMiB: number;
  /**
   * The computer's memory, which the memory bound offered is a share of: the shell's word for it
   * once it has said.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.physicalMemory
   */
  readonly physicalMemory: number;
  /** Whether the endpoint is open. @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.isRunning */
  readonly running: boolean;
  /**
   * Why the endpoint could not be opened, when it could not — another copy of the app holds it, the
   * folder cannot be written. Undefined while running or switched off.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.failure
   */
  readonly failure: string | undefined;
  /** Where the endpoint is, while it is open. */
  readonly endpoint: string | undefined;
  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.connectionCount */
  readonly connections: number;
  /** The calls made, oldest first, at most {@link AGENT_LOG_LIMIT} of them. */
  readonly log: readonly AgentCallRecord[];
  /**
   * How each tool has been used since the app started, by name. Kept apart from the log, which
   * keeps only its last calls.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.toolStats
   */
  readonly toolStats: Readonly<Record<string, AgentToolStats>>;
  /** What a client is configured with, once the shell has said. */
  readonly relay: RelayCommand | undefined;
}

const INITIAL: AgentServiceState = {
  active: false,
  enabled: false,
  editsAllowed: false,
  launchesApp: false,
  backgroundFileLimit: AGENT_BACKGROUND_LIMITS.defaultFiles,
  backgroundMemoryLimitMiB: defaultMemoryMiB(defaultPhysicalMemory()),
  physicalMemory: defaultPhysicalMemory(),
  running: false,
  failure: undefined,
  endpoint: undefined,
  connections: 0,
  log: [],
  toolStats: {},
  relay: undefined,
};

/**
 * Read by the model once, before it uses any tool. Grows with the tools: each stage adds the
 * sentences about what it brings.
 *
 * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.instructions
 * @upstream-differs a file or a node is named by its `label` alone: the page has no `link` to hand out
 */
export const AGENT_INSTRUCTIONS =
  "ByteRipper is a hex editor for firmware dumps, open on the person's computer. These tools read the files " +
  "open in it and show places in them to the person. `documents` lists what is open, `focus` what the " +
  'person is looking at — what they mean by "this" or "here". Addresses and sizes are hex strings ' +
  '("0x7F3000") both ways; ranges are half-open. A list comes in pages: pass `next` back as `after` ' +
  "until it is null. `reveal` points at what you are talking about; `annotate` notes a place — what " +
  "bytes are, or what you found — drawn over them and kept with the file. `open_dump` reads a file by " +
  "path without showing it, `survey` asks one tool's question of a folder of dumps. `find_bytes` " +
  "searches the bytes; the `uefi_` tools read a firmware image's structure. To the person, name a file or a node by its " +
  "`label`, never by an id (d1, 0.2.5). `open_part` opens a stretch or a node as " +
  "a part of its own, in a panel over the same window — decompressed, or a Lenovo LENV block decoded " +
  'with `part: "decoded"`; asking again raises the open one (`reused: true`). A part is a document to ' +
  "every tool, takes the focus, and has a tree with ids of its own: name the `document` a node id was " +
  "listed on. A node says how the file holds it (`encoded`, `compressed`) and names the same node in " +
  "an open part or in its parent (`counterpart`, `decoded_in`); `focus_note` says a call went to the " +
  "parent or a part of the focused document; `tool_panel` says whether a part has a panel, which " +
  "`open_panel` with the part's `document` opens. `diff`, `compare` and `reveal_diff` set two documents " +
  "side by side. Nothing here saves a file; `write`, `update_in_parent`, the `_fix_checksum` and the " +
  "microcode tools change an open file, one undo step each, and only if the person allows edits. " +
  "`uefi_select` and `uefi_selection` act on the open UEFI Structure panel. A tool refuses an argument " +
  "it does not take; to test a client, use `documents`, never `open_part`.";

/**
 * Whether `pane` was taken out of `other`, directly or through parts.
 *
 * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.isPart
 */
function isPartOf(pane: PaneId | undefined, other: PaneId | undefined): boolean {
  if (pane === undefined || other === undefined) return false;
  let parent = paneState(pane)?.origin?.parent;
  for (let steps = 0; parent !== undefined && steps < 64; steps++) {
    if (parent === other) return true;
    parent = paneState(parent)?.origin?.parent;
  }
  return false;
}

export class AgentService {
  /**
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.didChange
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.log
   */
  readonly store = createStore<AgentServiceState>(INITIAL);
  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.desk */
  readonly desk = new AgentDesk(() => this.bridge);
  readonly hostTools: AgentHostTools;
  /**
   * The agent's annotations, which the Annotations panel lists and clears too.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.annotationTools
   */
  readonly annotationTools: AgentAnnotationTools;
  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.dumpTools */
  readonly dumpTools: AgentDumpTools;
  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.editTools */
  readonly editTools: AgentEditTools;
  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.diffTools */
  readonly diffTools: AgentDiffTools;
  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.findTools */
  readonly findTools: AgentFindTools;
  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.refsTools */
  readonly refsTools: AgentRefsTools;
  readonly moduleTools: AgentModuleTools;
  private bridge: AgentBridge | undefined;
  private readonly connections = new Map<number, AgentConnection>();
  /**
   * The connections whose client has sent a message. A socket alone is not an agent: Claude
   * Desktop, starting its servers, launches the relay, abandons it a second later for a fresh one,
   * and leaves the first running with its pipes open. That relay connects and never speaks, and
   * counting it showed two agents where there was one.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.clients
   */
  private readonly clients = new Set<number>();
  private unsubscribe: (() => void)[] = [];
  private builtServer: AgentServer | undefined;
  private builtCatalogue: readonly AgentToolEntry[] | undefined;
  private readonly modules: () => readonly ToolModule[];
  private callListeners = new Set<(record: AgentCallRecord) => void>();
  /** The bounds as kept, before they are brought inside the choices this computer is offered. */
  private keptLimits: { files: number | undefined; memoryMiB: number | undefined } = {
    files: undefined,
    memoryMiB: undefined,
  };

  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.init */
  constructor(
    bridge: AgentBridge | undefined = agentBridge(),
    modules: () => readonly ToolModule[] = () => TOOLS
  ) {
    this.bridge = bridge;
    this.modules = modules;
    this.hostTools = new AgentHostTools(this.desk);

    this.dumpTools = new AgentDumpTools(this.desk, () => this.bridge);
    this.annotationTools = new AgentAnnotationTools(this.desk, this.dumpTools);
    this.dumpTools.toolNamed = (name) => this.allTools().find((tool) => tool.name === name);
    this.editTools = new AgentEditTools(this.desk);
    this.editTools.isAllowed = () => this.store.getSnapshot().editsAllowed;
    this.moduleTools = new AgentModuleTools(this.desk, modules);
    this.moduleTools.edits = this.editTools;
    this.diffTools = new AgentDiffTools(this.desk, this.moduleTools, modules);
    this.findTools = new AgentFindTools(this.desk, this.diffTools, this.moduleTools);
    this.refsTools = new AgentRefsTools(this.desk, this.moduleTools);
    this.editTools.locate = async (place, range) =>
      ((await this.diffTools.locate(this.moduleTools.hostFor(place), [range]))[0] ?? []).map(
        placeJson
      );
  }

  /** Whether there is a shell to serve through; a browser has none, and no agent. */
  get isAvailable(): boolean {
    return this.bridge !== undefined;
  }

  /**
   * Where this page's service stands among the desktop shell's windows (D7d): the Agent window's
   * page holds the endpoint, the connections and the log, and has each call run by a window of
   * the workspace — the one holding the document it names, or the one in front — which runs it
   * against its own documents. A page outside the shell, a test's, is all of it at once.
   *
   * @web-only upstream's service and documents are in one process
   */
  get role(): "host" | "runner" | "whole" {
    if (ownWindowKind() === "agent") return "host";
    return desktopOwnWindows() !== undefined && ownWindowKind() === undefined ? "runner" : "whole";
  }

  /**
   * How the Agent window's page has a call run by the window that is to run it; nothing until
   * `agentWindows.ts` says, and nothing outside the shell.
   */
  route: ((tool: string, call: AgentCall) => Promise<AgentAnswer>) | undefined;

  /**
   * Runs the call here, against this window's documents, as the service would — what a window of
   * the workspace does for the Agent window's page.
   */
  runHere(tool: string, call: AgentCall): Promise<AgentAnswer> {
    const found = this.allTools().find((one) => one.name === tool);
    if (found === undefined) throw new AgentToolError(`Unknown tool: ${tool}`);
    return this.trimming(this.labelling(this.noted(found))).run(call);
  }

  /**
   * Every tool, in the order `tools/list` gives them.
   *
   * @web-only the catalogue's tools alone; upstream's `server` lists the catalogue
   */
  allTools(): AgentTool[] {
    return this.catalogue().map((entry) => entry.tool);
  }

  /**
   * Every tool, in the order `tools/list` gives them, with where it comes from and what it does —
   * what the Agent window's Tools page lists. Built once: the tools do not change while the app
   * runs.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.catalogue
   */
  catalogue(): readonly AgentToolEntry[] {
    if (this.builtCatalogue !== undefined) return this.builtCatalogue;
    const kindOf = (tool: AgentTool, group: AgentToolGroup): AgentToolKind =>
      group.isEdits ? "edit" : tool.annotations.readOnly ? "read" : "screen";
    const entries = (tools: AgentTool[], group: AgentToolGroup): AgentToolEntry[] =>
      tools.map((tool) => ({ tool: this.refreshing(tool), group, kind: kindOf(tool, group) }));
    const list = [
      ...entries(this.hostTools.tools(), HOST_GROUPS.files),
      ...entries(this.annotationTools.tools(), HOST_GROUPS.annotations),
      ...entries(this.dumpTools.tools(), HOST_GROUPS.dumps),
      ...entries(this.diffTools.tools(), HOST_GROUPS.comparison),
      ...entries([...this.findTools.tools(), ...this.refsTools.tools()], HOST_GROUPS.search),
      ...entries(this.editTools.tools(), HOST_GROUPS.edits),
    ];
    // A module's tools under the module; its edits are edits.
    const modules = this.modules();
    for (const tool of this.moduleTools.tools()) {
      const module = modules.find((one) =>
        [
          ...(one.agentQueries ?? []),
          ...(one.agentComparisons ?? []),
          ...(one.agentEdits ?? []),
          ...(one.agentActions ?? []),
        ].some((own) => own.name === tool.name)
      );
      const group: AgentToolGroup =
        module === undefined
          ? HOST_GROUPS.panels
          : { key: module.id, title: () => module.title, isEdits: false };
      const edits = module?.agentEdits?.some((own) => own.name === tool.name) ?? false;
      list.push({
        tool: this.refreshing(tool),
        group,
        kind: edits ? "edit" : tool.annotations.readOnly ? "read" : "screen",
      });
    }
    this.builtCatalogue = list;
    return list;
  }

  /**
   * `tool`, answering about a background file as it is on disk now: one changed since it was read
   * is read again before the call, and keeps its id.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.place
   * @upstream-differs upstream reads it again inside the synchronous lookup; the page's read is a wait, so it is done before the tool runs
   * — and so is reading again one let go to stay inside the bounds (`AgentDesk.revive`)
   */
  private refreshing(tool: AgentTool): AgentTool {
    return {
      ...tool,
      run: async (call) => {
        for (const name of ["document", "against"]) {
          const id = call.arguments.get(name);
          if (typeof id !== "string") continue;
          // One let go to stay inside the bounds is read again under its id.
          await this.desk.revive(id);
          const place = this.desk.places().find((one) => one.id === id);
          if (place !== undefined && !place.isOnScreen && place.pane !== undefined) {
            await this.desk.background.touch(place.pane);
          }
        }
        return tool.run(call);
      },
    };
  }

  /**
   * Built once: the tools do not change while the app runs.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.server
   */
  get server(): AgentServer {
    this.builtServer ??= new AgentServer({
      // @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.appVersion
      info: { name: "byteripper", version: appVersionText(), title: "ByteRipper" },
      instructions: AGENT_INSTRUCTIONS,
      tools: this.allTools().map((tool) =>
        this.role === "host"
          ? { ...tool, run: (call) => this.routed(tool.name, call) }
          : this.trimming(this.labelling(this.noted(tool)))
      ),
    });
    return this.builtServer;
  }

  private routed(tool: string, call: AgentCall): Promise<AgentAnswer> {
    return this.route === undefined ? this.runHere(tool, call) : this.route(tool, call);
  }

  /**
   * `tool`, bringing the background files back inside their bounds once it has answered: a file
   * grows as it is asked about, and whatever the call opened or parsed is counted now.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.trimming
   */
  private trimming(tool: AgentTool): AgentTool {
    return {
      ...tool,
      run: async (call) => {
        try {
          return await tool.run(call);
        } finally {
          await this.desk.background.trim();
        }
      },
    };
  }

  /**
   * `tool`, with `document_label` beside the answer's `document`: the document by the name the
   * person knows it by.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.linking
   * @upstream-differs labels only: no `link` beside a UEFI node's `label`, a page never being told
   * the path of a file it opens (`AgentNodeURLs` is unported)
   */
  private labelling(tool: AgentTool): AgentTool {
    return {
      ...tool,
      run: async (call) => {
        // The label is added after the tool has cut its page, so the tool is given a quarter less
        // room, as upstream gives it for the links it adds there.
        call.arguments.answerBound = Math.floor(call.arguments.answerBound / 4) * 3;
        const answer = await tool.run(call);
        if (answer.kind !== "json" || !isObject(answer.value)) return answer;
        const id = answer.value.document;
        if (typeof id !== "string") return answer;
        const label = this.desk.places().find((place) => place.id === id)?.label;
        if (label === undefined || label === id) return answer;
        return jsonAnswer({ ...answer.value, document_label: label });
      },
    };
  }

  /**
   * `tool`, saying so when the call names a document that is not the focused one but its part or
   * its parent: the focus is on the decoded block and the call went to the dump it came from, or
   * the other way round. Read before the call — `open_part` moves the focus — and added to a
   * refusal too, where it most often explains one: a node id of one of the two is not a node of
   * the other.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.noted
   */
  private noted(tool: AgentTool): AgentTool {
    return {
      ...tool,
      run: async (call) => {
        const note = this.focusNote(call.arguments);
        try {
          const answer = await tool.run(call);
          if (note === undefined || answer.kind !== "json" || !isObject(answer.value))
            return answer;
          return jsonAnswer({ ...answer.value, focus_note: note });
        } catch (error) {
          if (note === undefined || !(error instanceof AgentToolError)) throw error;
          throw new AgentToolError(`${error.message} ${note}`);
        }
      },
    };
  }

  /**
   * The note, read from the call's own `document`. A `document` that is no string is not this
   * note's to refuse: it says nothing, and the tool's own refusal reaches the model unchanged.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.focusNote
   */
  focusNote(args: AgentArguments): string | undefined {
    let named: string | undefined;
    try {
      named = args.optionalString("document");
    } catch {
      return undefined;
    }
    if (named === undefined) return undefined;
    const focused = this.desk.focused();
    const place = this.desk.places().find((one) => one.id === named);
    if (focused === undefined || focused.id === named || place === undefined) return undefined;
    if (isPartOf(focused.pane, place.pane)) {
      return (
        `The focus is on ${focused.id}, a part of ${named}; this call went to ${named}, as \`document\` asked. ` +
        "The part's nodes have ids of their own."
      );
    }
    if (isPartOf(place.pane, focused.pane)) {
      return (
        `The focus is on ${focused.id}; this call went to ${named}, a part of it, as \`document\` asked. ` +
        "The part's nodes have ids of their own."
      );
    }
    return undefined;
  }

  // MARK: - The switch

  /** Reads the switches left by the last visit, and opens the endpoint if the service was on. */
  async start(): Promise<void> {
    await this.readSettings();
    void this.loadRelay();
    // A switch turned in another window is turned in this one.
    onSettingsFromOtherWindows(() => void this.readSettings());
  }

  private async readSettings(): Promise<void> {
    const settings = await loadAgentSettings();
    this.store.update((state) =>
      state.enabled === settings.enabled &&
      state.editsAllowed === settings.editsAllowed &&
      state.launchesApp === settings.launchesApp
        ? state
        : {
            ...state,
            enabled: settings.enabled,
            editsAllowed: settings.editsAllowed,
            launchesApp: settings.launchesApp,
          }
    );
    this.keptLimits = {
      files: settings.backgroundFiles,
      memoryMiB: settings.backgroundMemoryMiB,
    };
    this.applyLimits();
    await this.apply();
  }

  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.isEnabled */
  async setEnabled(enabled: boolean): Promise<void> {
    rememberAgentEnabled(enabled);
    this.store.update((state) => ({ ...state, enabled }));
    await this.apply();
  }

  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.editsAllowed */
  setEditsAllowed(allowed: boolean): void {
    rememberAgentEditsAllowed(allowed);
    this.store.update((state) => ({ ...state, editsAllowed: allowed }));
  }

  /** The configuration shown follows at once: it is what the choice is. @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.launchChanged */
  setLaunchesApp(launches: boolean): void {
    rememberAgentLaunchesApp(launches);
    this.store.update((state) => ({ ...state, launchesApp: launches }));
  }

  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.backgroundFileLimit */
  setBackgroundFileLimit(count: number): void {
    rememberAgentBackgroundFiles(count);
    this.keptLimits = { ...this.keptLimits, files: count };
    this.applyLimits();
  }

  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.backgroundMemoryLimitMiB */
  setBackgroundMemoryLimitMiB(mib: number): void {
    rememberAgentBackgroundMemoryMiB(mib);
    this.keptLimits = { ...this.keptLimits, memoryMiB: mib };
    this.applyLimits();
  }

  /**
   * The memory bounds this computer is offered, in MiB.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.memoryChoicesMiB
   */
  memoryChoicesMiB(): number[] {
    return memoryChoicesMiB(this.store.getSnapshot().physicalMemory);
  }

  /**
   * The kept bounds brought inside the choices and handed to the open set, which lets go of what is
   * over them.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.init
   * @upstream-differs run again when the shell says how much memory the computer has, which changes
   * what is offered
   */
  private applyLimits(): void {
    const physical = this.store.getSnapshot().physicalMemory;
    const files = snapped(
      this.keptLimits.files,
      AGENT_BACKGROUND_LIMITS.fileChoices,
      AGENT_BACKGROUND_LIMITS.defaultFiles
    );
    const memoryMiB = snapped(
      this.keptLimits.memoryMiB,
      memoryChoicesMiB(physical),
      defaultMemoryMiB(physical)
    );
    this.desk.background.fileLimit = files;
    this.desk.background.memoryLimit = memoryMiB * 2 ** 20;
    this.store.update((state) => ({
      ...state,
      backgroundFileLimit: files,
      backgroundMemoryLimitMiB: memoryMiB,
    }));
  }

  /**
   * Opens or closes the endpoint to match the switch.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.apply
   */
  async apply(): Promise<void> {
    if (this.store.getSnapshot().enabled) await this.open();
    else this.stop();
  }

  private async open(): Promise<void> {
    const bridge = this.bridge;
    // A window of the workspace has the Agent window's page made, which opens the endpoint; what
    // the service is doing it is told from there (`agentWindows.ts`).
    if (this.role === "runner") {
      await bridge?.setEnabled(true);
      return;
    }
    if (bridge === undefined || this.store.getSnapshot().running) return;
    const outcome = await bridge.setEnabled(true);
    if (!outcome.ok) {
      this.store.update((state) => ({ ...state, failure: outcome.error ?? "Could not open it." }));
      return;
    }
    this.unsubscribe = [
      bridge.onConnection((id) => this.adopt(id)),
      bridge.onData((id, bytes) => this.connections.get(id)?.receive(bytes)),
      bridge.onClose((id) => this.release(id)),
    ];
    this.store.update((state) => ({
      ...state,
      running: true,
      failure: undefined,
      endpoint: outcome.endpoint,
    }));
  }

  /**
   * Closes the endpoint and every connection on it. A client finds the relay gone and starts it
   * again when it next needs it.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.stop
   */
  stop(): void {
    if (this.role === "runner") {
      if (this.store.getSnapshot().running) void this.bridge?.setEnabled(false);
      return;
    }
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.clients.clear();
    void this.bridge?.setEnabled(false);
    clearTimeout(this.activityEnd);
    this.activityEnd = undefined;
    this.store.update((state) => ({
      ...state,
      active: false,
      running: false,
      failure: undefined,
      endpoint: undefined,
      connections: 0,
    }));
  }

  // MARK: - Connections

  private adopt(id: number): void {
    const bridge = this.bridge;
    if (bridge === undefined || !this.store.getSnapshot().running) {
      bridge?.end(id);
      return;
    }
    this.connections.set(
      id,
      this.connect(
        (line) => bridge.send(id, line),
        () => {
          if (!this.connections.has(id)) return;
          this.clients.add(id);
          this.store.update((state) => ({ ...state, connections: this.clients.size }));
        }
      )
    );
  }

  private release(id: number): void {
    this.connections.get(id)?.close();
    if (!this.connections.delete(id)) return;
    this.clients.delete(id);
    this.store.update((state) => ({ ...state, connections: this.clients.size }));
  }

  /**
   * A connection to the service over whatever carries the bytes — the shell's pipe, or a test's
   * own.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.connect
   */
  connect(send: (line: Uint8Array) => void, onFirstMessage?: () => void): AgentConnection {
    return new AgentConnection(
      this.server,
      send,
      (record) => this.record(record),
      onFirstMessage,
      (record) => this.record(record)
    );
  }

  /** Hears every call once it is over; returns the way to stop. */
  onCall(listener: (record: AgentCallRecord) => void): () => void {
    this.callListeners.add(listener);
    return () => this.callListeners.delete(listener);
  }

  /**
   * A call into the log: a running one at the bottom, and a finished one in the place of its
   * running record, so a request the tool is still working on is in the log from the moment it
   * arrives and its row does not move when it ends. A running record that arrives after its call
   * has finished is dropped.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.record
   */
  private record(record: AgentCallRecord): void {
    const running = record.outcome.kind === "running";
    this.store.update((state) => {
      const index = state.log.findIndex((one) => one.id === record.id);
      let log: readonly AgentCallRecord[];
      if (index >= 0) {
        if (running) return state;
        log = state.log.map((one, at) => (at === index ? record : one));
      } else {
        log = [...state.log, record];
      }
      if (log.length > AGENT_LOG_LIMIT) log = log.slice(log.length - AGENT_LOG_LIMIT);
      return {
        ...state,
        toolStats: running
          ? state.toolStats
          : { ...state.toolStats, [record.tool]: addToStats(state.toolStats[record.tool], record) },
        log,
      };
    });
    if (!running) for (const listener of this.callListeners) listener(record);
    this.noteActivity();
  }

  /** A call into the log, as a connection would record it. @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.recordForTesting */
  recordForTesting(record: AgentCallRecord): void {
    this.record(record);
  }

  /** When the service stops being active, unless another call comes first. */
  private activityEnd: ReturnType<typeof setTimeout> | undefined;

  /**
   * Active from now, and until {@link AGENT_ACTIVITY_HOLD} after the last running call has ended.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.noteActivity
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.activityEnd
   */
  private noteActivity(): void {
    clearTimeout(this.activityEnd);
    this.activityEnd = undefined;
    if (!this.store.getSnapshot().active)
      this.store.update((state) => ({ ...state, active: true }));
    if (this.store.getSnapshot().log.some(isRunning)) return;
    this.activityEnd = setTimeout(() => {
      this.activityEnd = undefined;
      this.store.update((state) => ({ ...state, active: false }));
    }, AGENT_ACTIVITY_HOLD);
  }

  /** Asks the shell what a client is to be configured with. */
  async loadRelay(): Promise<void> {
    const info = await this.bridge?.info();
    if (info === undefined) return;
    this.store.update((state) => ({
      ...state,
      relay: {
        command: info.command,
        script: info.script,
        environment: info.environment,
        platform: info.platform,
      },
      physicalMemory: info.memory ?? state.physicalMemory,
    }));
    this.applyLimits();
  }

  /** Shows or hides the Agent window. @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.showAgentWindow */
  setWindowOpen(open: boolean): void {
    // The desktop shell's Agent window is a window of its own (D7d), closed by its title bar.
    const own = desktopOwnWindows();
    if (own !== undefined) {
      if (open) own.open("agent");
      return;
    }
    // The window is a pill in the dock and a panel over the panes (`Design/HELP.md`, "Where the
    // book is shown"): open raises it, closed takes the pill away.
    if (open) openAgentPanel();
    else closeAgentPanel();
  }

  /** The menu item's and the button's click: the panel that is up goes, any other comes. */
  toggleWindow(): void {
    if (desktopOwnWindows() !== undefined) {
      this.setWindowOpen(true);
      return;
    }
    this.setWindowOpen(!agentPanelIsUp(workspaceStore.getSnapshot()));
  }

  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.resetToolStats */
  resetToolStats(): void {
    this.store.update((state) => ({ ...state, toolStats: {} }));
  }

  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.clearLog */
  clearLog(): void {
    this.store.update((state) => ({ ...state, log: [] }));
  }
}

/**
 * The page's one service, made when the shell is there to serve through.
 *
 * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.shared
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.agentService
 */
export const agentService = new AgentService();
