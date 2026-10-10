import type { RelayCommand } from "@/core/agent/agentClientConfiguration";
import { AgentConnection } from "@/core/agent/agentConnection";
import { type AgentCallRecord, AgentServer } from "@/core/agent/agentServer";
import type { AgentTool } from "@/core/agent/agentTool";
import {
  type AgentToolEntry,
  type AgentToolGroup,
  type AgentToolKind,
  type AgentToolStats,
  addToStats,
  HOST_GROUPS,
} from "@/core/agent/agentToolCatalogue";
import { type AgentBridge, agentBridge } from "@/platform/desktop/agentBridge";
import { AgentDesk } from "@/state/agent/agentDesk";
import { AgentDiffTools, placeJson } from "@/state/agent/agentDiffTools";
import { AgentDumpTools } from "@/state/agent/agentDumpTools";
import { AgentEditTools } from "@/state/agent/agentEditTools";
import { AgentFindTools } from "@/state/agent/agentFindTools";
import { AgentHostTools } from "@/state/agent/agentHostTools";
import { AgentMarkTools } from "@/state/agent/agentMarkTools";
import { AgentModuleTools } from "@/state/agent/agentModuleTools";
import { AgentRefsTools } from "@/state/agent/agentRefsTools";
import {
  loadAgentSettings,
  rememberAgentEditsAllowed,
  rememberAgentEnabled,
} from "@/state/settingsStore";
import { createStore } from "@/state/store";
import {
  agentPanelIsUp,
  closeAgentPanel,
  openAgentPanel,
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

/** What the Agent window and the status mark show. */
export interface AgentServiceState {
  /** The switch. @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.isEnabled */
  readonly enabled: boolean;
  /** Whether an agent may write into an open file. @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.editsAllowed */
  readonly editsAllowed: boolean;
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
  enabled: false,
  editsAllowed: false,
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
 */
export const AGENT_INSTRUCTIONS =
  "ByteRipper is a hex editor for firmware dumps, open on the person's computer. These tools read the " +
  "files open in it and show places in them to the person. Call `documents` for what is open and " +
  '`focus` for what the person is looking at; when they say "this" or "here", `focus` is what they ' +
  'mean. Addresses and sizes are hex strings such as "0x7F3000" in every answer and may be given ' +
  "back the same way. Ranges are half-open: `end` is the first byte after the range. A list comes in " +
  "pages: `limit` is a ceiling, a page also stops before the answer passes the size bound and says " +
  '`truncated: "size"`, and `next`, passed back as `after`, goes on until it is null. Use `reveal` ' +
  "to point at what you are talking about; the person's Back undoes it. `open_dump` reads a file by " +
  "path without putting it on screen, `survey` asks one tool's question of a whole folder of dumps, and " +
  "`finding` records each thing found for the person to check with a click. `find_bytes` searches the " +
  "bytes for a text or a pattern — inside a compressed section with `node` — `uefi_node_data` reads a " +
  "node's bytes, and `open_part` opens a stretch as a part of its own. `diff` lists where two " +
  "documents differ byte by byte and in which part of the firmware; `compare` shows the two side by " +
  "side and `reveal_diff` walks the person through the differences. `mark` labels bytes for the " +
  "person while you explain them, and `related_to` says how two marks hang together. Nothing here " +
  "saves a file; `write`, the `_fix_checksum` tools and the microcode tools — `microcode_catalogue` " +
  "lists what github.com/platomav/CPUMicrocodes offers, `fit_add_microcode`, `fit_replace_microcode` and " +
  "`fit_remove_microcode` change the FIT — change an open file, one undo step each, and only if the " +
  "person allows edits. " +
  "The `uefi_` tools read a firmware image's structure and work whether or not its panel is open; " +
  "`uefi_select` and `uefi_selection` act on the open UEFI Structure panel, which `open_panel` opens.";

export class AgentService {
  /**
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.didChange
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.log
   */
  readonly store = createStore<AgentServiceState>(INITIAL);
  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.desk */
  readonly desk = new AgentDesk(() => this.bridge);
  readonly hostTools: AgentHostTools;
  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.markTools */
  readonly markTools: AgentMarkTools;
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

  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.init */
  constructor(
    bridge: AgentBridge | undefined = agentBridge(),
    modules: () => readonly ToolModule[] = () => TOOLS
  ) {
    this.bridge = bridge;
    this.modules = modules;
    this.hostTools = new AgentHostTools(this.desk);
    this.markTools = new AgentMarkTools(this.desk);
    this.dumpTools = new AgentDumpTools(this.desk, () => this.bridge);
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
      ...entries(this.markTools.tools(), HOST_GROUPS.marks),
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
   */
  private refreshing(tool: AgentTool): AgentTool {
    return {
      ...tool,
      run: async (call) => {
        for (const name of ["document", "against"]) {
          const id = call.arguments.get(name);
          if (typeof id !== "string") continue;
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
      tools: this.allTools(),
    });
    return this.builtServer;
  }

  // MARK: - The switch

  /** Reads the switches left by the last visit, and opens the endpoint if the service was on. */
  async start(): Promise<void> {
    const settings = await loadAgentSettings();
    this.store.update((state) => ({
      ...state,
      enabled: settings.enabled,
      editsAllowed: settings.editsAllowed,
    }));
    await this.apply();
    void this.loadRelay();
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
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.clients.clear();
    void this.bridge?.setEnabled(false);
    this.store.update((state) => ({
      ...state,
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
    return new AgentConnection(this.server, send, (record) => this.record(record), onFirstMessage);
  }

  /** Hears every call once it is over; returns the way to stop. */
  onCall(listener: (record: AgentCallRecord) => void): () => void {
    this.callListeners.add(listener);
    return () => this.callListeners.delete(listener);
  }

  private record(record: AgentCallRecord): void {
    this.store.update((state) => ({
      ...state,
      toolStats: {
        ...state.toolStats,
        [record.tool]: addToStats(state.toolStats[record.tool], record),
      },
      log:
        state.log.length >= AGENT_LOG_LIMIT
          ? [...state.log.slice(state.log.length - AGENT_LOG_LIMIT + 1), record]
          : [...state.log, record],
    }));
    for (const listener of this.callListeners) listener(record);
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
    }));
  }

  /** Shows or hides the Agent window. @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.showAgentWindow */
  setWindowOpen(open: boolean): void {
    // The window is a pill in the dock and a panel over the panes (`Design/HELP.md`, "Where the
    // book is shown"): open raises it, closed takes the pill away.
    if (open) openAgentPanel();
    else closeAgentPanel();
  }

  /** The menu item's and the button's click: the panel that is up goes, any other comes. */
  toggleWindow(): void {
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
