import { afterEach, describe, expect, it } from "vitest";
import { dismissAlert, reportAlert, workspaceStore } from "@/state/workspaceStore";
import { alertOutcomeIcon } from "@/ui/dialogs/alertOutcomeIcon";

/**
 * The outcome an alert carries and the icon it wears for it. Upstream reads the
 * outcome back from the controller (`lastAlertOutcome`) in its flow tests; the
 * web's level is the store the dialog is drawn from.
 */
describe("an alert's outcome", () => {
  afterEach(dismissAlert);

  it("is kept with the title and the message", () => {
    reportAlert("Updated “bios.bin”", "⌘Z takes it back.", "success");
    expect(workspaceStore.getSnapshot().alert).toEqual({
      title: "Updated “bios.bin”",
      message: "⌘Z takes it back.",
      outcome: "success",
    });

    reportAlert("“body” cannot be put back", "Nothing was changed.", "problem");
    expect(workspaceStore.getSnapshot().alert?.outcome).toBe("problem");
  });

  it("is none for an alert that only informs", () => {
    reportAlert("Could not open file.", "This file could not be opened.");
    expect(workspaceStore.getSnapshot().alert?.outcome).toBeUndefined();
  });

  it("wears a green check for what was done and a filled red octagon for what was refused", () => {
    expect(alertOutcomeIcon("success")).toEqual({
      name: "checkmark.circle",
      color: "var(--semantic-good)",
    });
    expect(alertOutcomeIcon("problem")).toEqual({
      name: "exclamationmark.octagon.fill",
      color: "var(--semantic-bad)",
    });
  });
});
