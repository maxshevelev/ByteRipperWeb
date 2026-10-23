# Workspace fixtures

One folder per workspace version a build still reads, from
`OLDEST_READABLE` (`src/core/workspace/workspaceMigration.ts`) on:
`v<N>/Workspace.json`, a window's workspace as the build of version N wrote it
(`version<N>Sample()` in `src/core/testing/workspaceSamples.ts`).

A fixture is never rewritten. When `WORKSPACE_VERSION` goes up, the folder of
the version left behind stays as it is, a new one is added for the new version,
and the old one's test then checks that the migration brings it to what the new
types describe (`Design/WORKSPACE.md`, "Versions").

The `Kept/` side — a history's log — is in `src/core/edit/fixtures/`: the log's
format is upstream's, so its fixture is the one upstream's build of workspace
version 4 wrote.
