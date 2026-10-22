import { AgentArguments } from "@/core/agent/agentArguments";
import {
  type AgentAnswer,
  type AgentCall,
  AgentCancelled,
  AgentToolError,
  CancelSource,
  jsonAnswer,
} from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import { desktopWindowFocus } from "@/platform/desktop/desktopWindows";
import { agentService } from "@/state/agent/agentService";
import { agentShell } from "@/state/agent/agentShell";
import { workspaceStore } from "@/state/workspaceStore";

/**
 * The agent's desk over every window of the desktop shell (`Design/DESKTOP_WINDOWS.md`, D7d).
 *
 * The service — the endpoint, the connections, the log — runs in the Agent window's page, which
 * holds no documents. Each call it is asked is run by a window of the workspace: the one holding
 * the document the call names, or, for a call naming none, the one in front. `documents` asks
 * every window and lists them front to back, each window a `tab` of its own. A document's id is
 * the app's (`AgentDesk.mint`), so it says which window holds it.
 *
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.places
 * @upstream-differs upstream's desk walks every window's documents in one process; here each
 * window's page answers for its own, and the Agent window's page asks the one it needs
 */

const CHANNEL = "byteripper-agent";

const me =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `w${Math.random().toString(36).slice(2)}`;

/** What a window of the workspace says of itself: its documents' ids, and when it was in front. */
export interface Runner {
  readonly ids: readonly string[];
  readonly focusedAt: number;
}

/** What the Agent window's page says of the service, for the other windows' buttons and settings. */
interface ServiceStatus {
  readonly running: boolean;
  readonly connections: number;
  readonly active: boolean;
  readonly failure: string | undefined;
  readonly endpoint: string | undefined;
}

type Message =
  | { readonly type: "hello" }
  | { readonly type: "runner"; readonly from: string; readonly runner: Runner }
  | { readonly type: "gone"; readonly from: string }
  | {
      readonly type: "call";
      readonly to: string;
      readonly id: number;
      readonly tool: string;
      readonly values: { readonly [key: string]: Json };
      readonly answerBound: number;
    }
  | { readonly type: "cancel"; readonly to: string; readonly id: number }
  | { readonly type: "answer"; readonly id: number; readonly answer: AgentAnswer }
  | {
      readonly type: "failed";
      readonly id: number;
      readonly message: string;
      readonly how: "tool" | "cancelled" | "other";
    }
  | {
      readonly type: "progress";
      readonly id: number;
      readonly progress: number;
      readonly total: number | undefined;
      readonly message: string | undefined;
    }
  | { readonly type: "status"; readonly status: ServiceStatus }
  | { readonly type: "status?" }
  | { readonly type: "settings"; readonly to: string };

let channel: BroadcastChannel | undefined;
const post = (message: Message) => channel?.postMessage(message);

function open(receive: (message: Message) => void): boolean {
  if (channel !== undefined || typeof BroadcastChannel === "undefined") return false;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<Message>) => receive(event.data);
  return true;
}

// MARK: - The Agent window's page

const runners = new Map<string, Runner>();
interface Pending {
  readonly runner: string;
  readonly call: AgentCall;
  readonly resolve: (answer: AgentAnswer) => void;
  readonly reject: (error: Error) => void;
}
const pending = new Map<number, Pending>();
let nextCall = 1;

/** The windows of the workspace, the one in front first. */
function frontToBack(): [string, Runner][] {
  return [...runners.entries()].sort(([, one], [, other]) => other.focusedAt - one.focusedAt);
}

/** Has window `runner` run `call`, and waits for its answer. */
function runIn(runner: string, tool: string, call: AgentCall): Promise<AgentAnswer> {
  const id = nextCall++;
  return new Promise<AgentAnswer>((resolve, reject) => {
    pending.set(id, { runner, call, resolve, reject });
    post({
      type: "call",
      to: runner,
      id,
      tool,
      values: call.arguments.values,
      answerBound: call.arguments.answerBound,
    });
    // A call the client withdraws is withdrawn where it runs.
    const watch = setInterval(() => {
      if (!pending.has(id)) clearInterval(watch);
      else if (call.signal.aborted) {
        clearInterval(watch);
        post({ type: "cancel", to: runner, id });
      }
    }, 200);
  });
}

/**
 * Where a call goes: to the window holding the documents it names, or to the one in front; and
 * `documents`, to every window, put together front to back.
 *
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.place
 * @upstream-differs a call is sent to the window that holds its document, which looks it up
 */
async function route(tool: string, call: AgentCall): Promise<AgentAnswer> {
  const windows = frontToBack();
  if (tool === "documents" && windows.length > 0) {
    const answers = await Promise.all(
      windows.map(([runner]) => runIn(runner, "documents", call).catch(() => undefined))
    );
    return jsonAnswer({ documents: documentsFrontToBack(answers) });
  }
  return runIn(windowToRun(windows, call.arguments), tool, call);
}

/**
 * The window a call is run in: the one holding the documents it names, or the one in front.
 * Two documents in two windows are refused: a comparison is made within one window.
 */
export function windowToRun(
  windows: readonly (readonly [string, Runner])[],
  args: AgentArguments
): string {
  const front = windows[0];
  if (front === undefined) throw new AgentToolError("No window of ByteRipper is open.");
  const named = ["document", "against"].flatMap((name) => {
    const id = args.get(name);
    return typeof id === "string" ? [id] : [];
  });
  const holders = named.map((id) => windows.find(([, runner]) => runner.ids.includes(id))?.[0]);
  const [first, second] = holders;
  if (first !== undefined && second !== undefined && first !== second) {
    throw new AgentToolError(
      `${named[0]} and ${named[1]} are open in different windows of ByteRipper, and a ` +
        "comparison is made within one window. Ask the person to bring them into one window."
    );
  }
  return first ?? second ?? front[0];
}

