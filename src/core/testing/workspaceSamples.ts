import type { KeptContent, PaneState, Workspace } from "@/core/workspace/workspace";

/**
 * What `src/core/workspace/fixtures/v2/Workspace.json` holds: a field of every kind version 2 had. When a later
 * version migrates it, this is what the migration must arrive at — so it changes with the types,
 * and the fixture never does.
 *
 * @upstream Packages/Workspace/Tests/WorkspaceTests/WorkspaceVersionTests.swift#WorkspaceVersionTests.version4Sample
 * @upstream-differs version 2, the first a release of the web edition writes, and a window's
 * workspace — one tab — where upstream's is every window
 */
export function version2Sample(): Workspace {
  const modified = 1_760_000_000_000;
  const fileContent: KeptContent = {
    id: "A1",
    base: { kind: "file", serial: 1 },
    head: 6,
    nextSerial: 10,
    saved: 1,
    log: { file: "A1-1.log", length: 812, hash: "cd".repeat(32) },
    history: {
      undoBase: 1,
      redoTip: 9,
      redoSteps: [2, 1],
      savedState: 1,
      dirtyRegardless: false,
      joins: [
        {
          serial: 5,
          file: { name: "ec.bin", path: "/Jobs/T480/ec.bin", size: 0x10000, modified },
          name: "ec.bin",
          readOnly: true,
        },
      ],
      undoneJoins: [],
    },
  };
  const editsContent: KeptContent = {
    id: "A2",
    base: { kind: "edits", file: "A2-3.edits", serial: 3, hash: "01".repeat(32) },
    head: 3,
    nextSerial: 4,
    saved: 3,
  };
  const filePane: PaneState = {
    id: "p1",
    document: {
      kind: "file",
      file: {
        name: "bios.bin",
        path: "/Jobs/T480/bios.bin",
        relativePath: "bios.bin",
        size: 0x100_0000,
        modified,
        handle: "h-1",
        sha256: "ab".repeat(32),
      },
    },
    selectionStart: 0x10,
    selectionEnd: 0x20,
    inputRegion: "text",
    insertMode: true,
    topOffset: 0x1000,
    segments: {
      contentSize: 0x100_0000,
      pieces: [
        { start: 0, name: "Descriptor" },
        {
          start: 0x1000,
          name: "ME",
          link: {
            file: { name: "me.bin", path: "/Jobs/T480/me.bin", size: 0x5000, modified },
            sourceStart: 0,
            sourceEnd: 0x5000,
          },
        },
      ],
    },
    kept: fileContent,
    undo: {
      past: [
        { kind: "document" },
        {
          kind: "group",
          parts: [{ kind: "document" }, { kind: "segments" }],
          before: { contentSize: 0x100_0000, pieces: [{ start: 0, name: "Descriptor" }] },
        },
      ],
      future: [{ kind: "segments", after: { contentSize: 0x100_0000, pieces: [] } }],
      cutsPast: [{ contentSize: 0x100_0000, pieces: [{ start: 0, name: "Descriptor" }] }],
      cutsFuture: [],
    },
  };
  const untitledPane: PaneState = {
    document: {
      kind: "untitled",
      untitled: {
        content: {
          id: "U1",
          base: { kind: "bytes", file: "U1-0.bin", serial: 0, hash: "ef".repeat(32) },
          head: 0,
          nextSerial: 1,
        },
        name: "Join",
        size: 0x2000,
        dirty: true,
      },
    },
    selectionStart: 4,
    selectionEnd: 4,
    inputRegion: "hex",
    insertMode: false,
    topOffset: 0,
  };
  const part: PaneState = {
    id: "p2",
    document: {
      kind: "part",
      part: {
        parent: "p1",
        sourceStart: 0x40_0000,
        sourceEnd: 0x40_0400,
        name: "Setup",
        layout: '{"kind":"lzma"}',
        codec: '{"lzma":{}}',
        size: 0x800,
        edits: {
          content: {
            id: "P1",
            base: { kind: "bytes", file: "P1-2.bin", serial: 2, hash: "23".repeat(32) },
            head: 2,
            nextSerial: 3,
          },
          size: 0x800,
          dirty: true,
        },
      },
    },
    selectionStart: 0,
    selectionEnd: 8,
    inputRegion: "hex",
    insertMode: false,
    topOffset: 0,
    kept: editsContent,
  };
  return {
    version: 2,
    tab: {
      panes: [filePane, untitledPane],
      activePane: 1,
      dividerFraction: 0.4,
      surface: {
        minimapVisible: true,
        minimapMode: "overview",
        findPattern: { text: "$FPT", encoding: "ascii" },
        tool: { identifier: "uefi", state: "AQID", pane: 0 },
      },
      fragments: [{ pane: part, surface: { minimapVisible: false, tool: { identifier: "uefi" } } }],
      expandedFragment: 0,
    },
    notes: { isUp: false, selected: ["n3"] },
  };
}
