import { describe, expect, it } from "vitest";
import { fixtureBytes, fixtureExists } from "@/core/testing/fixtureFile";
import { version2Sample } from "@/core/testing/workspaceSamples";
import { decodeUtf8 } from "@/core/text/utf";
import { WORKSPACE_VERSION } from "@/core/workspace/workspace";
import {
  loadWorkspace,
  MIGRATION_STEPS,
  type MigrationStep,
  migrateWorkspace,
  OLDEST_READABLE,
} from "@/core/workspace/workspaceMigration";

/**
 * A workspace written by an earlier build still opens: each version from `OLDEST_READABLE` on is
 * kept as a file in `fixtures/`, written by the build of that version and never rewritten since.
 *
 * @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceVersionTests.swift#WorkspaceVersionTests
 */

const fixturePath = (version: number) => `src/core/workspace/fixtures/v${version}/Workspace.json`;

/** @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceVersionTests.swift#WorkspaceVersionTests.fixture */
const fixture = (version: number): unknown =>
  JSON.parse(decodeUtf8(fixtureBytes(fixturePath(version))));

describe("every version kept", () => {
  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceVersionTests.swift#WorkspaceVersionTests.testEveryReadableVersionHasAFixture
  it("has a fixture of every readable version", () => {
    for (let version = OLDEST_READABLE; version <= WORKSPACE_VERSION; version++) {
      expect(fixtureExists(fixturePath(version)), `no fixture of version ${version}`).toBe(true);
    }
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceVersionTests.swift#WorkspaceVersionTests.testEveryReadableVersionHasAStepToTheNext
  it("has a step from every readable version to the next", () => {
    for (let version = OLDEST_READABLE; version < WORKSPACE_VERSION; version++) {
      expect(MIGRATION_STEPS[version], `no step from version ${version}`).toBeDefined();
    }
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceVersionTests.swift#WorkspaceVersionTests.testAProjectOfVersion4Opens
  // @upstream-differs version 2, the first the web edition's release writes
  it("opens a workspace of version 2", () => {
    expect(loadWorkspace(fixture(2))).toEqual({ ok: true, value: version2Sample() });
  });
});

describe("the chain", () => {
  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceVersionTests.swift#WorkspaceVersionTests.testAnEarlierVersionGoesThroughEveryStepInTurn
  it("takes an earlier version through every step in turn", () => {
    const steps: Record<number, MigrationStep> = {
      4: (object) => {
        object.trail = "4";
      },
      5: (object) => {
        object.trail = `${object.trail ?? ""}5`;
      },
    };
    const read = { version: 4, tab: {} };
    const migrated = migrateWorkspace(read, 6, 4, steps);
    expect(migrated).toEqual({ ok: true, value: { version: 6, tab: {}, trail: "45" } });
    expect(read, "what was read stays as it was written").toEqual({ version: 4, tab: {} });
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceVersionTests.swift#WorkspaceVersionTests.testTheCurrentVersionIsReadAsItIs
  it("reads the current version as it is", () => {
    const read = { version: 6, tab: {} };
    const migrated = migrateWorkspace(read, 6, 4, {});
    expect(migrated.ok && migrated.value).toBe(read);
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceVersionTests.swift#WorkspaceVersionTests.testAVersionWithNoStepIsNotGuessedAt
  it("does not guess at a version with no step", () => {
    expect(migrateWorkspace({ version: 4 }, 6, 4, { 4: () => {} })).toEqual({
      ok: false,
      failure: { kind: "unreadable" },
    });
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceVersionTests.swift#WorkspaceVersionTests.testANewerVersionIsRefused
  it("refuses a newer version", () => {
    const newer = { ...version2Sample(), version: WORKSPACE_VERSION + 1 };
    expect(loadWorkspace(newer)).toEqual({
      ok: false,
      failure: { kind: "newer", version: WORKSPACE_VERSION + 1 },
    });
  });

  // @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceVersionTests.swift#WorkspaceVersionTests.testAVersionBeforeMigrationsIsRefused
  it("refuses a version from before migrations", () => {
    const older = { ...version2Sample(), version: OLDEST_READABLE - 1 };
    expect(loadWorkspace(older)).toEqual({
      ok: false,
      failure: { kind: "tooOld", version: OLDEST_READABLE - 1 },
    });
  });

  it("refuses what is not a workspace", () => {
    for (const value of [undefined, null, "{}", [], { version: "2" }, { version: 2 }]) {
      expect(loadWorkspace(value)).toEqual({ ok: false, failure: { kind: "unreadable" } });
    }
  });
});
