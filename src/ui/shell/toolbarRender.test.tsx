import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { agentService } from "@/state/agent/agentService";
import { Toolbar } from "@/ui/shell/Toolbar";

/**
 * The bar as it is drawn, not only as its model answers: a button that the model
 * greys out has to be handed that answer, and a test of the model alone cannot
 * see a button that is not.
 */

type ToolbarProps = React.ComponentProps<typeof Toolbar>;

/** Every command a no-op: what is asked here is what the bar draws. */
const props = new Proxy(
  { navigation: { previousDifference: false, nextDifference: false } },
  { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined) }
) as unknown as ToolbarProps;

describe("the toolbar on an empty window", () => {
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testViewMenuCarriesTheMinimapToggle
  it("draws the minimap toggle greyed out", () => {
    const html = renderToStaticMarkup(<Toolbar {...props} />);
    const button = html.match(/<button[^>]*aria-label="Toggle Minimap"[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button).toContain("disabled");
  });
});

describe("the Agent button", () => {
  // The dot sits on the Agent button while the service is active, and is gone otherwise.
  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheActivityBadgeBlinksOnTheAgentButton
  it("wears the red dot while an agent is at work", () => {
    const before = agentService.store.getSnapshot();
    try {
      agentService.store.update((state) => ({ ...state, enabled: true, running: true }));
      const agentButton = () =>
        renderToStaticMarkup(<Toolbar {...props} />).match(
          /<button[^>]*aria-label="Agent"[^>]*>.*?<\/button>/
        )?.[0];
      expect(agentButton()).toBeDefined();
      expect(agentButton()).not.toContain("agent-activity-badge");
      agentService.store.update((state) => ({ ...state, active: true }));
      expect(agentButton()).toContain('class="agent-activity-badge"');
    } finally {
      agentService.store.update(() => before);
    }
  });
});
