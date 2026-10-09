import type { Json } from "@/core/agent/json";
import { jsonText } from "@/core/agent/json";

/**
 * What work across many dumps is made of, apart from the documents: which files of a folder are
 * dumps, how a path into an answer is read, how answers are grouped, and what a finding is
 * (`Design/PORT_AGENT.md`, "Many dumps").
 *
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools
 */

/** The most files one survey takes. @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.maxSurveyFiles */
export const MAX_SURVEY_FILES = 200;

/** @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.dumpExtensions */
export const DUMP_EXTENSIONS: ReadonlySet<string> = new Set([
  "bin",
  "rom",
  "fd",
  "cap",
  "dump",
  "img",
  "scap",
]);

/**
 * How much of a value too large for one answer a group keeps, as JSON text.
 *
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.surveyValueShortened
 */
export const SURVEY_VALUE_SHORTENED = 2000;

/** The name of the file a path ends in, whichever way the machine separates them. */
export const baseName = (path: string): string => path.slice(path.search(/[^\\/]*$/));

/**
 * Whether `path` is one the machine's shell can take: absolute on any system, or starting at the
 * home folder. A relative one means nothing to an agent whose folder is not the app's.
 *
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.fileURL
 */
export const isAbsolutePath = (path: string): boolean =>
  /^(\/|\\\\|[A-Za-z]:[\\/]|~([\\/]|$))/.test(path);

/**
 * The dump files among the paths a folder listing gave, in the order a file manager sorts them —
 * numbers by their value, case ignored — hidden files left out.
 *
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.dumpFiles
 */
export function dumpFiles(paths: readonly string[]): string[] {
  return paths
    .filter((path) => {
      const name = baseName(path);
      if (name.startsWith(".")) return false;
      const dot = name.lastIndexOf(".");
      return dot > 0 && DUMP_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
    })
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

/**
 * `"matches.0.start"` → the steps into an answer; a number is an index, negative from the end.
 *
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.parsePath
 */
export const parsePath = (text: string): string[] => text.split(".").filter((step) => step !== "");

/** @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.value */
export function valueAt(path: readonly string[], value: Json): Json | undefined {
  let current: Json = value;
  for (const step of path) {
    if (/^-?[0-9]+$/.test(step) && Array.isArray(current)) {
      const index = Number(step);
      const resolved = index < 0 ? current.length + index : index;
      const item = current[resolved];
      if (item === undefined) return undefined;
      current = item;
    } else if (typeof current === "object" && current !== null && !Array.isArray(current)) {
      const next = (current as { [key: string]: Json })[step];
      if (next === undefined) return undefined;
      current = next;
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * One survey's answers, grouped by the value asked for: the largest group first, a tie in the
 * order the files first gave it. A stable order, so a page boundary falls in one place.
 *
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentDumpTools.SurveyRun
 */
export class SurveyGroups {
  private readonly byKey = new Map<string, { value: Json; files: string[] }>();

  add(value: Json, file: string): void {
    const key = jsonText(value);
    const held = this.byKey.get(key);
    if (held === undefined) this.byKey.set(key, { value, files: [file] });
    else held.files.push(file);
  }

  /** Largest first; a tie in the order the files gave it. */
  sorted(): { value: Json; files: string[] }[] {
    return [...this.byKey.values()]
      .map((group, order) => ({ group, order }))
      .sort((one, two) =>
        one.group.files.length !== two.group.files.length
          ? two.group.files.length - one.group.files.length
          : one.order - two.order
      )
      .map((entry) => entry.group);
  }
}

/**
 * One thing an agent found, and where, for the person to check.
 *
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentFinding
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentFinding.id
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentFinding.url
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentFinding.range
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentFinding.node
 * @upstream ByteRipperApp/Agent/AgentDumpTools.swift#AgentFinding.text
 * @upstream-differs a file the page opened is known by its name, size and date as well as by its path, which only a file read by path has
 */
export interface AgentFinding {
  readonly id: string;
  readonly text: string;
  /** What the file is called. */
  readonly file: string;
  /** Where the file is on this machine, when the agent said or the file was read by path. */
  readonly path: string | undefined;
  /** What tells an open file apart from another of the same name. */
  readonly identity: { readonly size: number; readonly modified: number } | undefined;
  readonly range: { readonly start: number; readonly end: number } | undefined;
  readonly node: string | undefined;
}
