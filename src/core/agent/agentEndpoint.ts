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
