// Where the app and the relay meet, named in one place so the two cannot disagree
// (Design/PORT_AGENT.md). Upstream's is a Unix socket in the user's Library
// (`AgentEndpoint`); on Windows it is a named pipe, which Node's `net` listens on
// and connects to as it does a socket.
const os = require("node:os");
const path = require("node:path");

/** The variable that moves the endpoint elsewhere — for a test, or a second build run beside the installed one. */
const ENVIRONMENT_KEY = "BYTERIPPER_AGENT_SOCKET";

/** What a client is told when there is nothing to talk to. Worded for the person reading the client's error. */
const UNAVAILABLE_MESSAGE =
  "ByteRipper's agent service is not running. Open ByteRipper and switch it on in Settings ▸ Agent.";

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

module.exports = { ENVIRONMENT_KEY, UNAVAILABLE_MESSAGE, endpoint, isPipe };
