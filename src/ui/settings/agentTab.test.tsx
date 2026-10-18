import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { agentService } from "@/state/agent/agentService";
import { AgentTab } from "@/ui/settings/AgentTab";
import { memoryTitle } from "@/ui/settings/settingsText";

/** The option a select shows as chosen, by the select's id. */
function shown(html: string, id: string): string | undefined {
  const select = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>(.*?)</select>`))?.[1];
  return select?.match(/<option[^>]*selected=""[^>]*>([^<]*)<\/option>/)?.[1];
}

describe("Settings ▸ Agent", () => {
  // The two bounds on the dumps an agent opened by path: shown as kept, and a choice is kept.
  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheTabSetsTheBoundsOnDumpsOpenedByPath
  // @upstream-differs a choice is made through the service, a page rendered to markup having no
  // control to pick from
  it("sets the bounds on dumps opened by path", () => {
    const before = agentService.store.getSnapshot();
    let html = renderToStaticMarkup(<AgentTab />);
    expect(shown(html, "settings-agent-files")).toBe(`${before.backgroundFileLimit}`);
    expect(shown(html, "settings-agent-memory")).toBe(memoryTitle(before.backgroundMemoryLimitMiB));

    agentService.setBackgroundFileLimit(32);
    agentService.setBackgroundMemoryLimitMiB(512);
    html = renderToStaticMarkup(<AgentTab />);
    expect(shown(html, "settings-agent-files")).toBe("32");
    expect(shown(html, "settings-agent-memory")).toBe("512 MB");
    expect(agentService.desk.background.memoryLimit).toBe(512 << 20);
  });

  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheTabSetsTheBoundsOnDumpsOpenedByPath
  it("names a memory bound in the units memory is told in", () => {
    expect(memoryTitle(256)).toBe("256 MB");
    expect(memoryTitle(1024)).toBe("1 GB");
    expect(memoryTitle(16384)).toBe("16 GB");
  });
});
