// Where the app and the relay meet, named in one place so the two cannot disagree
// (Design/PORT_AGENT.md). Upstream's is a Unix socket in the user's Library
// (`AgentEndpoint`); on Windows it is a named pipe, which Node's `net` listens on
// and connects to as it does a socket.
const os = require("node:os");
const path = require("node:path");

/** The variable that moves the endpoint elsewhere — for a test, or a second build run beside the installed one. */
const ENVIRONMENT_KEY = "BYTERIPPER_AGENT_SOCKET";

/**
 * The variable that lets the relay start the app. Without it the relay never does: a client
 * restarts its server as soon as the app quits, and a person who quit ByteRipper saw it come
 * straight back. It is set in the client's configuration — Settings ▸ Agent writes it there when
 * its launch switch is on — because the relay runs without the app and reads none of its settings.
 */
const LAUNCH_KEY = "BYTERIPPER_LAUNCH";

/** Whether the relay starts the app when the endpoint does not answer: only with `LAUNCH_KEY` set to something other than empty, "0" or "false". */
function launchesApp(env = process.env) {
  const value = env[LAUNCH_KEY];
  if (value === undefined) return false;
  const word = value.trim().toLowerCase();
  return !(word === "" || word === "0" || word === "false");
}

/** What a client is told when there is nothing to talk to. Worded for the person reading the client's error. */
const UNAVAILABLE_MESSAGE =
  "ByteRipper's agent service is not running. Open ByteRipper and switch it on in Settings ▸ Agent.";

/** The same, from a relay that does not start the app (`LAUNCH_KEY`): the app may simply not be open. */
const NOT_STARTED_MESSAGE =
  "ByteRipper is not running, or its agent service is switched off. Open ByteRipper and switch the service " +
  'on in Settings ▸ Agent. To have this server start ByteRipper, turn on "Start ByteRipper when an agent ' +
  'connects" there and copy the configuration into this client again.';

/** The name of the account, safe in a pipe's name. */
function accountName(env) {
  let name = "";
  try {
    name = os.userInfo().username;
  } catch {
    name = env.USERNAME || env.USER || "";
  }
  return name.replace(/[^A-Za-z0-9._-]/g, "_") || "user";
}

/**
 * The pipe on Windows — `\\.\pipe\ByteRipper-agent-<user>`, the account's name in it, since a
 * pipe has no file mode and the default access control of one the app made is the account's —
 * and a socket in the profile elsewhere: `~/Library/Application Support/ByteRipper/agent.sock`
 * on macOS, which is a development run's, and `~/.config/ByteRipper/agent.sock` on Linux.
 */
function endpoint(env = process.env, platform = process.platform) {
  if (env[ENVIRONMENT_KEY]) return env[ENVIRONMENT_KEY];
  if (platform === "win32") return `\\\\.\\pipe\\ByteRipper-agent-${accountName(env)}`;
  const home = os.homedir();
  const support =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"));
  return path.join(support, "ByteRipper", "agent.sock");
}

/** Whether the endpoint is a named pipe rather than a file in the profile. */
const isPipe = (address) => address.startsWith("\\\\.\\pipe\\");

module.exports = {
  ENVIRONMENT_KEY,
  LAUNCH_KEY,
  NOT_STARTED_MESSAGE,
  UNAVAILABLE_MESSAGE,
  endpoint,
  isPipe,
  launchesApp,
};
