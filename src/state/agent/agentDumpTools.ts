import { AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import {
  type AgentFinding,
  baseName,
  dumpFiles,
  isAbsolutePath,
  MAX_SURVEY_FILES,
  parsePath,
  SURVEY_VALUE_SHORTENED,
  SurveyGroups,
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
import { isObject, type Json, jsonText } from "@/core/agent/json";
import { L } from "@/core/localization/localization";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import type { AgentDesk, AgentPlace } from "@/state/agent/agentDesk";
import { hexText, rangeJson } from "@/state/agent/agentHostTools";
import { fileSourceOfNode } from "@/state/agent/agentNodeSource";
import { agentShell } from "@/state/agent/agentShell";
import { recordJump } from "@/state/navigationStore";
import { showNotice } from "@/state/noticeStore";
import { createStore } from "@/state/store";
import { openInPane, paneState, type SlotId } from "@/state/workspaceStore";

/**
 * Work across many dumps (`Design/PORT_AGENT.md`, "Many dumps"): opening a file by path with no
 * window, asking one question of a folder of them, putting one on screen, and leaving findings the
 * person can check by clicking.
 *
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.desk
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.toolNamed
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.init
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.tools
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.findings
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.lastSurvey
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.nextFinding
 * @upstream-differs a file is put on screen in a free pane of the window — the web has no tabs — and the Agent window listens to the findings store, where upstream's `onChange` told it
 */

/** What the Agent window's Findings page lists. @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.findings */
export const agentFindingStore = createStore<{ readonly findings: readonly AgentFinding[] }>({
  findings: [],
});

/** One survey's answers, grouped: what a page of it is cut from. @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.SurveyRun */
interface SurveyRun {
  readonly key: string;
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
  private nextFinding = 1;
  private surveyCount = 0;

  constructor(desk: AgentDesk, bridge: () => AgentBridge | undefined) {
    this.desk = desk;
    this.bridge = bridge;
  }

  tools(): AgentTool[] {
    return [
      this.openDumpTool(),
      this.closeDumpTool(),
      this.showTool(),
      this.surveyTool(),
      this.findingTool(),
      this.findingsTool(),
    ];
  }

  get findings(): readonly AgentFinding[] {
    return agentFindingStore.getSnapshot().findings;
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
      throw new AgentToolError(`${place.id} is open in the window; only the person closes it.`);
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
        "Opens a background document in a free pane of the window — or brings forward the pane that " +
        "already has the file — and shows `offset` there, selecting `length` bytes when given. Returns " +
        "the on-screen document's id, which replaces the background one. Never opens into a pane that " +
        "holds a file: with both panes taken it says so, and the person makes room. To look inside a " +
        "node or a stretch of a dump that is already on screen, use `open_part`, which opens a panel " +
        "in the same window instead.",
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
      if (entry === undefined) throw new AgentToolError(`${place.id} has no file.`);
      const existing = this.desk.onScreenPlaceOf(entry.path, entry);
      onScreen = existing ?? this.openOnScreen(place);
      replaced = place.id;
      this.desk.background.close(entry.pane);
    }
    const size = onScreen.document.size;
    if (offset > size) {
      throw new AgentToolError(`Offset ${hexText(offset)} is past the end of ${onScreen.id}.`);
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
   * Opens a background document into a pane of the window that holds no file, and gives back the
   * place it has there. Both panes taken is the person's to settle.
   *
   * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.openInNewTab
   * @upstream-differs a free pane of the window, where upstream opens a tab
   */
  private openOnScreen(place: AgentPlace): AgentPlace {
    const held = place.state;
    if (held === undefined) throw new AgentToolError(`${place.id} has no file.`);
    const free = (["a", "b"] as const).find((slot: SlotId) => paneState(slot) === undefined);
    if (free === undefined) {
      throw new AgentToolError(
        "Both panes of the window hold a file, and an agent does not replace one. " +
          "Ask the person to close one, or point at a file that is already open."
      );
    }
    openInPane(free, held.file);
    const opened = this.desk.placeOf(free);
    if (opened === undefined) {
      throw new AgentToolError(`ByteRipper could not open ${held.name} in the window.`);
    }
    return opened;
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
        "group: the value, how many files gave it, and up to ten of their names; the largest groups " +
        "first. Files a tool refused are listed under `failed`. Takes a while on many large images; " +
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
    const files = await this.surveyFiles(call.arguments);
    if (files.length === 0) throw new AgentToolError("No dump files to survey there.");
    const groups = new SurveyGroups();
    const failed: Json[] = [];
    for (const [index, file] of files.entries()) {
      throwIfCancelled(call.signal);
      call.progress(index, files.length, baseName(file));
      const name = baseName(file);
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
      files: files.length,
      groups: groups.sorted(),
      failed,
      fingerprint: AgentPage.fingerprint([key, this.surveyCount]),
    };
  }

  private async surveyFiles(args: AgentArguments): Promise<string[]> {
    const paths = args.strings("paths");
    let found: string[];
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
    }
    if (found.length > MAX_SURVEY_FILES) {
      throw new AgentToolError(
        `${found.length} files; at most ${MAX_SURVEY_FILES} in one survey. Narrow it with \`paths\`.`
      );
    }
    return found;
  }

  // MARK: - Findings

  private findingTool(): AgentTool {
    return agentTool({
      name: "finding",
      title: "Record a finding",
      description:
        "Records one finding for the person to check: a sentence, and where it is — a document, or a " +
        "file `path`, with an `offset` and `length` or a UEFI `node`. The Agent window lists findings; a " +
        "double-click opens the file at that place. Use it for each claim a survey supports, so seven " +
        "files out of fifty become seven lines the person can click. A finding in a part — a fragment " +
        "panel, decompressed or decoded — is recorded in the file on disk the part came out of: at the " +
        "same bytes where the part keeps the file's addresses, otherwise at the bytes the part was " +
        "decoded from; the answer's `from_part` says where it was in the part.",
      inputSchema: AgentSchema.object(
        {
          text: AgentSchema.string("What was found, in a sentence."),
          document: AgentSchema.string("The document it is in."),
          path: AgentSchema.string("Or the file it is in, by path."),
          offset: AgentSchema.offset("Where in the file."),
          length: AgentSchema.offset("How many bytes. Default 0."),
          node: AgentSchema.string('Or the UEFI node it is about, e.g. "0.2.5".'),
        },
        ["text"]
      ),
      annotations: { readOnly: false, destructive: false, idempotent: false },
      run: async (call) => jsonAnswer(await this.recordFinding(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.recordFinding */
  async recordFinding(args: AgentArguments): Promise<Json> {
    const text = args.string("text").trim();
    if (text === "") throw new AgentToolError("Argument `text` must say something.");
    let file: string;
    let path: string | undefined;
    let identity: AgentFinding["identity"];
    const offset = args.optionalOffset("offset");
    let range: readonly [number, number] | undefined =
      offset === undefined ? undefined : [offset, offset + (args.optionalOffset("length") ?? 0)];
    let node = args.optionalString("node");
    let fromPart: Json | undefined;
    const given = args.optionalString("path");
    if (given !== undefined) {
      path = this.filePath(given);
      const stat = await this.stat(path);
      file = baseName(stat.path);
      path = stat.path;
      identity = { size: stat.size, modified: Math.floor(stat.modified) };
    } else {
      const place = this.desk.placeNamed(args.optionalString("document"));
      let pane = place.pane;
      if (pane !== undefined && paneState(pane)?.origin !== undefined) {
        // A node of the part's own tree is named by the part's ids, which mean nothing in the
        // file: it goes as its bytes.
        if (node !== undefined) {
          range = await fileSourceOfNode(pane, node);
          node = undefined;
        }
        const answered: { [key: string]: Json } = { document: place.id };
        if (range !== undefined) answered.range = rangeJson(range[0], range[1]);
        // Out through every part to the file: byte for byte where the codec keeps the
        // addresses, otherwise the bytes the part was decoded from.
        let exact = true;
        for (let origin = paneState(pane)?.origin; origin !== undefined; ) {
          if (paneState(origin.parent) === undefined) {
            throw new AgentToolError(
              `${place.id}'s parent is closed, so a finding could not lead back to it.`
            );
          }
          const source = origin.sourceRange;
          if (range !== undefined && origin.codec.keepsOffsets && exact) {
            range = [source[0] + range[0], source[0] + range[1]];
          } else {
            range = source;
            exact = false;
          }
          pane = origin.parent;
          origin = paneState(pane)?.origin;
        }
        answered.exact = exact;
        fromPart = answered;
      }
      const held = pane === undefined ? undefined : paneState(pane);
      if (held === undefined || held.untitled) {
        throw new AgentToolError(
          `${place.id} is not a file on disk, so a finding could not lead back to it.`
        );
      }
      file = held.file.name;
      identity = { size: held.file.size, modified: held.file.lastModified };
      const entry = pane === undefined ? undefined : this.desk.background.entryOf(pane);
      path = entry?.path;
    }
    const finding: AgentFinding = {
      id: `f${this.nextFinding}`,
      text,
      file,
      path,
      identity,
      range: range === undefined ? undefined : { start: range[0], end: range[1] },
      node,
    };
    this.nextFinding += 1;
    agentFindingStore.update((state) => ({ findings: [...state.findings, finding] }));
    const described = AgentDumpTools.describe(finding);
    if (fromPart === undefined || !isObject(described)) return described;
    return { ...described, from_part: fromPart };
  }

  private findingsTool(): AgentTool {
    return agentTool({
      name: "findings",
      title: "List findings",
      description:
        "The findings recorded so far, oldest first. Pages: `limit` is a ceiling — a page also stops " +
        'before the answer passes the size bound and then says `truncated: "size"`; pass `next` back ' +
        "as `after` until it is null. A page asked for after the list changed is refused.",
      inputSchema: AgentSchema.object({
        limit: AgentSchema.limit(50, 200),
        after: AgentSchema.after,
      }),
      annotations: READ_ONLY,
      run: async (call) => {
        const args = call.arguments;
        const limit = args.limit(50, 200);
        const all = this.findings;
        const paging = new AgentPage(
          args,
          AgentPage.fingerprint([all.map((one) => one.id)]),
          "The findings changed since that page; ask again without `after`."
        );
        return jsonAnswer(
          paging.answer(
            { total: all.length },
            "findings",
            all
              .slice(paging.first, paging.first + limit)
              .map((one) => AgentDumpTools.describe(one)),
            all.length,
            args.answerBound
          )
        );
      },
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.clearFindings */
  clearFindings(): void {
    agentFindingStore.update(() => ({ findings: [] }));
  }

  /**
   * Opens the finding's file — the pane that has it, or a free one — and shows its place. What a
   * double-click on its row does.
   *
   * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.show
   */
  async showFinding(finding: AgentFinding): Promise<void> {
    let place = this.desk.places().find((one) => matches(one, finding) && one.isOnScreen);
    if (place === undefined) {
      try {
        if (finding.path === undefined) {
          throw new AgentToolError(
            "The file is no longer open, and the agent gave no path for it."
          );
        }
        const entry = await this.desk.background.open(finding.path);
        const background = this.desk.places().find((one) => one.id === entry.id);
        if (background === undefined) return;
        place = this.openOnScreen(background);
        this.desk.background.close(entry.pane);
      } catch (error) {
        showNotice("warning", [error instanceof Error ? error.message : String(error), L("Agent")]);
        return;
      }
    }
    const pane = place.onScreen();
    agentShell.bringForward?.(pane);
    const range = finding.range;
    if (range === undefined || range.start > place.document.size) return;
    recordJump(pane);
    const end = Math.min(range.end, place.document.size);
    await agentShell.reveal?.(pane, range.start, end, end > range.start);
  }

  // MARK: - Helpers

  private requireBridge(): AgentBridge {
    const bridge = this.bridge();
    if (bridge === undefined) throw new AgentToolError("This build cannot read files by path.");
    return bridge;
  }

  /** A path as given, refused unless it names a place on the machine. @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.fileURL */
  private filePath(path: string): string {
    if (!isAbsolutePath(path)) throw new AgentToolError(`\`${path}\` is not an absolute path.`);
    return path;
  }

  private async stat(path: string): Promise<{ path: string; size: number; modified: number }> {
    const bridge = this.requireBridge();
    try {
      const stat = await bridge.file({ op: "stat", path });
      if (stat.isDirectory) throw new Error("it is a folder");
      return stat;
    } catch (error) {
      throw new AgentToolError(`Could not read ${path}: ${reasonOf(error)}`);
    }
  }

  /** @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentFinding.json */
  static describe(finding: AgentFinding): Json {
    const entry: { [key: string]: Json } = {
      id: finding.id,
      file: finding.file,
      text: finding.text,
    };
    if (finding.path !== undefined) entry.path = finding.path;
    if (finding.range !== undefined)
      entry.range = rangeJson(finding.range.start, finding.range.end);
    if (finding.node !== undefined) entry.node = finding.node;
    return entry;
  }
}

/** Whether an open file is the one a finding is about. */
function matches(place: AgentPlace, finding: AgentFinding): boolean {
  const held = place.state;
  if (held === undefined || held.untitled) return false;
  if (held.file.name !== finding.file) return false;
  const identity = finding.identity;
  return (
    identity === undefined ||
    (held.file.size === identity.size && Math.abs(held.file.lastModified - identity.modified) < 2)
  );
}

const reasonOf = (error: unknown): string =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "")
    : String(error);
