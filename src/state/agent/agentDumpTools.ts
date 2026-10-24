import { type FileIdentity, sameFile } from "@/core/agent/agentAnnotation";
import { AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import {
  baseName,
  dumpFiles,
  isAbsolutePath,
  MAX_SURVEY_FILES,
  parsePath,
  SURVEY_VALUE_SHORTENED,
  SurveyGroups,
  surveyNames,
  valueAt,
} from "@/core/agent/agentSurvey";
import {
  type AgentCall,
  type AgentTool,
  AgentToolError,
  agentTool,
  jsonAnswer,
  READ_ONLY,
  throwIfCancelled,
  VIEW,
} from "@/core/agent/agentTool";
import { type Json, jsonText } from "@/core/agent/json";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import type { OpenedFile } from "@/platform/files/openedFile";
import type { AgentDesk, AgentPlace } from "@/state/agent/agentDesk";
import { hexText, rangeJson } from "@/state/agent/agentHostTools";
import { agentShell } from "@/state/agent/agentShell";
import { recordJump } from "@/state/navigationStore";
import { PANE_IDS } from "@/state/paneId";
import { paneState } from "@/state/workspaceStore";

/**
 * Work across many dumps (`Design/PORT_AGENT.md`, "Many dumps"): opening a file by path with no
 * window, asking one question of a folder of them, and putting one on screen. What is found is
 * annotated (`AgentAnnotationTools`), on each file that matches.
 *
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.desk
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.toolNamed
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.init
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.tools
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.lastSurvey
 * @upstream-differs a file is put on screen in a free pane of the window — the web has no tabs
 */

/** One survey's answers, grouped: what a page of it is cut from. @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.SurveyRun */
interface SurveyRun {
  readonly key: string;
  /** The folder the files' names are paths from. @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.SurveyRun.root */
  readonly root: string;
  readonly files: number;
  readonly groups: readonly { value: Json; files: string[] }[];
  readonly failed: readonly Json[];
  readonly fingerprint: string;
}

const ANOTHER_SURVEY = "That page is of another survey; ask again without `after`.";

export class AgentDumpTools {
  readonly desk: AgentDesk;
  /** The server's tools by name, for `survey` to call. Set by the service once the list is built. */
  toolNamed: (name: string) => AgentTool | undefined = () => undefined;
  private readonly bridge: () => AgentBridge | undefined;
  private lastSurvey: SurveyRun | undefined;
  private surveyCount = 0;

  constructor(desk: AgentDesk, bridge: () => AgentBridge | undefined) {
    this.desk = desk;
    this.bridge = bridge;
  }

  tools(): AgentTool[] {
    return [this.openDumpTool(), this.closeDumpTool(), this.showTool(), this.surveyTool()];
  }

  // MARK: - open_dump / close_dump

  private openDumpTool(): AgentTool {
    return agentTool({
      name: "open_dump",
      title: "Open a dump in the background",
      description:
        "Opens a file by path without putting it on screen, read-only, and returns its document id — " +
        "for the tools that take `document` (`read`, `uefi_tree`, `uefi_find`…), but not for the ones " +
        "that show things (`reveal`, `mark`, panels); `show` puts it on screen. A file already open in " +
        "the window answers with that pane's id. The last eight are kept parsed; older ones are closed " +
        "and opened again when asked for. A file changed on disk is read again and keeps its id.",
      inputSchema: AgentSchema.object(
        {
          path: AgentSchema.string(
            "An absolute path, or one starting with ~/ for the home folder."
          ),
        },
        ["path"]
      ),
      annotations: READ_ONLY,
      run: async (call) => jsonAnswer(await this.openDump(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.openDump */
  async openDump(args: AgentArguments): Promise<Json> {
    const path = this.filePath(args.string("path"));
    const stat = await this.stat(path);
    const onScreen = this.desk.onScreenPlaceOf(path, stat);
    if (onScreen !== undefined) {
      return { document: onScreen.id, on_screen: true, size: hexText(onScreen.document.size) };
    }
    const entry = await this.desk.background.open(path);
    return { document: entry.id, on_screen: false, size: hexText(entry.size) };
  }

  private closeDumpTool(): AgentTool {
    return agentTool({
      name: "close_dump",
      title: "Close a background dump",
      description:
        "Closes a document `open_dump` opened. Files open in the window are the person's and are not closed.",
      inputSchema: AgentSchema.object(
        { document: AgentSchema.string("The background document's id.") },
        ["document"]
      ),
      annotations: { readOnly: false, destructive: false, idempotent: true },
      run: async (call) => jsonAnswer(this.closeDump(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.closeDump */
  closeDump(args: AgentArguments): Json {
    const place = this.desk.placeNamed(args.string("document"));
    if (place.isOnScreen) {
      throw new AgentToolError(`${place.named} is open in the window; only the person closes it.`);
    }
    if (place.pane !== undefined) this.desk.background.close(place.pane);
    return { closed: place.id };
  }

  // MARK: - show

  private showTool(): AgentTool {
    return agentTool({
      name: "show",
      title: "Put a dump on screen",
      description:
        "Opens a background document in a new window — or brings forward the pane that already has " +
        "the file — and shows `offset` there, selecting `length` bytes when given. Returns the " +
        "on-screen document's id, which replaces the background one. To look inside a node or a " +
        "stretch of a dump that is already on screen, use `open_part`, which opens a panel in the " +
        "same window instead.",
      inputSchema: AgentSchema.object(
        {
          document: AgentSchema.string("The document's id."),
          offset: AgentSchema.offset("Where to show. Default: the start."),
          length: AgentSchema.offset("How many bytes to select. Default 0."),
        },
        ["document"]
      ),
      annotations: VIEW,
      run: async (call) => jsonAnswer(await this.show(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.show */
  async show(args: AgentArguments): Promise<Json> {
    const place = this.desk.placeNamed(args.string("document"));
    const offset = args.optionalOffset("offset") ?? 0;
    const length = args.optionalOffset("length") ?? 0;
    let onScreen: AgentPlace;
    let replaced: string | undefined;
    if (place.isOnScreen) {
      onScreen = place;
    } else {
      const entry = place.pane === undefined ? undefined : this.desk.background.entryOf(place.pane);
      if (entry === undefined) throw new AgentToolError(`${place.named} has no file.`);
      const existing = this.desk.onScreenPlaceOf(entry.path, entry);
      if (existing === undefined) {
        const answer = await this.showInNewWindow(place, offset, length);
        this.desk.background.close(entry.pane);
        return answer;
      }
      onScreen = existing;
      replaced = place.id;
      this.desk.background.close(entry.pane);
    }
    const size = onScreen.document.size;
    if (offset > size) {
      throw new AgentToolError(`Offset ${hexText(offset)} is past the end of ${onScreen.named}.`);
    }
    const end = Math.min(offset + length, size);
    const pane = onScreen.onScreen();
    agentShell.bringForward?.(pane);
    recordJump(pane);
    await agentShell.reveal?.(pane, offset, end, end > offset);
    const answer: { [key: string]: Json } = {
      document: onScreen.id,
      shown: rangeJson(offset, end),
    };
    if (replaced !== undefined) answer.replaces = replaced;
    return answer;
  }

  /**
   * Opens a background document in a new window, as upstream opens it in a new tab — never in a
   * pane of this one, whose second pane is for a comparison — and has that window show
   * `[offset, offset + length)`: the answer `show` gives, with the id the document has there once
   * that window says it holds it.
   *
   * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.openInNewTab
   * @upstream-differs a window of the desktop shell, which is another page: it shows the place
   * itself, and is waited for to say the document it opened
   */
  async showInNewWindow(place: AgentPlace, offset: number, length: number): Promise<Json> {
    const held = place.state;
    if (held === undefined) throw new AgentToolError(`${place.named} has no file.`);
    const size = place.document.size;
    if (offset > size) {
      throw new AgentToolError(`Offset ${hexText(offset)} is past the end of ${place.named}.`);
    }
    const end = Math.min(offset + length, size);
    // The window it opens in is found by what it says it holds, which only the shell's windows say.
    const others = this.desk.others;
    if (
      others === undefined ||
      agentShell.openInNewWindow?.(held.file, { kind: "range", start: offset, end }) !== true
    ) {
      throw new AgentToolError(`ByteRipper could not open ${held.name} in a new window.`);
    }
    const identity = identityOfFile(held.file);
    const shown = () =>
      others
        .documents()
        .find(
          ({ document }) =>
            (document.slot === "A" || document.slot === "B") &&
            document.file !== undefined &&
            sameFile(document.file, identity)
        )?.document;
    const id = await new Promise<string | undefined>((resolve) => {
      const finish = (found: string | undefined) => {
        clearTimeout(timer);
        stop?.();
        resolve(found);
      };
      const timer = setTimeout(() => finish(undefined), NEW_WINDOW_WAIT_MS);
      const stop = others.changes?.(() => {
        const found = shown();
        if (found !== undefined) finish(found.id);
      });
    });
    if (id === undefined) {
      throw new AgentToolError(`ByteRipper could not open ${held.name} in a new window.`);
    }
    return { document: id, shown: rangeJson(offset, end), replaces: place.id };
  }

  // MARK: - survey

  private surveyTool(): AgentTool {
    return agentTool({
      name: "survey",
      title: "Ask one question of many dumps",
      description:
        "Runs one tool that takes `document` (`uefi_find`, `uefi_node`, `uefi_at`, `read`…) on every " +
        "file in `folder` (or in `paths`), opening each in the background, and returns the answers " +
        'grouped by the value at `group_by` — a dotted path into the tool\'s answer, e.g. "total", ' +
        '"matches.0.start", "values.0", "chain.-1.name" (a negative index counts from the end). Each ' +
        "group: the value, how many files gave it, and up to ten of the files; the largest groups " +
        "first. A file is named by its path from `root` — the `folder`, or the folder all the `paths` " +
        "share — so files of one name in different subfolders are told apart, and `root` joined to the " +
        "name is the path to open. Files a tool refused are listed under `failed`. Takes a while on many large images; " +
        `reports progress. At most ${MAX_SURVEY_FILES} files. Pages: \`limit\` is the most groups on ` +
        "one page, a ceiling — a page also stops before the answer passes the size bound and then says " +
        '`truncated: "size"`; pass `next` back as `after`, with the same other arguments, until it is ' +
        "null. The next page is answered from the same run, not a new one. A group whose value is too " +
        'large alone gives it as the start of its JSON text, marked `truncated: "item"`.',
      inputSchema: AgentSchema.object(
        {
          folder: AgentSchema.string(
            "A folder of dumps: files ending in .bin, .rom, .fd, .cap, .dump, .img, .scap."
          ),
          recursive: AgentSchema.boolean("Look in subfolders too. Default false."),
          paths: AgentSchema.strings("Files to survey, instead of a folder."),
          tool: AgentSchema.string("The tool to run on each file."),
          arguments: { type: "object", description: "The tool's arguments, without `document`." },
          group_by: AgentSchema.string(
            "Where in the answer the value to group by is. Default: the whole answer."
          ),
          limit: AgentSchema.limit(20, 100),
          after: AgentSchema.after,
        },
        ["tool"]
      ),
      annotations: READ_ONLY,
      run: async (call) => jsonAnswer(await this.survey(call)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.survey */
  async survey(call: AgentCall): Promise<Json> {
    const args = call.arguments;
    const toolName = args.string("tool");
    const tool = this.toolNamed(toolName);
    const schema = tool?.inputSchema as { properties?: { [key: string]: Json } } | undefined;
    if (tool === undefined || schema?.properties?.document === undefined || toolName === "survey") {
      throw new AgentToolError(`\`${toolName}\` is not a tool that answers about one document.`);
    }
    const given = args.get("arguments");
    if (
      given !== undefined &&
      (typeof given !== "object" || given === null || Array.isArray(given))
    ) {
      throw new AgentToolError("Argument `arguments` must be an object.");
    }
    const toolArguments = { ...((given as { [key: string]: Json } | undefined) ?? {}) };
    const groupBy = args.optionalString("group_by");
    const path = groupBy === undefined ? undefined : parsePath(groupBy);
    const limit = args.limit(20, 100);
    // A page after the first is answered from the run that made the first: running every file again
    // would take as long and could answer differently.
    const question: { [key: string]: Json } = { ...args.values };
    delete question.after;
    delete question.limit;
    const key = jsonText(question);
    let run: SurveyRun;
    if (args.has("after")) {
      // Never run again for a page: a cursor of another question, or of a run since replaced, is
      // refused at once.
      if (this.lastSurvey === undefined || this.lastSurvey.key !== key) {
        throw new AgentToolError(ANOTHER_SURVEY);
      }
      run = this.lastSurvey;
    } else {
      run = await this.surveyRun(call, key, tool, toolName, toolArguments, path);
      this.lastSurvey = run;
    }
    const paging = new AgentPage(args, run.fingerprint, ANOTHER_SURVEY);
    const envelope: { [key: string]: Json } = {
      root: run.root,
      files: run.files,
      groups_total: run.groups.length,
    };
    if (run.failed.length > 0) envelope.failed = [...run.failed];
    const items = run.groups.slice(paging.first, paging.first + limit).map(
      (group): Json => ({
        value: group.value,
        count: group.files.length,
        files: group.files.slice(0, 10),
      })
    );
    return paging.answer(envelope, "groups", items, run.groups.length, args.answerBound, (item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
      const members = item as { [key: string]: Json };
      if (members.value === undefined) return undefined;
      return {
        ...members,
        value: jsonText(members.value).slice(0, SURVEY_VALUE_SHORTENED),
        truncated: "item",
      };
    });
  }

  private async surveyRun(
    call: AgentCall,
    key: string,
    tool: AgentTool,
    toolName: string,
    toolArguments: { [key: string]: Json },
    path: readonly string[] | undefined
  ): Promise<SurveyRun> {
    const { files, folder } = await this.surveyFiles(call.arguments);
    if (files.length === 0) throw new AgentToolError("No dump files to survey there.");
    const { root, names } = surveyNames(files, folder);
    const groups = new SurveyGroups();
    const failed: Json[] = [];
    for (const [index, file] of files.entries()) {
      throwIfCancelled(call.signal);
      const name = names[index] ?? baseName(file);
      call.progress(index, files.length, name);
      try {
        const stat = await this.stat(file);
        const onScreen = this.desk.onScreenPlaceOf(file, stat);
        const document = onScreen?.id ?? (await this.desk.background.open(file)).id;
        // Not sent anywhere — only the value at `group_by` is kept — so the answer is not cut to
        // the bound.
        const answer = await tool.run({
          tool: toolName,
          arguments: new AgentArguments({ ...toolArguments, document }, Number.MAX_SAFE_INTEGER),
          progress: () => undefined,
          signal: call.signal,
        });
        const whole: Json = answer.kind === "json" ? answer.value : answer.text;
        const value = path === undefined ? whole : (valueAt(path, whole) ?? null);
        groups.add(value, name);
      } catch (error) {
        if (error instanceof AgentToolError) {
          if (failed.length < 20) failed.push({ file: name, error: error.message });
        } else if (error instanceof Error && error.name === "AgentCancelled") {
          throw error;
        } else if (failed.length < 20) {
          failed.push({ file: name, error: String(error) });
        }
      }
    }
    call.progress(files.length, files.length);
    this.surveyCount += 1;
    return {
      key,
      root,
      files: files.length,
      groups: groups.sorted(),
      failed,
      fingerprint: AgentPage.fingerprint([key, this.surveyCount]),
    };
  }

  /** The files to survey, and the folder asked about — nothing for `paths`. */
  private async surveyFiles(
    args: AgentArguments
  ): Promise<{ readonly files: string[]; readonly folder: string | undefined }> {
    const paths = args.strings("paths");
    let found: string[];
    let asked: string | undefined;
    if (paths.length > 0) {
      found = paths.map((one) => this.filePath(one));
    } else {
      const folder = args.optionalString("folder");
      if (folder === undefined) throw new AgentToolError("Give a `folder` or a list of `paths`.");
      const bridge = this.requireBridge();
      const recursive = args.bool("recursive", false);
      let listing: { files: readonly string[]; truncated: boolean };
      try {
        listing = await bridge.file({
          op: "list",
          path: this.filePath(folder),
          recursive,
        });
      } catch (error) {
        throw new AgentToolError(`Could not read ${folder}: ${reasonOf(error)}`);
      }
      found = dumpFiles(listing.files);
      // The shell lists under the folder as it reads it: `~/` comes back expanded, and the names
      // are paths from that.
      asked = folder.startsWith("~")
        ? (await this.stat(folder).catch(() => undefined))?.path
        : this.filePath(folder);
    }
    if (found.length > MAX_SURVEY_FILES) {
      throw new AgentToolError(
        `${found.length} files; at most ${MAX_SURVEY_FILES} in one survey. Narrow it with \`paths\`.`
      );
    }
    return { files: found, folder: asked };
  }

  // MARK: - Helpers

  private requireBridge(): AgentBridge {
    const bridge = this.bridge();
    if (bridge === undefined) throw new AgentToolError("This build cannot read files by path.");
    return bridge;
  }

  /** A path as given, refused unless it names a place on the machine. @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.fileURL */
  filePath(path: string): string {
    if (!isAbsolutePath(path)) throw new AgentToolError(`\`${path}\` is not an absolute path.`);
    return path;
  }

  async stat(path: string): Promise<{ path: string; size: number; modified: number }> {
    const bridge = this.requireBridge();
    try {
      const stat = await bridge.file({ op: "stat", path });
      if (stat.isDirectory) throw new Error("it is a folder");
      return stat;
    } catch (error) {
      throw new AgentToolError(`Could not read ${path}: ${reasonOf(error)}`);
    }
  }
}

const reasonOf = (error: unknown): string =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "")
    : String(error);

/** How long `show` waits for the window it opened to say it holds the document. */
const NEW_WINDOW_WAIT_MS = 15_000;

/** What tells the file apart, as the windows say it of their documents (`fileIdentityOf`). */
const identityOfFile = (file: OpenedFile): FileIdentity => ({
  name: file.name,
  size: file.size,
  modified: file.lastModified,
  ...(file.path === undefined ? {} : { path: file.path }),
});

/**
 * Shows `[start, end)` of `file` in a window opened for it by another's `show`, once it is open:
 * as `show` does in its own window — the pane in front, a step of the history, the range selected
 * where it is not empty.
 *
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.show
 * @upstream-differs the window that opened the file shows the place there; here the new window is
 * another page, and shows it itself
 */
export async function showHandedRange(file: OpenedFile, start: number, end: number): Promise<void> {
  const pane = PANE_IDS.find((slot) => {
    const there = paneState(slot)?.file;
    return (
      there !== undefined &&
      there.name === file.name &&
      there.size === file.size &&
      there.lastModified === file.lastModified
    );
  });
  const size = pane === undefined ? undefined : paneState(pane)?.document.size;
  if (pane === undefined || size === undefined || start > size) return;
  const to = Math.min(end, size);
  agentShell.bringForward?.(pane);
  recordJump(pane);
  await agentShell.reveal?.(pane, start, to, to > start);
}
