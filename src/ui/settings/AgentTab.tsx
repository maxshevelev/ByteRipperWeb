import { useState } from "react";
import { BACKGROUND_FILE_CHOICES } from "@/core/agent/agentBackgroundLimits";
import {
  AGENT_CLIENTS,
  type AgentClient,
  clientDestination,
  clientText,
  clientTitle,
} from "@/core/agent/agentClientConfiguration";
import { agentStatusText } from "@/core/agent/agentStatus";
import { TOPIC, topicLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import { friendlySize } from "@/core/text/byteSize";
import { agentService } from "@/state/agent/agentService";
import { useStore } from "@/state/useStore";
import { HelpButton } from "@/ui/help/HelpButton";

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
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.launchChanged
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.filesChanged
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.memoryChanged
 * @upstream-differs a React tab over the service's store
 */
/**
 * "256 MB", "1 GB": in the units the machine's own memory is told in.
 *
 * @upstream ByteRipperApp/Settings/AgentSettings.swift#AgentSettingsViewController.memoryTitle
 */
export const memoryTitle = (mib: number): string => friendlySize(mib * 2 ** 20);

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
      <div className="settings-first-row">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={state.enabled}
            disabled={!agentService.isAvailable}
            onChange={(event) => void agentService.setEnabled(event.target.checked)}
          />
          {L("Let agents connect to ByteRipper")}
        </label>
        <HelpButton link={topicLink(TOPIC.agent)} />
      </div>
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

      {/* help: settings.agent.launch */}
      <label className="settings-check">
        <input
          type="checkbox"
          checked={state.launchesApp}
          disabled={!agentService.isAvailable}
          onChange={(event) => {
            agentService.setLaunchesApp(event.target.checked);
            setCopied(false);
          }}
        />
        {L("Start ByteRipper when an agent connects")}
      </label>
      <p className="settings-caption">
        {L(
          "On, the configuration below lets the client start ByteRipper when the agent needs it and ByteRipper is not open. Off, the agent reaches ByteRipper only while it is open, and quitting it keeps it closed. Copy the configuration into the client again after changing this."
        )}
      </p>

      {/* help: settings.agent.background */}
      <div className="settings-agent-limits">
        <label htmlFor="settings-agent-files" className="settings-label">
          {L("Dumps kept open:")}
        </label>
        <select
          id="settings-agent-files"
          className="settings-select"
          value={agentService.backgroundFileLimit}
          disabled={!agentService.isAvailable}
          title={L("How many dumps an agent opened by path stay read and parsed at once")}
          onChange={(event) => {
            agentService.backgroundFileLimit = Number(event.target.value);
          }}
        >
          {BACKGROUND_FILE_CHOICES.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
        <label htmlFor="settings-agent-memory" className="settings-label">
          {L("Memory for them:")}
        </label>
        <select
          id="settings-agent-memory"
          className="settings-select"
          value={agentService.backgroundMemoryLimitMiB}
          disabled={!agentService.isAvailable}
          title={L("How much memory the dumps an agent opened by path may hold between them")}
          onChange={(event) => {
            agentService.backgroundMemoryLimitMiB = Number(event.target.value);
          }}
        >
          {agentService.memoryChoicesMiB.map((mib) => (
            <option key={mib} value={mib}>
              {memoryTitle(mib)}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-caption">
        {L(
          "An agent can open a dump by its path, without a pane. The dumps it opened last stay parsed, so another question about one of them is answered without reading it again. Past either limit, the dump not asked about for the longest time is closed; named again, it is read again. Counted are the files, read whole, and what their compressed sections decompressed to. At most a quarter of this computer's memory is offered."
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
          <textarea
            className="settings-agent-preview"
            readOnly
            spellCheck={false}
            rows={6}
            aria-label={L("Configuration text")}
            value={clientText(client, relay, state.launchesApp)}
          />
          <div className="settings-actions">
            <button
              type="button"
              title={L("Copy the text above to the clipboard")}
              onClick={() => {
                void navigator.clipboard
                  .writeText(clientText(client, relay, state.launchesApp))
                  .then(() => {
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
