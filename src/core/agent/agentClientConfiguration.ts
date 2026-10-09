import { prettyText } from "@/core/agent/json";
import { L } from "@/core/localization/localization";

/**
 * What an agent's client is configured with to reach this copy of the app: the app's own
 * executable, run as Node over the relay script, by their real paths — so a copy of the app moved
 * to another folder hands out its own.
 *
 * Every client is told the same things — a name, the stdio transport, the command, its argument and
 * its environment — and each wants them in its own form: a command, a JSON block for a file, or
 * fields in a settings screen.
 *
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentClientConfiguration
 * @upstream-differs the command is the executable with the relay script as its argument and
 * `ELECTRON_RUN_AS_NODE` in its environment, where upstream's is a helper inside the bundle
 */

/** The name the server is registered under in every client. @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentClientConfiguration.serverName */
export const AGENT_SERVER_NAME = "byteripper";

/** What the shell says of the relay a client launches (`desktop/agent.cjs`). */
export interface RelayCommand {
  readonly command: string;
  readonly script: string;
  readonly environment: { readonly [key: string]: string };
  readonly platform: string;
}

/**
 * The kinds of client, in the order the menu lists them.
 *
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentClientConfiguration.Client
 */
export const AGENT_CLIENTS = ["claudeCode", "claudeDesktop", "cursor", "other"] as const;
export type AgentClient = (typeof AGENT_CLIENTS)[number];

/** The name in the client menu. Product names, except the last. @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentClientConfiguration.Client.title */
export function clientTitle(client: AgentClient): string {
  switch (client) {
    case "claudeCode":
      return "Claude Code";
    case "claudeDesktop":
      return "Claude Desktop";
    case "cursor":
      return "Cursor";
    case "other":
      return L("Other Client");
  }
}

const onWindows = (relay: RelayCommand) => relay.platform === "win32";

/**
 * Where the text goes, said above the preview.
 *
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentClientConfiguration.Client.destination
 */
export function clientDestination(client: AgentClient, relay: RelayCommand): string {
  switch (client) {
    case "claudeCode":
      return L(
        "Run this command once in a terminal. It adds ByteRipper to Claude Code for every folder."
      );
    case "claudeDesktop":
      return L(
        "Add this to Claude Desktop's configuration file, %1$@, and restart Claude Desktop.",
        onWindows(relay)
          ? "%APPDATA%\\Claude\\claude_desktop_config.json"
          : "~/Library/Application Support/Claude/claude_desktop_config.json"
      );
    case "cursor":
      return L(
        "Add this to Cursor's configuration file, %1$@, for every project — or to %2$@ in one project.",
        onWindows(relay) ? "%USERPROFILE%\\.cursor\\mcp.json" : "~/.cursor/mcp.json",
        ".cursor/mcp.json"
      );
    case "other":
      return L("Enter these parameters in the client's MCP server settings.");
  }
}

/** A path quoted for the shell: double quotes on Windows, single elsewhere. */
function quoted(path: string, relay: RelayCommand): string {
  return onWindows(relay)
    ? `"${path.replaceAll('"', '\\"')}"`
    : `'${path.replaceAll("'", "'\\''")}'`;
}

const environmentPairs = (relay: RelayCommand): string[] =>
  Object.entries(relay.environment).map(([key, value]) => `${key}=${value}`);

/**
 * The text for `client`, naming the relay.
 *
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentClientConfiguration.text
 */
export function clientText(client: AgentClient, relay: RelayCommand): string {
  switch (client) {
    case "claudeCode": {
      // User scope: a technician talks to the app from whatever folder they are in.
      const environment = environmentPairs(relay)
        .map((pair) => `--env ${pair} `)
        .join("");
      return `claude mcp add --scope user ${environment}${AGENT_SERVER_NAME} -- ${quoted(relay.command, relay)} ${quoted(relay.script, relay)}`;
    }
    case "claudeDesktop":
    case "cursor":
      // The two read the same block. A file that already lists servers takes the inner entry
      // beside them.
      return prettyText({
        mcpServers: {
          [AGENT_SERVER_NAME]: {
            command: relay.command,
            args: [relay.script],
            env: { ...relay.environment },
          },
        },
      });
    case "other": {
      const rows: [string, string][] = [
        [L("Name"), AGENT_SERVER_NAME],
        [L("Transport"), "stdio"],
        [L("Command"), relay.command],
        [L("Arguments"), relay.script],
        [L("Environment"), environmentPairs(relay).join(" ") || L("none")],
      ];
      const width = Math.max(...rows.map(([label]) => label.length));
      return rows.map(([label, value]) => `${label.padEnd(width, " ")}  ${value}`).join("\n");
    }
  }
}
