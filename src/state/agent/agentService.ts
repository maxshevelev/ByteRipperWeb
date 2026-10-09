import type { RelayCommand } from "@/core/agent/agentClientConfiguration";
import { AgentConnection } from "@/core/agent/agentConnection";
import { type AgentCallRecord, AgentServer } from "@/core/agent/agentServer";
import type { AgentTool } from "@/core/agent/agentTool";
import { type AgentBridge, agentBridge } from "@/platform/desktop/agentBridge";
import { AgentDesk } from "@/state/agent/agentDesk";
import { AgentHostTools } from "@/state/agent/agentHostTools";
import {
  loadAgentSettings,
  rememberAgentEditsAllowed,
  rememberAgentEnabled,
} from "@/state/settingsStore";
import { createStore } from "@/state/store";
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
   * Whether the Agent window is up.
   *
   * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController
   * @web-only a panel of the page; there are no windows
   */
  readonly windowOpen: boolean;
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
  windowOpen: false,
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
  "to point at what you are talking about; the person's Back undoes it.";

export class AgentService {
  /**
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.didChange
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.log
   */
  readonly store = createStore<AgentServiceState>(INITIAL);
  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.desk */
  readonly desk = new AgentDesk();
  readonly hostTools: AgentHostTools;
  private bridge: AgentBridge | undefined;
  private readonly connections = new Map<number, AgentConnection>();
  private unsubscribe: (() => void)[] = [];
  private builtServer: AgentServer | undefined;
  private callListeners = new Set<(record: AgentCallRecord) => void>();

  /** @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.init */
  constructor(bridge: AgentBridge | undefined = agentBridge()) {
    this.bridge = bridge;
    this.hostTools = new AgentHostTools(this.desk);
  }

  /** Whether there is a shell to serve through; a browser has none, and no agent. */
  get isAvailable(): boolean {
    return this.bridge !== undefined;
  }

  /**
   * Every tool, in the order `tools/list` gives them.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.allTools
   */
  allTools(): AgentTool[] {
    return [...this.hostTools.tools()];
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
      this.connect((line) => bridge.send(id, line))
    );
    this.store.update((state) => ({ ...state, connections: this.connections.size }));
  }

  private release(id: number): void {
    this.connections.get(id)?.close();
    if (!this.connections.delete(id)) return;
    this.store.update((state) => ({ ...state, connections: this.connections.size }));
  }

  /**
   * A connection to the service over whatever carries the bytes — the shell's pipe, or a test's
   * own.
   *
   * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.connect
   */
  connect(send: (line: Uint8Array) => void): AgentConnection {
    return new AgentConnection(this.server, send, (record) => this.record(record));
  }

  /** Hears every call once it is over; returns the way to stop. */
  onCall(listener: (record: AgentCallRecord) => void): () => void {
    this.callListeners.add(listener);
    return () => this.callListeners.delete(listener);
  }

  private record(record: AgentCallRecord): void {
    this.store.update((state) => ({
      ...state,
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
    this.store.update((state) => ({ ...state, windowOpen: open }));
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
