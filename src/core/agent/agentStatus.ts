import { L } from "@/core/localization/localization";

/**
 * One line on what the service is doing — the same words the Agent window, the Settings tab and
 * the toolbar's mark use.
 *
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.statusText
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.statusText
 */
export function agentStatusText(service: {
  readonly available: boolean;
  readonly failure: string | undefined;
  readonly running: boolean;
  readonly connections: number;
}): string {
  if (!service.available) return L("The agent service is not available in this copy of the app.");
  if (service.failure !== undefined) return L("Could not start: %1$@", service.failure);
  if (!service.running) return L("Switched off.");
  switch (service.connections) {
    case 0:
      return L("Waiting for an agent.");
    case 1:
      return L("One agent connected.");
    default:
      return L("Agents connected: %1$@.", service.connections);
  }
}
