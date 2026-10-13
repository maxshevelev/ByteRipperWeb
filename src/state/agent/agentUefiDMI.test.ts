import { afterEach, describe, expect, it } from "vitest";
import { type Json, member } from "@/core/agent/json";
import { loadCatalogue } from "@/core/localization/bundledCatalogues";
import { forgetCatalogues, installCatalogue, L } from "@/core/localization/localization";
import { discardAnnotationsForTesting } from "@/state/agent/agentAnnotationStore";
import { setUpFirmwareAgent } from "@/state/testing/firmwareAgent";
import {
  compressedTestImage,
  fitTestImage,
  LENOVO,
  uefiTestImage,
} from "@/state/testing/firmwareImages";

/**
 * `uefi_dmi` — the DMI areas as the UEFI Structure panel's DMI button finds them — and the rule that
 * no answer an agent gets speaks the window's language, over the real worker (`firmwareAgent`).
 *
 * @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests
 */

const agent = setUpFirmwareAgent();
const { call, open } = agent;

afterEach(() => {
  forgetCatalogues();
});

async function answer(name: string, args: { [key: string]: Json } = {}): Promise<Json> {
  const answered = await call(name, args);
  if (answered.isError) throw new Error(`${name} was refused: ${answered.text}`);
  return answered.json as Json;
}

describe("uefi_dmi", () => {
  // The DMI area is answered where the panel's DMI button finds it, with what the panel says
  // about it.
  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testTheDMIAreaIsTheStoreTheDMIButtonFinds
  it("answers the store the DMI button finds", async () => {
    open(LENOVO.make());
    const found = await answer("uefi_dmi");
    expect(member(found, "total")).toBe(1);
    const area = (member(found, "areas") as Json[])[0];
    expect(member(area, "layout")).toBe("Lenovo DMI store");
    // Where the Lenovo test image lays its log.
    expect(member(area, "start")).toBe("0x1000");
    expect(member(area, "size")).toBe("0x4000");
    // The panel's detail comes with it.
    expect((member(area, "fields") as Json[]).length).toBeGreaterThan(0);
    const node = await answer("uefi_node", { node: member(area, "id") as string });
    // The id is the tree's.
    expect(member(member(node, "node"), "start")).toBe("0x1000");
    expect(member(member(node, "node"), "end")).toBe("0x5000");
  });

  // A dump the parser finds no DMI area in is not said to have none: the answer and the tool's
  // description both say the search knows only some layouts.
  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testNoDMIAreaFoundIsNotNoDMIArea
  it("says an area not found is not an area absent", async () => {
    open(uefiTestImage());
    const found = await answer("uefi_dmi");
    expect(member(found, "total")).toBe(0);
    expect(member(found, "areas")).toEqual([]);
    expect(String(member(found, "note"))).toContain("is not therefore absent from the dump");
    const tool = agent.service.allTools().find((one) => one.name === "uefi_dmi");
    expect(tool?.description).toContain("is not therefore absent from the dump");
    expect(tool?.description).toContain("never that the dump has no DMI");
  });
});

describe("the agent's language", () => {
  // The window speaks Russian; every answer an agent gets is English all the same — the tree
  // walked node by node, the checksums, the variables, the nameless areas, the DMI area, a search,
  // an annotation, the FIT and the ME.
  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testNoAnswerSpeaksTheWindowsLanguage
  // @upstream-differs the web keeps English with a synchronous scope (`withEnglish`), which no
  // render can fall inside, where upstream names the language at every call; the images are the
  // ones the web's harness has
  it("is never the window's", async () => {
    installCatalogue(await loadCatalogue("ru"));
    expect(L("Free space")).toBe("Свободное место");
    let asked = 0;
    for (const bytes of [
      uefiTestImage(),
      LENOVO.make(),
      compressedTestImage("SECRET-MODEL-GH51G"),
      fitTestImage(0x42),
    ]) {
      open(bytes);
      const answers: [string, string][] = [];
      const ask = async (tool: string, args: { [key: string]: Json } = {}) => {
        const answered = await call(tool, args);
        answers.push([`${tool} ${JSON.stringify(args)}`, answered.text]);
        asked += 1;
        return answered;
      };
      const queue: (string | undefined)[] = [undefined];
      const seen = new Set<string>();
      while (queue.length > 0 && seen.size < 300) {
        const next = queue.shift();
        const tree = await ask("uefi_tree", next === undefined ? {} : { node: next });
        const children = (member(tree.json ?? null, "children") as Json[] | undefined) ?? [];
        for (const child of children) {
          const id = member(child, "id");
          if (typeof id !== "string" || seen.has(id)) continue;
          seen.add(id);
          await ask("uefi_node", { node: id });
          if (member(child, "children") !== undefined) queue.push(id);
        }
      }
      await ask("uefi_at", { offset: "0x28" });
      await ask("uefi_checksums");
      await ask("variables");
      await ask("region_scan");
      await ask("uefi_dmi");
      await ask("find_bytes", { text: "MODEL", node: "root" });
      await ask("annotate", { offset: "0x28", length: 4, title: "Signature" });
      await ask("annotations");
      await ask("fit_table");
      await ask("fit_table", { entry: 1 });
      await ask("me_summary");
      await ask("me_tree");
      for (const [question, text] of answers) {
        expect(/\p{Script=Cyrillic}/u.test(text), `${question}: ${text.slice(0, 400)}`).toBe(false);
      }
      discardAnnotationsForTesting();
    }
    // The walk asked enough to mean something.
    expect(asked).toBeGreaterThan(30);
  });
});
