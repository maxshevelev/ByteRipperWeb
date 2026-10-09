import { useState } from "react";
import {
  AGENT_CLIENTS,
  type AgentClient,
  clientDestination,
  clientText,
  clientTitle,
} from "@/core/agent/agentClientConfiguration";
import { agentStatusText } from "@/core/agent/agentStatus";
import { L } from "@/core/localization/localization";
import { agentService } from "@/state/agent/agentService";
import { useStore } from "@/state/useStore";

/**
 * The Agent tab of the Settings window: the switch that opens the agent endpoint, what it does,
 * whether it is running, and what each kind of client is configured with — shown in full before it
 * is copied, so the person sees the form the text is in and where it goes.
 *
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.service
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.loadView
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.refresh
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.client
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.showClient
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.clientChanged
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.copyConfiguration
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.editsChanged
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.enableChanged
 * @upstream-differs a React tab over the service's store
 */
// help: settings.agent
export function AgentTab() {
  const state = useStore(agentService.store);
  const [client, setClient] = useState<AgentClient>("claudeCode");
  const [copied, setCopied] = useState(false);
  const status = copied
    ? L("Copied.")
    : agentStatusText({
        available: agentService.isAvailable,
        failure: state.failure,
        running: state.running,
        connections: state.connections,
      });
  const relay = state.relay;

  return (
    <section className="settings-agent">
      <h3 className="settings-heading">{L("Agent")}</h3>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={!agentService.isAvailable}
          onChange={(event) => void agentService.setEnabled(event.target.checked)}
        />
        {L("Let agents connect to ByteRipper")}
      </label>
      <p className="settings-caption">
        {L(
          "An agent — Claude Code, Claude Desktop or another MCP client on this computer — can then list the files open here, read their bytes and show places in them. It cannot save a file. The connection is local, but what the agent reads, its program passes to the model behind it."
        )}
      </p>
      <p
        className={
          state.failure === undefined ? "settings-caption" : "settings-caption settings-bad"
        }
        role="status"
      >
        {status}
      </p>

      {/* help: settings.agent.edits */}
      <label className="settings-check">
        <input
          type="checkbox"
          checked={state.editsAllowed}
          disabled={!agentService.isAvailable}
          onChange={(event) => agentService.setEditsAllowed(event.target.checked)}
        />
        {L("Let agents edit open files")}
      </label>
      <p className="settings-caption">
        {L(
          "An agent's edit goes into the open file as one step of its undo and shows red until the file is saved, like an edit made by hand. Saving stays with you. A file opened read-only is never changed."
        )}
      </p>

      <div className="settings-row">
        <label htmlFor="settings-agent-client" className="settings-label">
          {L("Configuration for:")}
        </label>
        <select
          id="settings-agent-client"
          className="settings-select"
          value={client}
          title={L("The program the agent runs in, whose configuration is shown below")}
          onChange={(event) => {
            setClient(event.target.value as AgentClient);
            setCopied(false);
          }}
        >
          {AGENT_CLIENTS.map((one) => (
            <option key={one} value={one}>
              {clientTitle(one)}
            </option>
          ))}
        </select>
      </div>
      {relay === undefined ? null : (
        <>
          <p className="settings-caption">{clientDestination(client, relay)}</p>
          <pre className="settings-agent-preview" tabIndex={0} aria-label={L("Configuration text")}>
            {clientText(client, relay)}
          </pre>
          <div className="settings-actions">
            <button
              type="button"
              title={L("Copy the text above to the clipboard")}
              onClick={() => {
                void navigator.clipboard.writeText(clientText(client, relay)).then(() => {
                  setCopied(true);
                });
              }}
            >
              {L("Copy")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
