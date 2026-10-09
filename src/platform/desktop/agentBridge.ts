/**
 * The agent service's end of the Electron shell's bridge (`desktop/preload.cjs`,
 * `Design/PORT_AGENT.md`): the connections an agent's relay makes, as bytes in and out, and the
 * machine's files by path. A browser has none, and then there is no agent.
 *
 * @web-only the desktop shell's; upstream has Foundation's sockets and files
 */

/** What a client is configured with: the app's own executable run as Node over the relay. */
export interface AgentRelayInfo {
  /** Where the app listens. */
  readonly endpoint: string;
  /** The executable the client launches. */
  readonly command: string;
  /** The relay script, its argument. */
  readonly script: string;
  /** The environment the client sets for it. */
  readonly environment: { readonly [key: string]: string };
  readonly platform: string;
}

export type AgentFileRequest =
  | { readonly op: "stat"; readonly path: string }
  | { readonly op: "list"; readonly path: string; readonly recursive?: boolean }
  | {
      readonly op: "read";
      readonly path: string;
      readonly offset: number;
      readonly length: number;
    };

export interface AgentFileStat {
  readonly path: string;
  readonly size: number;
  /** Milliseconds since the epoch. */
  readonly modified: number;
  readonly isDirectory: boolean;
}

export interface AgentBridge {
  /** Opens or closes the endpoint; says whether it opened, and why not. */
  setEnabled(on: boolean): Promise<{
    readonly ok: boolean;
    readonly endpoint?: string;
    readonly error?: string;
  }>;
  info(): Promise<AgentRelayInfo | undefined>;
  onConnection(callback: (id: number) => void): () => void;
  onData(callback: (id: number, bytes: Uint8Array) => void): () => void;
  onClose(callback: (id: number) => void): () => void;
  send(id: number, bytes: Uint8Array): void;
  end(id: number): void;
  file(request: { readonly op: "stat"; readonly path: string }): Promise<AgentFileStat>;
  file(request: {
    readonly op: "list";
    readonly path: string;
    readonly recursive?: boolean;
  }): Promise<{ readonly files: readonly string[]; readonly truncated: boolean }>;
  file(request: {
    readonly op: "read";
    readonly path: string;
    readonly offset: number;
    readonly length: number;
  }): Promise<Uint8Array>;
}

/** The bridge, where the page runs in the desktop shell; nothing in a browser. */
export function agentBridge(): AgentBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as { byteripperDesktop?: { agent?: AgentBridge } }).byteripperDesktop?.agent;
}
