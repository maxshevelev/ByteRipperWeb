import { describe, expect, it } from "vitest";
import { AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AgentToolError, agentTool, textAnswer } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";

/** Ported from `AgentArgumentsTests.swift`. */

const args = (values: { [key: string]: Json } = {}) => new AgentArguments(values);
const message = (body: () => void): string | undefined => {
  try {
    body();
    return undefined;
  } catch (error) {
    return error instanceof AgentToolError ? error.message : String(error);
  }
};

describe("a tool's arguments", () => {
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentArgumentsTests.swift#AgentArgumentsTests.testAnOffsetIsTakenAsAnIntegerOrAsHexOrDecimalText
  it("takes an offset as an integer, or as hex or decimal text", () => {
    const given = args({ a: 4096, b: "0x7F3000", c: "0X10", d: "1234", e: "0x7F_3000" });
    expect(given.offset("a")).toBe(4096);
    expect(given.offset("b")).toBe(0x7f3000);
    expect(given.offset("c")).toBe(16);
    expect(given.offset("d")).toBe(1234);
    expect(given.offset("e")).toBe(0x7f3000);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentArgumentsTests.swift#AgentArgumentsTests.testABadOffsetSaysWhatWasExpected
  it("says what was expected of a bad offset", () => {
    const given = args({ neg: -1, word: "lots", flag: true });
    expect(message(() => given.offset("neg"))).toBe("Argument `neg`: must not be negative.");
    expect(message(() => given.offset("word"))).toBe(
      'Argument `word`: expected an integer, or a string such as "0x7F3000".'
    );
    expect(message(() => given.offset("flag"))).toBeDefined();
    expect(message(() => given.offset("none"))).toBe("Argument `none` is required.");
  });

  // A null is how some clients write an argument they did not mean to give.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentArgumentsTests.swift#AgentArgumentsTests.testANullArgumentIsAnAbsentOne
  it("takes a null argument for an absent one", () => {
    const given = args({ path: null });
    expect(given.has("path")).toBe(false);
    expect(given.optionalString("path")).toBeUndefined();
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentArgumentsTests.swift#AgentArgumentsTests.testTheLimitIsClampedAndDefaults
  it("clamps the limit and defaults it", () => {
    expect(args().limit(50, 200)).toBe(50);
    expect(args({ limit: 1000 }).limit(50, 200)).toBe(200);
    expect(args({ limit: 0 }).limit(50, 200)).toBe(1);
    expect(args({ limit: 7 }).limit(50, 200)).toBe(7);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentArgumentsTests.swift#AgentArgumentsTests.testAChoiceOutsideTheSetIsRefusedByName
  it("refuses a choice outside the set by name", () => {
    const given = args({ format: "octal" });
    expect(message(() => given.choice("format", ["hex", "ascii"]))).toBe(
      'Argument `format`: expected one of hex, ascii, got "octal".'
    );
    expect(args().choice("format", ["hex", "ascii"], "hex")).toBe("hex");
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentArgumentsTests.swift#AgentArgumentsTests.testAListOfStringsIsReadOrRefusedByName
  it("reads a list of strings or refuses it by name", () => {
    expect(args({ ids: ["m1", "m2"] }).strings("ids")).toEqual(["m1", "m2"]);
    expect(args().strings("ids")).toEqual([]);
    expect(message(() => args({ ids: [1] }).strings("ids"))).toBe(
      "Argument `ids`: expected a list of strings."
    );
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentArgumentsTests.swift#AgentArgumentsTests.testABooleanDefaultsWhenAbsent
  it("defaults a boolean when it is absent", () => {
    expect(args().bool("select", true)).toBe(true);
    expect(args({ select: false }).bool("select", true)).toBe(false);
    expect(message(() => args({ select: "no" }).bool("select", true))).toBeDefined();
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentArgumentsTests.swift#AgentArgumentsTests.testTheSchemaOfAnObjectAllowsNothingElse
  it("describes an object as allowing nothing else", () => {
    const schema = AgentSchema.object({ path: AgentSchema.string("A file.") }, ["path"]) as {
      additionalProperties: Json;
      required: Json;
      properties: { path: { type: Json } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["path"]);
    expect(schema.properties.path.type).toBe("string");
  });
});

describe("arguments a tool does not take", () => {
  const openPart = agentTool({
    name: "open_part",
    description: "Opens a part.",
    inputSchema: AgentSchema.object({
      node: AgentSchema.string("A node."),
      offset: AgentSchema.offset("Where."),
      part: AgentSchema.choice(["all", "body", "decoded"], "Which bytes."),
    }),
    run: async () => textAnswer("opened"),
  });
  const refusal = async (
    tool: ReturnType<typeof agentTool>,
    values: { [key: string]: Json }
  ): Promise<string | undefined> => {
    try {
      await tool.run({
        tool: tool.name,
        arguments: args(values),
        progress: () => undefined,
        signal: { aborted: false },
      });
      return undefined;
    } catch (error) {
      return error instanceof AgentToolError ? error.message : String(error);
    }
  };

  // The case that opened a LENV block still encoded: `decoded` is a value of `part`, and the
  // refusal says so.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentArgumentsTests.swift#AgentArgumentsTests.testAnArgumentThatIsAValueOfAnotherIsRefusedWithWhatWasMeant
  it("refuses an argument that is a value of another with what was meant", async () => {
    expect(await refusal(openPart, { node: "0.3.4.1.2", decoded: true })).toBe(
      '`open_part` takes no argument `decoded`. Perhaps `part: "decoded"`. It takes: node, offset, part.'
    );
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentArgumentsTests.swift#AgentArgumentsTests.testAMisspeltArgumentIsRefusedWithTheNearestName
  it("refuses a misspelt argument with the nearest name", async () => {
    expect(await refusal(openPart, { ofset: "0x10" })).toBe(
      "`open_part` takes no argument `ofset`. Perhaps `offset`. It takes: node, offset, part."
    );
    expect(await refusal(openPart, { colour: "red" })).toBe(
      "`open_part` takes no argument `colour`. It takes: node, offset, part."
    );
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentArgumentsTests.swift#AgentArgumentsTests.testTheArgumentsAToolTakesAreLetThrough
  it("lets the arguments a tool takes through", async () => {
    expect(await refusal(openPart, { node: "0.1", part: "decoded" })).toBeUndefined();
    const bare = agentTool({
      name: "documents",
      description: "Lists.",
      run: async () => textAnswer("none"),
    });
    expect(await refusal(bare, { limit: 5 })).toBe(
      "`documents` takes no argument `limit`. It takes no arguments."
    );
  });
});