/**
 * Every window's `documents`, front to back: each window a tab of its own, numbered from the
 * front, and the front one's focus the focus.
 *
 * @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.documents
 * @upstream-differs each window answers for its own documents, and the answers are put together
 */
export function documentsFrontToBack(answers: readonly (AgentAnswer | undefined)[]): Json[] {
  const documents: Json[] = [];
  answers.forEach((answer, index) => {
    if (answer?.kind !== "json") return;
    const listed = (answer.value as { documents?: unknown }).documents;
    if (!Array.isArray(listed)) return;
    for (const entry of listed as { [key: string]: Json }[]) {
      const one: { [key: string]: Json } = { ...entry };
      if (one.tab !== undefined) one.tab = index + 1;
      if (index > 0) delete one.focused;
      documents.push(one);
    }
  });
  return documents;
}

function receiveAsHost(message: Message): void {
  switch (message.type) {
    case "runner":
      runners.set(message.from, message.runner);
      return;
    case "gone": {
      runners.delete(message.from);
      for (const [id, one] of pending) {
        if (one.runner !== message.from) continue;
        pending.delete(id);
        one.reject(new AgentToolError("The window the call ran in was closed while it ran."));
      }
      return;
    }
    case "answer":
      pending.get(message.id)?.resolve(message.answer);
      pending.delete(message.id);
      return;
    case "failed": {
      const one = pending.get(message.id);
      pending.delete(message.id);
      one?.reject(
        message.how === "tool"
          ? new AgentToolError(message.message)
          : message.how === "cancelled"
            ? new AgentCancelled()
            : new Error(message.message)
      );
      return;
    }
    case "progress":
      pending.get(message.id)?.call.progress(message.progress, message.total, message.message);
      return;
    case "status?":
      sendStatus(true);
      return;
    default:
      return;
  }
}

let lastStatus = "";
function sendStatus(always: boolean): void {
  const state = agentService.store.getSnapshot();
  const status: ServiceStatus = {
    running: state.running,
    connections: state.connections,
    active: state.active,
    failure: state.failure,
    endpoint: state.endpoint,
  };
  const text = JSON.stringify(status);
  if (!always && text === lastStatus) return;
  lastStatus = text;
  post({ type: "status", status });
}

/**
 * The Agent window's page serves the agent for the whole app: its calls go to the windows of the
 * workspace, and what the service is doing goes to their buttons and settings.
 */
export function hostAgentForWindows(): void {
  if (!open(receiveAsHost)) return;
  agentService.route = route;
  agentService.store.subscribe(() => sendStatus(false));
  post({ type: "hello" });
  sendStatus(true);
}

/** Settings ▸ Agent, from the Agent window: shown by the window of the workspace in front. */
export function openAgentSettingsInFront(): void {
  const front = frontToBack()[0];
  if (front !== undefined) post({ type: "settings", to: front[0] });
}

// MARK: - A window of the workspace

const running = new Map<number, CancelSource>();
let focusedAt = 0;
let lastRunner = "";

function sendRunner(always: boolean): void {
  const runner: Runner = { ids: agentService.desk.places().map((place) => place.id), focusedAt };
  const text = JSON.stringify(runner);
  if (!always && text === lastRunner) return;
  lastRunner = text;
  post({ type: "runner", from: me, runner });
}

async function runCall(message: Extract<Message, { type: "call" }>): Promise<void> {
  const source = new CancelSource();
  running.set(message.id, source);
  try {
    const answer = await agentService.runHere(message.tool, {
      tool: message.tool,
      arguments: new AgentArguments(message.values, message.answerBound),
      progress: (progress, total, text) =>
        post({ type: "progress", id: message.id, progress, total, message: text }),
      signal: source.signal,
    });
    post({ type: "answer", id: message.id, answer });
  } catch (error) {
    post({
      type: "failed",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
      how:
        error instanceof AgentToolError
          ? "tool"
          : error instanceof AgentCancelled
            ? "cancelled"
            : "other",
    });
  } finally {
    running.delete(message.id);
    // A call may have opened or closed a document.
    sendRunner(false);
  }
}

function receiveAsRunner(message: Message): void {
  switch (message.type) {
    case "hello":
      sendRunner(true);
      return;
    case "call":
      if (message.to === me) void runCall(message);
      return;
    case "cancel":
      if (message.to === me) running.get(message.id)?.cancel();
      return;
    case "status": {
      const status = message.status;
      agentService.store.update((state) => ({ ...state, ...status }));
      return;
    }
    case "settings":
      if (message.to !== me) return;
      desktopWindowFocus()?.();
      agentShell.openSettings?.();
      return;
    default:
      return;
  }
}

/**
 * A window of the workspace runs the agent's calls on its documents for the Agent window's page,
 * and tells it which documents it holds and when it comes to the front.
 */
export function runAgentCallsForHost(): void {
  if (!open(receiveAsRunner)) return;
  let scheduled = false;
  workspaceStore.subscribe(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      sendRunner(false);
    });
  });
  if (typeof window !== "undefined") {
    if (document.hasFocus()) focusedAt = Date.now();
    window.addEventListener("focus", () => {
      focusedAt = Date.now();
      sendRunner(false);
    });
    window.addEventListener("pagehide", () => post({ type: "gone", from: me }));
  }
  sendRunner(true);
  post({ type: "status?" });
}
