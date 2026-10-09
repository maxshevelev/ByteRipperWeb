import type { Json } from "@/core/agent/json";

/**
 * The versions of the Model Context Protocol this server speaks, and the error codes it
 * answers with.
 *
 * MCP changed shape in `2026-07-28`. Before it, a connection opened with an `initialize`
 * handshake that fixed the version and the client's capabilities for as long as the
 * connection lasted — the *legacy* era. From it, there is no handshake: every request carries
 * its version and the client's capabilities in `_meta`, and the server holds nothing between
 * requests — the *modern* era. Clients of both kinds are in use at once, so this server
 * speaks both, as the specification allows: a request with the modern `_meta` is served as
 * modern, an `initialize` starts a legacy connection.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPEra
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.Meta
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.Meta.clientCapabilities
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.Meta.clientInfo
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.Meta.progressToken
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.Meta.protocolVersion
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.Meta.serverInfo
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#AgentServerInfo.init
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#AgentServerInfo.name
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#AgentServerInfo.title
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#AgentServerInfo.version
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#RPCError
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#RPCError.code
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#RPCError.data
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#RPCError.invalidParams
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#RPCError.json
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#RPCError.message
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#RPCMessage
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#RPCMessage.error
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#RPCMessage.notification
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#RPCMessage.result
 */
export const MCPProtocol = {
  /** @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.modernVersions */
  modernVersions: ["2026-07-28"] as readonly string[],
  /** @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.legacyVersions */
  legacyVersions: ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as readonly string[],
  /**
   * How long a client may keep the answer to `server/discover` and `tools/list` before asking
   * again. The list is fixed while the app runs; five minutes is so that a newer build of the
   * app, started under a client that stayed open, is listed without the client having to be
   * restarted.
   *
   * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.listTTLMilliseconds
   */
  listTTLMilliseconds: 300_000,
} as const;

/** @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.supportedVersions */
export const supportedVersions = (): string[] => [
  ...MCPProtocol.modernVersions,
  ...MCPProtocol.legacyVersions,
];

/** The `_meta` keys of a modern request. */
export const Meta = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientInfo: "io.modelcontextprotocol/clientInfo",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
  serverInfo: "io.modelcontextprotocol/serverInfo",
  progressToken: "progressToken",
} as const;

/**
 * JSON-RPC's own codes, and the one MCP code this server sends.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.ErrorCode
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.ErrorCode.internalError
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.ErrorCode.invalidParams
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.ErrorCode.invalidRequest
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.ErrorCode.methodNotFound
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.ErrorCode.parseError
 * @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#MCPProtocol.ErrorCode.unsupportedProtocolVersion
 */
export const ErrorCode = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Modern only: the request names a version this server does not speak. `data` lists the ones it does. */
  unsupportedProtocolVersion: -32022,
} as const;

/** Who the server says it is, in `initialize`, in `server/discover`, and in the `_meta` of every modern answer. */
export interface AgentServerInfo {
  readonly name: string;
  readonly version: string;
  readonly title?: string | undefined;
}

/** @upstream Packages/AgentKit/Sources/AgentKit/MCPProtocol.swift#AgentServerInfo.json */
export const serverInfoJson = (info: AgentServerInfo): Json =>
  info.title === undefined
    ? { name: info.name, version: info.version }
    : { name: info.name, version: info.version, title: info.title };

/** A JSON-RPC error answer, before it is written. */
export class RPCError extends Error {
  readonly code: number;
  readonly data: Json | undefined;

  constructor(code: number, message: string, data?: Json) {
    super(message);
    this.code = code;
    this.data = data;
  }

  get json(): Json {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }

  static invalidParams(message: string): RPCError {
    return new RPCError(ErrorCode.invalidParams, message);
  }
}

/** The messages the server writes. */
export const RPCMessage = {
  result: (id: Json, result: Json): Json => ({ jsonrpc: "2.0", id, result }),
  error: (id: Json, error: RPCError): Json => ({ jsonrpc: "2.0", id, error: error.json }),
  notification: (method: string, params: Json): Json => ({ jsonrpc: "2.0", method, params }),
};
