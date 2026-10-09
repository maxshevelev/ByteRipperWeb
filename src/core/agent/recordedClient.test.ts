import { describe, expect, it } from "vitest";
import { AgentConnection } from "@/core/agent/agentConnection";
import { AgentServer } from "@/core/agent/agentServer";
import { agentTool, jsonAnswer } from "@/core/agent/agentTool";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";

/**
 * What a real client sends, recorded off the relay and played back: Claude Code 2.1.292 against
 * the app's first four tools. It speaks the modern era — `server/discover` first, then `_meta`
 * on every request, with a key of its own (`claudecode/toolUseId`) and a progress token on each
 * call.
 *
 * The test that earns its place here is the first one: this client validates the answer to
 * `tools/list`, and one without `ttlMs` and `cacheScope` left it with no tools at all while
 * every hand-written transcript passed.
 *
 * Ported from `RecordedClientTests.swift`.
 */

const CLIENT_INFO =
  '"io.modelcontextprotocol/clientInfo":{"name":"claude-code","title":"Claude Code","version":"2.1.292","description":"Anthropic\'s agentic coding tool","websiteUrl":"https://claude.com/claude-code"}';
const META_BASE = `"io.modelcontextprotocol/protocolVersion":"2026-07-28",${CLIENT_INFO},"io.modelcontextprotocol/clientCapabilities":{"roots":{"listChanged":true},"elicitation":{"form":{},"url":{}}}`;
const callMeta = (toolUse: string, token: number) =>
  `"_meta":{${META_BASE},"claudecode/toolUseId":"${toolUse}","progressToken":${token}}`;

const CLAUDE_CODE = [
  `{"jsonrpc":"2.0","id":"server-discover-probe-1","method":"server/discover","params":{"_meta":{${META_BASE}}}}`,
  `{"method":"tools/list","jsonrpc":"2.0","id":0,"params":{"_meta":{${META_BASE}}}}`,
  `{"method":"tools/call","params":{"name":"documents","arguments":{},${callMeta("toolu_01DguNc98zmrUdUQuFHn4ws8", 1)}},"jsonrpc":"2.0","id":1}`,
  `{"method":"tools/call","params":{"name":"read","arguments":{"offset":"0x0","length":16,"format":"ascii"},${callMeta("toolu_01ANfKDh9HV2RTKhoohMNEpx", 2)}},"jsonrpc":"2.0","id":2}`,
  `{"method":"tools/call","params":{"name":"reveal","arguments":{"offset":"0x10","length":"0x10"},${callMeta("toolu_01MrUnVX15Q67jQmxNjtWkUr", 3)}},"jsonrpc":"2.0","id":3}`,
];

const stub = (name: string) =>
  agentTool({
    name,
    description: "Stands in for the app's own.",
    run: async (call) =>
      jsonAnswer({
        tool: call.tool,
        length: (call.arguments.values.length as Json | undefined) ?? null,
      }),
  });

async function play(): Promise<Json[]> {
  const output: string[] = [];
  const server = new AgentServer({
    info: { name: "byteripper", version: "0.9.1" },
    tools: ["documents", "focus", "read", "reveal"].map(stub),
  });
  const connection = new AgentConnection(server, (line) => output.push(decodeUtf8(line)));
  for (const line of CLAUDE_CODE) connection.receive(encodeUtf8(`${line}\n`));
  await connection.waitUntilIdle();
  return output
    .join("")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => parseJson(line));
}

describe("a recorded Claude Code session", () => {
  // @upstream Packages/AgentKit/Tests/AgentKitTests/RecordedClientTests.swift#RecordedClientTests.testEveryRequestIsAnsweredAsTheModernEraRequires
  it("answers every request as the modern era requires", async () => {
    const replies = await play();
    expect(replies.map((one) => member(one, "id"))).toEqual([
      "server-discover-probe-1",
      0,
      1,
      2,
      3,
    ]);
    for (const reply of replies) {
      expect(member(reply, "error")).toBeUndefined();
      expect(member(member(reply, "result"), "resultType")).toBe("complete");
      expect(
        member(
          member(member(member(reply, "result"), "_meta"), "io.modelcontextprotocol/serverInfo"),
          "name"
        )
      ).toBe("byteripper");
    }
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/RecordedClientTests.swift#RecordedClientTests.testTheDiscoveryAndTheListCarryTheCacheHintsThisClientRequires
  it("carries the cache hints this client requires on the discovery and the list", async () => {
    const replies = await play();
    for (const reply of replies.slice(0, 2)) {
      expect(typeof member(member(reply, "result"), "ttlMs")).toBe("number");
      expect(typeof member(member(reply, "result"), "cacheScope")).toBe("string");
    }
    expect((member(member(replies[1], "result"), "tools") as Json[]).length).toBe(4);
  });

  // The model wrote a length in hex, as a string — which is why every address argument takes one.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/RecordedClientTests.swift#RecordedClientTests.testTheCallsReachTheToolsWithTheirArgumentsAsWritten
  it("hands the calls to the tools with their arguments as written", async () => {
    const replies = await play();
    const texts = replies
      .slice(-3)
      .map((one) => member((member(member(one, "result"), "content") as Json[])[0], "text"));
    expect(texts).toEqual([
      '{"length":null,"tool":"documents"}',
      '{"length":16,"tool":"read"}',
      '{"length":"0x10","tool":"reveal"}',
    ]);
  });
});
