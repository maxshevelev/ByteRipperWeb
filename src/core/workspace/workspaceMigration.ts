import { WORKSPACE_VERSION, type Workspace } from "@/core/workspace/workspace";

// Not in the core's ES2023 lib, and present wherever the core runs: a page, a worker, a test.
declare const structuredClone: <T>(value: T) => T;

/**
 * How a workspace written by an earlier build is brought up to this one's version
 * (`Design/WORKSPACE.md`, "Versions").
 *
 * A project and the session are the person's work, so a build reads what the builds before it
 * wrote — back to `OLDEST_READABLE`, the first version this promise was made for. Each step takes
 * the workspace's JSON from one version to the next and is written against the JSON, not against
 * the types: those are this build's, and describe only the newest version.
 *
 * A version is raised only by a change an earlier record cannot be read through: a field that is
 * required, renamed, or means something else, a case taken away. An added optional field needs
 * none — an earlier record simply has not got it.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceMigration.swift#WorkspaceMigration
 * @upstream-differs a window's workspace, the page's own record — the project around the windows
 * is the shell's `Project.json`, migrated by `desktop/projects.cjs` the same way
 */

/**
 * The oldest version this build reads: the first a released build wrote. Earlier ones were
 * written before workspaces were migrated, and are refused.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceMigration.swift#WorkspaceMigration.oldestReadable
 */
export const OLDEST_READABLE = 2;

/**
 * Takes a workspace's top-level JSON object from one version to the next.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceMigration.swift#WorkspaceMigration.Step
 */
export type MigrationStep = (workspace: Record<string, unknown>) => void;

/**
 * The steps, by the version each one reads: `MIGRATION_STEPS[2]` makes version 3 out of version 2.
 * One for every version from `OLDEST_READABLE` up to `WORKSPACE_VERSION`.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceMigration.swift#WorkspaceMigration.steps
 */
export const MIGRATION_STEPS: Readonly<Record<number, MigrationStep>> = {};

/**
 * Why there is no workspace to read: not one at all or damaged, written before
 * `OLDEST_READABLE`, or written by a newer build, which this one cannot know the meaning of.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceMigration.swift#WorkspaceMigration.Failure
 */
export type MigrationFailure =
  | { readonly kind: "unreadable" }
  | { readonly kind: "tooOld"; readonly version: number }
  | { readonly kind: "newer"; readonly version: number };

/** A workspace read, or why it could not be. @web-only a result where upstream throws */
export type Loaded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: MigrationFailure };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `value` as a workspace of version `target`: itself when it already is one, a copy taken through
 * every step between otherwise.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceMigration.swift#WorkspaceMigration.migrate
 */
export function migrateWorkspace(
  value: unknown,
  target: number = WORKSPACE_VERSION,
  oldest: number = OLDEST_READABLE,
  steps: Readonly<Record<number, MigrationStep>> = MIGRATION_STEPS
): Loaded<Record<string, unknown>> {
  if (!isObject(value) || typeof value.version !== "number") {
    return { ok: false, failure: { kind: "unreadable" } };
  }
  const version = value.version;
  if (version === target) return { ok: true, value };
  if (version > target) return { ok: false, failure: { kind: "newer", version } };
  if (version < oldest) return { ok: false, failure: { kind: "tooOld", version } };
  // The steps work on a copy: what was read stays as it was written.
  const object = structuredClone(value);
  for (let from = version; from < target; from++) {
    // A version with no step is a hole in the chain, not a record to guess at.
    const step = steps[from];
    if (step === undefined) return { ok: false, failure: { kind: "unreadable" } };
    try {
      step(object);
    } catch {
      return { ok: false, failure: { kind: "unreadable" } };
    }
    object.version = from + 1;
  }
  return { ok: true, value: object };
}

/**
 * The workspace a record holds — this build's, or an earlier one's migrated — or why there is
 * none to read. A record whose shape is not a workspace's is unreadable, as a file that does not
 * decode is upstream.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.load
 * @upstream-differs a record already parsed, whoever kept it — IndexedDB, or a window of the
 * shell's project — where upstream reads a file
 */
export function loadWorkspace(value: unknown): Loaded<Workspace> {
  const migrated = migrateWorkspace(value);
  if (!migrated.ok) return migrated;
  const tab = migrated.value.tab;
  if (!isObject(tab) || !Array.isArray(tab.panes) || !Array.isArray(tab.fragments)) {
    return { ok: false, failure: { kind: "unreadable" } };
  }
  return { ok: true, value: migrated.value as unknown as Workspace };
}
