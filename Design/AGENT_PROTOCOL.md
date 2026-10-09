# The agent protocol — what ByteRipper says to an agent

> The contract both editions keep (`Design/PORT_AGENT.md`; upstream's own is
> `AGENT_PROTOCOL.md` in the macOS repository, which this is a copy of, word
> for word, but for the transport below). The Electron build serves it; the
> browser edition has no agent. A change here is a change to an interface an
> agent may have been told about — say why in the commit.

Draft until stage A10 marks it version 1. The tool list grows by stage; what is
listed here is what the code answers today, and `docs` upstream is ahead of it
until the stages land.

## Transport

- Newline-delimited JSON-RPC 2.0, one message per line, over a byte stream:
  the relay's stdin and stdout on the client's side; on the app's, a named
  pipe on Windows (`\\.\pipe\ByteRipper-agent-<user>`) and a Unix-domain
  socket elsewhere (`~/Library/Application Support/ByteRipper/agent.sock`,
  mode 0600, on macOS — a development run). `BYTERIPPER_AGENT_SOCKET` moves the
  endpoint, for both ends. The relay is the app's own executable run as Node
  (`ELECTRON_RUN_AS_NODE=1`) over `relay.cjs`.
- Both eras of MCP are served. A request whose `params._meta` carries
  `io.modelcontextprotocol/protocolVersion` is **modern** (`2026-07-28`): it
  must also carry `io.modelcontextprotocol/clientCapabilities`, every result
  carries `resultType: "complete"` and `_meta["io.modelcontextprotocol/serverInfo"]`,
  and `server/discover` and `tools/list` carry `ttlMs: 300000` and
  `cacheScope: "public"`. An `initialize` opens a **legacy** connection
  (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`); its results carry
  none of those.
- Methods: `initialize`, `server/discover`, `ping`, `tools/list`,
  `tools/call`. Notifications in: `notifications/initialized` (ignored),
  `notifications/cancelled` (the call stops and is never answered). Out:
  `notifications/progress`, only for a request that carried a `progressToken`,
  never decreasing.
- The tool list is fixed while the app runs; `listChanged` is false.

Recorded against: Claude Code 2.1.292 (modern; `RecordedClientTests`).

## Conventions

- **Addresses and sizes are hex strings**, `"0x7F3000"`, in every answer.
  Every address argument takes a hex string or a decimal integer.
- **Ranges are half-open**: `{start, end, length}`, `end` the first byte after.
- **Documents** are named by ids `d1`, `d2`… minted when an agent first sees
  a document and good while it stays open. A tool that takes `document`
  defaults to the focused one.
- **UEFI nodes** are named by their place in the tree, `"0.2.5"` — exact for
  those bytes, meaningless in another dump. Find a node in another dump by
  what it is (`uefi_find`).
- **Refusals** are tool results with `isError: true` and one sentence saying
  what to do instead. Protocol errors (`-32602` unknown tool or bad params,
  `-32601` unknown method, `-32022` unsupported version) are for malformed
  requests only.
- **Bounds**: an answer is at most 24 KiB; a byte read is at most 4096 bytes.
- **Lists are paged.** A list takes `limit`, a ceiling: a page stops at
  `limit` items or at the item that would take the answer over 24 KiB,
  whichever comes first. Every page ends with `next` — null when nothing is
  left, otherwise a cursor to pass back as `after` — and a page the size cut
  short says `truncated: "size"`. A cursor is good while the documents and
  the question stay the same; after either changed it is refused. Counts and
  totals are of the whole list, whatever the page. An item too large alone is
  shortened by its tool and says `truncated: "item"`; failing that the call is
  refused naming it. An answer that is not a list and is over the bound is not
  sent, and the agent is told to ask for less.
- **English**, whatever language the window speaks.

## Host tools

| Tool | Arguments | Answer |
|---|---|---|
| `documents` | — | `documents[]`: `id`, `name`, `path` (not for an untitled one), `size`, `unsaved_edits`, `read_only`, `tab`, `slot` (`A`, `B`, `part`), `focused`; for a part, `part_of` and `source` (range in the parent). |
| `focus` | — | `document`, `name`, `caret`, `selection` (range or null), `on_screen` (range), `compared_with` (the other document of a comparison). |
| `read` | `offset`; `length` (default 256, ≤ 4096); `format` `hex`·`ascii`·`utf16le`·`u8`·`u16`·`u32`·`u64`; `endian` `little`·`big` | `document`, `offset`, `length`, `format`; `rows` (hex: `"00001000  4D 5A …  |MZ..|"`), `text`, or `values` (hex strings); `cut_at_end_of_file` when cut. |
| `reveal` | `offset`; `length` (default 0); `select` (default: length > 0) | `document`, `shown` (range), `selected`. A navigation step. |
| `open_panel` | `module` (`zonesketch`, `fit`, `uefi-structure`, `me-analyzer` — the last part of the module's identifier) | `document`, `module`, `panel`, `was_open`. A navigation step. Refused while a sheet is up. |

## Marks

| Tool | Arguments | Answer |
|---|---|---|
| `mark` | `offset`, `length` (≥ 1), `label` (≤ 80 characters); `note` (≤ 600); `related_to` (mark ids) | `id` (`m1`, `m2`… one counter for the app), `document`, `range`, `label`, `note`, `related_to`. Does not move the view. |
| `unmark` | `ids`, or `document`, or `all: true` | `removed[]`; `not_found[]` for ids there were not. Relations to a removed mark go with it. |
| `marks` | `document` (default: every document); `limit` (50, ≤ 200); `after` | `marks[]`, each as `mark` answers; `total`. Paged (`next`, `after`). |

A mark lives on its document's pane: drawn dashed in the agent's colour over
the dump, its label and note shown under the pointer, listed in the Agent
window. It goes with `unmark`, the window's buttons, or its document.

## Many dumps

| Tool | Arguments | Answer |
|---|---|---|
| `open_dump` | `path` (absolute or `~/`) | `document`, `on_screen` (true when a tab already has the file, and the id is that tab's), `size`. Read-only, no window; the last eight are kept parsed. A file changed on disk is read again under the same id. |
| `close_dump` | `document` | `closed`. Refuses a document in a tab. |
| `show` | `document`; `offset`, `length` | `document` (on screen), `shown`, `replaces` (the background id it replaced). Opens a new tab, or brings forward the tab that has the file. |
| `survey` | `folder` (+ `recursive`) or `paths`; `tool` (one that takes `document`); `arguments`; `group_by` (dotted path, `-1` for the last element); `limit` (20, ≤ 100); `after` | `files`, `groups_total`, `groups[]` (`value`, `count`, `files` — ten at most; the largest first), `failed[]` (`file`, `error`). Progress per file. At most 200 files. Paged (`next`, `after`): a page after the first is cut from the same run, never a new one; a group whose value is too large alone gives the start of its JSON text. |
| `finding` | `text`; `document` or `path`; `offset`, `length`, `node` | the finding: `id` (`f1`…), `path`, `range`, `node`, `text`. |
| `findings` | `limit` (50, ≤ 200); `after` | `findings[]`, oldest first; `total`. Paged (`next`, `after`). |

A background document is answered about by every tool that reads — `read`,
`documents`, the module queries — and refused, with `show` named, by every
tool that shows: `focus`, `reveal`, `mark`, `open_panel`, panel actions.

## UEFI Structure

Queries — answered with the panel open or not, from the pane's shared tree:

| Tool | Arguments | Answer |
|---|---|---|
| `uefi_tree` | `node` (default the top); `depth` 1–3; `limit` (100, ≤ 400 children of `node`); `after` | `image` (summary, at the top) or `node`; `children[]`, each a node summary, with `below[]` past depth 1; `total`. Paged (`next`, `after`). A child whose levels below are too large alone comes without `below`. |
| `uefi_node` | `node` | `node`, `path` (names from the top), `title`, `fields[]` (`label`, `value`, `problem`), `tables[]` (`title`, `columns`, `rows`), `diagnostics[]`. |
| `uefi_find` | any of `name` (part, any case), `exact`, `guid`, `type` (the Type column); `limit` (50, ≤ 200); `after` | `matches[]` (node summary + `path`), `total`. Opens and decompresses everything once. Paged (`next`, `after`). |
| `uefi_at` | `offset` | `offset`, `chain[]`, outermost first. |
| `uefi_node_data` | `node`; `part` (`body`, `header`, `all`, `decompressed` — a compressed section's buffer); `offset` (0); `length` (256, ≤ 4096); `format`, `endian` as `read` | as `read`, at addresses inside the part; `node`, `part`, `size` (the whole part), `in_compressed`, `file_start` for a node of the file, `source` (`section`, `start`, `end`, `algorithm`, `nested`) for bytes a compressed section decompressed to, `cut_at_end_of_part`. |

A node summary: `id`, `type`, `subtype`, `name`, `guid`, `start`/`end` — or
`in_compressed: true` and `size` for a node inside a decompressed section —
`children` (a count, or `"unread"`), `erased`.

Actions — on the live panel in the document's tab; refused with a pointer to
`open_panel` when it is not open:

| Tool | Arguments | Answer |
|---|---|---|
| `uefi_select` | `node` | `selected` (node summary). Opens the tree down to it, selects it, publishes its zone so the dump scrolls there. A navigation step. |
| `uefi_selection` | — | `selected` (node summary or null); `note` when an ME row is chosen instead. |

## NVRAM variables

Part of the UEFI Structure module, read off the same shared tree, every
container opened:

| Tool | Arguments | Answer |
|---|---|---|
| `variables` | `name` (part, any case), `guid`, `store` (node id), `deleted`; `limit` (80, ≤ 300) | `variables[]` — `name`, `guid`, `size`, `value` (read as its type, or hex up to 32 bytes), `store`, `entry`, `start`/`end` or `in_compressed`, `copies` when over 1, `deleted`; `stores[]` the page's rows are in (`id`, `type`, `name` when it differs, `variables`, `start`/`end`); `total`; `note` when the image has no store. Paged (`next`, `after`). A row too large alone comes without `value`. |
| `variables_compare` | `against` (required); `name`; `limit` (40, ≤ 200); `after` | `only_in_document[]`, `only_in_against[]` (`name`, `guid`, `size`, `value`), `changed[]` (`name`, `guid`, `size`, `against_size`, `differing_bytes`, `runs[]` — half-open offsets into the value, sixteen at most, `runs_total` past that — `value`, `against_value`, `entry`, `against_entry`), `same`, `counts`. Paged as one sequence — `changed`, `only_in_document`, `only_in_against` — `counts` and `same` of the whole. A changed variable too large alone comes without its values. |

A variable is the copy that stands for it: the current one, or for a deleted
variable the copy it was deleted as. The stores read are VSS, VSS2, NVAR, Dell
DVAR and GPNV; EVSA, Apple SysF and flash maps are only in `uefi_tree`.

Two documents are matched by name, GUID and which time the pair is met in tree
order — never by address. `variables_compare` is the one *comparison* so far: a
module question about two documents (`ToolAgentComparison`), for which the app
adds `document` and `against` and hands the module a read host for each.
`survey` runs it with a fixed `against`, comparing a folder with one dump.

## FIT Table

| Tool | Arguments | Answer |
|---|---|---|
| `fit_table` | `entry` (the row's place, 0 the header) | `summary`, `table` (`start`, `end`, `pointer_at`, `pointer`, `checksum`, `checksum_should_be`, `checksum_checked`) or `tables_found_elsewhere`, `rows[]` (`index`, `type`, `address`, `size`, `version`, `row_start`, `points_at`, `target_start`/`target_end`, `cpuids`, `problem`), `backup` (`heading`, `rows`), `problems[]` (`message`, `severity`, `entry`, `offset`, `in_backup`), `address_mapping` when assumed; `entry` (`title`, `fields[]`). |
| `microcode_catalogue` | `cpuid` (first digits); `in_image`; `production_only`; `latest_only`; `limit` (50, ≤ 300); `after` | `files[]` (`path`, `cpuid`, `platforms`, `revision`, `date`, `production`, `size`; with `in_image` also `serves_rows`, `newer_than_installed`), `total`; with `in_image`, `installed[]` (`entry`, `cpuids[]` — `cpuid`, `platforms` — `revision`, `date`, `catalogue`: `latest`, `outdated`, `undecided`, `not_rated`, and `newest_revision`). Intel files of github.com/platomav/CPUMicrocodes, read from their names. Paged (`next`, `after`). |

Read as the panel reads: the table, then again with the branches its rows point
into opened so `points_at` names them. The microcode catalogue's verdict —
whether a newer revision exists — is the panel's alone.

## ME Analyzer

| Tool | Arguments | Answer |
|---|---|---|
| `me_summary` | — | `blocks[]` (`title`, `rows[]` — `label`, `value`, `tone` for a verdict: good, caution, bad). The File System State row adds `basis`: `decided_by` (`reserved_files`, `efs`, `configuration`, `nothing`), `reserved_files`, `efs`, `configuration[]`, `complete` (false when a step that could have raised the state was not taken — an EFS partition that could not be read, or files that could not be named) and `explanation`, the sentence the panel shows as **State basis**. |
| `me_tree` | `node` (a path such as `"2.0.3"`); `limit` (100, ≤ 400 children); `after` | `node` (with `fields[]`) and its `children[]`, or the top groups: `id`, `title`, `subtitle`, `start`/`end`, `children` (a count), `empty`, `problem` (`severity`, `lines`). An MFS or EFS file has no `start`/`end` but `stretches`, a count; as `node` it lists `extents[]` (`start`, `end`, the first 64, in the file's own order) and `extents_note` past them; `total` children. Paged (`next`, `after`). |
| `me_files_compare` | `against` (required); `volume` (`mfs`, `efs`); `name` (substring, any case); `extents`; `limit` (40, ≤ 200); `after` | `counts` (`same`, of those `moved` and `rewritten`; `different`, `only_in_document`, `only_in_against`, `incomplete` when any), `different[]`, `only_in_document[]`, `only_in_against[]`, `incomplete[]`: `volume`, `index` (MFS) or `file_id` (EFS), `name`, `size` (`document`, `against` — the content, without the Integrity table), `differing_bytes` (same length, bytes read), `integrity_differs`, `encrypted` (the file table's flag), `why` for an incomplete one, `extents` (`document`, `against`) when asked. `not_compared[]` (`volume`, `in`, `reason`) for a volume one side could not give files for — its files are then not listed as missing. Paged as one sequence — `different`, `only_in_document`, `only_in_against`, `incomplete` — `counts` of the whole; a file whose extents are too many alone keeps the first 16 per dump and says `document_total` / `against_total`. Reads only. |

The analysis is the pane's (`MEAAnalysisProviding`): one a panel made is used
at once, and one made here is kept for the panels unless the content changed
meanwhile (`ToolReadHost.contentVersion`). Files are named from the firmware
database's file table when the dump needs it and it can be fetched.

`me_files_compare` matches files by what each volume calls them, not by
address: an MFS volume moves its pages to spread the wear, so one machine's
two dumps keep a file in different places. Content is compared without the
Integrity table, which is reported apart — it changes on every write of the
file. The bytes are read through each file's extents, which the engine keeps
(`MFSFile.extents`, `EFSFile.extents`), and checked against the digest the
analysis made of them; bytes that changed since leave the verdict to the two
digests. The comparison is `MEFileComparison` in `MEPresentation`, the value a
panel is to show.

## Edits

Every change to a file goes through one door, whichever tool asks: the
person's edit switch (Settings ▸ Agent, "Let agents edit open files", key
`AgentEditsAllowed`, off after an install) must be on, the document must be in
a tab — a background document is refused with `show` named — and not opened
read-only. The change is one undo step named `Agent: <label>` in the app's own
language, shows red until saved, and is revealed as a navigation step. Nothing
saves.

| Tool | Arguments | Answer |
|---|---|---|
| `write` | `offset`, `bytes` (hex, ≤ 64 KiB), `label` (required, the person's language); `expect` (hex: the bytes that must be there now) | `written[]` (`start`, `end`, `before` — up to 64 bytes, `before_cut`), `undo`, `saved: false`. Overwrites only: past the end is refused. |
| `uefi_fix_checksum` | `node` | as `write`. A volume's, a file's, a microcode's checksums, by the panel's own repair code. Refused inside a compressed section and when already correct. |
| `fit_fix_checksum` | — | as `write`. The header's checksum, and the Top Swap backup's copy when it is the same table. Refused when unchecked or correct. |
| `fit_add_microcode` | `path` (from `microcode_catalogue`) | as `write`, and `change` (`added`, or `replaced` with what it `replaced`: `cpuid`, `revision`, `date`), `entry`, `component`, `moved`, `protected_ranges`, `top_swap_backup`. The panel's Add Microcode: a row whose update serves the same processor — extended signature tables counted — is updated in place. Refused when the same update is already in the table, and for the panel's other reasons. |
| `fit_replace_microcode` | `entry`, `path` | as `fit_add_microcode`. Refused too when the new update serves a processor, on a shared platform, that another row's already serves. |
| `fit_remove_microcode` | `entry` | as `write`, and `change: "removed"`, `entry`, `moved`, `erased`, `protected_ranges`, `top_swap_backup`. Refused for the last microcode. |

A module edit is a fourth kind of module tool, `ToolAgentEdit`: the module
returns a `ToolTransaction`, an undo name and what it has to say about the
change (`ToolAgentEdit.Change`), and the app applies it. The microcode edits
are the FIT panel's own (`FITEditor`), so every check the panel makes is made
for an agent too; the file comes from the panel's catalogue source. Should
the document change while the module works the edit out, nothing is written
and the agent is told to ask again.

## Byte comparison

| Tool | Arguments | Answer |
|---|---|---|
| `diff` | `against` (required); `offset` (0), `end` (the shorter file's end); `merge_gap` (16; at most this many matching bytes between two runs make one); `structure` (`auto`, `none`); `summary`; `limit` (100, ≤ 1000); `after` | `range`, `sizes`, `totals` (`runs`, `differing_bytes` — the whole range, whatever the page), `tail` (`in`, `start`, `end`) and `truncated_at` when the sizes differ, then `runs[]` (`start`, `end`, `length`, `differing_bytes`, `where[]`) and `next` — or with `summary`, `areas[]` (`kind`, `id`, `name`, `start`, `end`, `differing_bytes`, `runs`, and an `outside` entry for bytes in no area). Reads only. |
| `compare` | `against` (required) | `a`, `b` (on-screen ids), `names`, `was_shown`. A pair already shown is brought forward; a document alone in its tab (slot A, no B) gets the other as B; otherwise both open in a new tab. Refused for a document with unsaved edits that would have to be opened again from disk. |
| `reveal_diff` | `direction` (`next`, `previous`); `from` (default the caret) | `start`, `end`, `length`, `found` — or `found: false`. Both carets land on the difference, as the window's arrows land, by the person's grouping gap; a navigation step. Only on a pair `compare` (or the person) set up. |

The comparison is the window's own (`DiffEngine`): absolute offsets, never
aligned. `where` comes from the tool-modules' `ToolAgentLocator`s: each says
which of its areas a range is in and its deepest node covering the range whole,
and the finest that answers wins — ME partitions and files inside the ME
region, the UEFI tree elsewhere. An MFS or EFS file has no one range; a run
is placed at it when it is the only file whose stored bytes the run touches
and the run stays inside the file's partition — a run over chunks of two
files is placed at the partition. A run across a node boundary is placed at the
node holding both sides, never split. The summary's areas are the coarsest
locator's — regions, the BIOS region's volumes — with any a finer one divides
replaced by the finer ones and the stretches between them kept under the
coarse name. The cursor carries a fingerprint of both documents' content
versions, the range and `merge_gap`; a page asked for after any changed is
refused.

## Search and parts

| Tool | Arguments | Answer |
|---|---|---|
| `find_bytes` | `text` (with `encoding` `ascii`·`utf16le`·`both`, default both; `ignore_case`) or `hex` (pairs, `??` for any byte); `overlapping`; `offset`, `end`; `node`; `context` (≤ 64); `limit` (100, ≤ 1000); `after` | `document`, `range`, `total`, `matches[]` (`start`, `end` — or `node_start`, `node_end` in a decompressed buffer — `encoding`, `where[]`, `preview` with `hex`, `text`, `before`), `next`, `truncated`. With `node`: `node`, `node_size`, `in_compressed`, `decompressed` (a compressed section searched in its buffer), `source`. Reads only. |
| `open_part` | `offset`, `length` — or `node` with `part` (`all`, `body`); `name` | `document` (the part's id), `parent`, `name`, `source` (the parent's bytes it is linked to), `size`; with `node`, `node` and `in_compressed`. |

`find_bytes` is the find bar's engine (`SearchEngine.matches`), given holes
and overlapping matches; a match across two reads is found once. The file is
searched as stored: a node inside a compressed section, or a compressed
section itself, is searched in what the tree decompressed it to, never
decompressed again. `where` is placed by the locators as `diff` places a run;
in a buffer, it is the deepest node under the one searched. `open_part` opens
as Open Zone (a range) and the UEFI panel's Open (a node) do: a fragment
panel over the parent's tab, linked, its edits going back with Update in
Parent — a decompressed node's compressed again. `compare` of a part, which
has no file, opens copies in a new tab and says `copies`.
