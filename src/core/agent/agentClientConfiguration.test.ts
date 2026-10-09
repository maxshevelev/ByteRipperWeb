import { describe, expect, it } from "vitest";
import {
  AGENT_CLIENTS,
  clientDestination,
  clientText,
  clientTitle,
  type RelayCommand,
} from "@/core/agent/agentClientConfiguration";
import { parseJson } from "@/core/agent/json";

const windows: RelayCommand = {
  command: "C:\\Users\\bench\\AppData\\Local\\Programs\\ByteRipper\\ByteRipper.exe",
  script:
    "C:\\Users\\bench\\AppData\\Local\\Programs\\ByteRipper\\resources\\app.asar.unpacked\\relay.cjs",
  environment: { ELECTRON_RUN_AS_NODE: "1" },
  platform: "win32",
};
const mac: RelayCommand = {
  command: "/Applications/My Tools/ByteRipper.app/Contents/MacOS/ByteRipper",
  script: "/Applications/My Tools/ByteRipper.app/Contents/Resources/relay.cjs",
  environment: { ELECTRON_RUN_AS_NODE: "1" },
  platform: "darwin",
};

describe("a client's configuration", () => {
  // Every client is told the same things in its own form.
  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheTabPreviewsEachClientsConfiguration
  it("names the executable and the relay for every client", () => {
    for (const client of AGENT_CLIENTS) {
      const text = clientText(client, windows);
      const json = client === "claudeDesktop" || client === "cursor";
      expect(text).toContain(json ? windows.command.replaceAll("\\", "\\\\") : windows.command);
      expect(text).toContain("byteripper");
      expect(text).toContain("ELECTRON_RUN_AS_NODE");
    }
  });

  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheClaudeCodeCommandNamesTheRelayQuotedForTheShell
  it("quotes the Claude Code command for the shell of the platform", () => {
    expect(clientText("claudeCode", windows)).toBe(
      `claude mcp add --scope user --env ELECTRON_RUN_AS_NODE=1 byteripper -- "${windows.command}" "${windows.script}"`
    );
    expect(clientText("claudeCode", mac)).toBe(
      `claude mcp add --scope user --env ELECTRON_RUN_AS_NODE=1 byteripper -- '${mac.command}' '${mac.script}'`
    );
  });

  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testClaudeDesktopAndCursorGetTheSameJSONBlockOneMemberPerLine
  it("writes the block Claude Desktop and Cursor read as JSON with the entry under mcpServers", () => {
    for (const client of ["claudeDesktop", "cursor"] as const) {
      expect(parseJson(clientText(client, windows))).toEqual({
        mcpServers: {
          byteripper: {
            command: windows.command,
            args: [windows.script],
            env: { ELECTRON_RUN_AS_NODE: "1" },
          },
        },
      });
    }
  });

  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testAnOtherClientIsGivenTheParametersOneByOne
  it("lists the parameters one by one for another client", () => {
    const rows = clientText("other", windows).split("\n");
    expect(rows.map((row) => row.split("  ")[0]?.trim())).toEqual([
      "Name",
      "Transport",
      "Command",
      "Arguments",
      "Environment",
    ]);
    expect(rows[1]).toMatch(/stdio$/);
  });

  it("says where the file is on the platform it runs on", () => {
    expect(clientDestination("claudeDesktop", windows)).toContain(
      "%APPDATA%\\Claude\\claude_desktop_config.json"
    );
    expect(clientDestination("claudeDesktop", mac)).toContain(
      "~/Library/Application Support/Claude"
    );
    expect(clientDestination("cursor", windows)).toContain("%USERPROFILE%\\.cursor\\mcp.json");
    expect(AGENT_CLIENTS.map(clientTitle)).toEqual([
      "Claude Code",
      "Claude Desktop",
      "Cursor",
      "Other Client",
    ]);
  });
});
