/**
 * Where the app and the relay meet, named in one place so the two cannot disagree. The path
 * itself is the shell's — a named pipe on Windows, a socket in the profile elsewhere
 * (`desktop/agent-endpoint.cjs`); what the two ends say about it is here.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentEndpoint.swift#AgentEndpoint
 */

/**
 * The variable that moves the endpoint elsewhere — for a test, or for a second build of the app
 * run beside the installed one.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentEndpoint.swift#AgentEndpoint.environmentKey
 */
export const AGENT_ENDPOINT_ENVIRONMENT_KEY = "BYTERIPPER_AGENT_SOCKET";

/**
 * What a client is told when there is nothing to talk to: the app is not running, or its agent
 * service is switched off. Worded for the person reading the client's error, since a model can
 * do nothing about it.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentEndpoint.swift#AgentEndpoint.unavailableMessage
 */
export const AGENT_UNAVAILABLE_MESSAGE =
  "ByteRipper's agent service is not running. Open ByteRipper and switch it on in Settings ▸ Agent.";

/**
 * The variable that lets the relay start the app. Without it the relay never does: a client
 * restarts its server as soon as the app quits, and a person who quit ByteRipper saw it come
 * straight back. It is set in the client's configuration — Settings ▸ Agent writes it there when
 * its launch switch is on — because the relay runs without the app and reads none of its settings.
 * The relay's reading of it is the shell's (`desktop/agent-endpoint.cjs`, `launchesApp`).
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentEndpoint.swift#AgentEndpoint.launchKey
 */
export const AGENT_LAUNCH_KEY = "BYTERIPPER_LAUNCH";

/**
 * The same as {@link AGENT_UNAVAILABLE_MESSAGE}, from a relay that does not start the app
 * ({@link AGENT_LAUNCH_KEY}): the app may simply not be open.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentEndpoint.swift#AgentEndpoint.notStartedMessage
 */
export const AGENT_NOT_STARTED_MESSAGE =
  "ByteRipper is not running, or its agent service is switched off. Open ByteRipper and switch the service " +
  'on in Settings ▸ Agent. To have this server start ByteRipper, turn on "Start ByteRipper when an agent ' +
  'connects" there and copy the configuration into this client again.';
