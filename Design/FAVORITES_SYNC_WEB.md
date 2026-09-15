# Favourites and their sync — the web edition's plan

G7 in `Design/GAPS.md`. Upstream's reasoning is in ByteRipper's
`Design/PATTERN_LIBRARY_IDEA.md`, `Design/FAVORITES_SYNC_IDEA.md` and
`Design/FAVORITES_SYNC_PLAN.md`; this is what the web edition takes from it,
what a browser changes, and the order it is built in.

## Decisions taken

1. **The web edition takes part in upstream's folder.** A browser on a Windows
   bench and ByteRipper on a Mac point at the same synced folder and see the same
   favourites. That fixes the file format, the file names and the merge rules:
   they are upstream's, not a web variant of them.
2. **Chromium syncs; Firefox and Safari fetch.** Where the browser can keep a
   folder (`showDirectoryPicker`), the library is synced both ways. Where it
   cannot, the user can still *take* what is in the folder — a read-only merge
   from a folder picked for the occasion — and gets the other direction through
   export.
3. **Export and import everywhere.** A library file saved and opened by hand; an
   import merges, it does not replace.
4. **A browser that lost its data can say "this was me".** See *Identity* below.
5. **No link or QR transfer, no cloud APIs, no server.** A link was considered and
   declined; a Google Drive / Dropbox / Gist API would need an OAuth client, the
   network and a third party's trust, which the project rules out.
6. **The recents do not sync**, as upstream: they are a per-machine cache.

## The model — upstream's, unchanged

- **A favourite is a recent with a name**: pattern, encoding, case rule, name —
  plus the bookkeeping a shared library needs: `id` (a UUID), `sortKey` (a number
  between neighbours), `modifiedAt`, `device`.
- **The local copy is the truth; the folder is the medium.** The Find bar draws
  from the local library, which is always there. The folder can be missing,
  refused or half-downloaded without the list changing.
- **One file per machine.** Each machine writes exactly one file in the folder
  and reads everyone else's. No file has two writers, so no sync client ever has
  to pick between two versions of one — the failure that made upstream move to
  this shape.
- **A three-way merge per peer**, against the state last agreed with that peer's
  file. Version vectors tell a concurrent write from a later one; tombstones tell
  "deleted" from "never had". Decided silently: one side changed it, both changed
  it the same way, both added, a deletion, a line removed by hand, the order.
  **Asked**: both edited differently, edited here and deleted there (asked on
  both machines), the same search under two names.
- **Read-only while a question stands.** Nothing half-merged is ever written; the
  machine that is asking still publishes its own file, so the other is asked too,
  and an answer on one settles the other through the counters.

## The file, exactly

Shared with the Mac app, so every detail is load-bearing:

| | |
|---|---|
| Name | `ByteRipper Patterns (XXXXXXXXXXXX).json` — the stem, then the first six bytes of SHA-256 of the device id as twelve upper-case hex digits. Anything else in the folder — a sync client's `… 2.json`, a conflicted copy, a file the user named — is not read, not folded in, not removed. |
| Body | `{ format, entries, tombstones, vector, machine }`, pretty-printed with sorted keys. |
| Entry | `{ id, name, pattern, encoding, caseSensitive, sortKey, modifiedAt, device }`. `encoding` is `hex`, `ascii`, `utf8`, `utf16LE` or `utf16BE` — the same raw values on both sides. |
| Identity | Upper-case UUID text, as Foundation writes it. |
| Time | ISO 8601 with milliseconds; whole seconds are read too. |
| Reading | Everything but an entry's pattern and encoding is optional; unknown fields are ignored; a file from a newer format is read for what this build knows. |
| `machine` | The human name of the writer, for a person looking at the folder. Not part of equality. |

The local record is upstream's `SyncDocument`: `{ format, local, bases }`, one
base per peer file name, written whole. On the web it lives in IndexedDB rather
than in a file.

## What a browser changes

**Identity.** A browser has no hardware id. The device id is a random UUID kept
in IndexedDB with the library, so it is per browser profile. Its label defaults to
"<Browser> on <OS>" and can be named in Manage Favorites ("Chrome on Windows
(BENCH-3)").

Site data can go: the user clears it, a private window ends, **Safari deletes a
site's storage after seven days without a visit** (unless it is added to the Dock
or Home Screen), or the browser evicts it under disk pressure. Then the browser is
a new device, and its old file stays in the folder as an *orphan*: nobody writes it
any more, every machine still reads it. Nothing is lost — the new device merges
the orphan like any peer — but the folder collects dead files and the list is
empty until the first sync. So:

- the app asks for persistent storage (`navigator.storage.persist()`);
- where a file in the folder carries this browser's label and names its own
  writer, Manage Favorites offers **"This was me"**: adopt that file's device id
  and carry on writing it, instead of starting a second file. The other files in
  the folder are not listed — which machines write there is the loop's business,
  not the reader's. Another machine's file is never deleted by the app.

**Access to the folder (Chromium).** The folder handle is kept in IndexedDB.
Permission is asked for once per visit, from a user gesture; since Chrome 122 the
user can choose "Allow on every visit" and not be asked again. Chromium's
sensitive-directory list blocks `~/Library` but explicitly allows
`~/Library/Mobile Documents` (iCloud Drive) and `~/Library/CloudStorage` (Dropbox,
Google Drive, OneDrive on macOS); on Windows it blocks `AppData`, and OneDrive or
Dropbox under the user profile are fine.

**Watching.** `FileSystemObserver` where the browser has it (Chromium desktop);
otherwise a re-read when the window comes forward and a slow interval as a
backstop, as upstream keeps one for providers that do not announce changes. A
write goes through `createWritable()`, which replaces the file whole on close.

**Several tabs.** Every tab of the app on one profile is the same device. They
share the IndexedDB record, take a Web Lock around a merge-and-publish, and tell
each other through a BroadcastChannel, so two tabs never publish over each other.

**Export and Import (every browser).** Export… in the Favorites tab writes this
browser's library exactly as its file in a shared folder would be — the same
name, `machine` set to the browser's label — through the save picker where there
is one and a download elsewhere, so an export can be put into a folder by hand
and every machine reading the folder takes it for this browser's. Import… reads a
library file and merges it as a peer this browser has agreed nothing with: no
base, and its counters taken as a lack of information (upstream's
`assumeConcurrent`, as when it joins a folder). So everything either side holds
is kept, a deletion wins only over what it is later than, and what both sides
hold differently is asked in the resolver. The import is all or nothing: Cancel
Import keeps none of it, and a file with nothing new in it is not a write. Upstream
has no import; the resolver is its `LibraryConflictSheetController`, with the
other side named by where it came from.

**Firefox and Safari.** "Get Favorites from a Folder…" opens a directory picker
(`<input webkitdirectory>`); the browser hands over read-only copies of the files
in it, and each library file is merged into the local library as a peer, with its
base kept like any other. Nothing is written to the folder — the interface says
that, and offers **Export** for the other direction.

## Where it appears

As upstream settled at its prototype:

- The Find bar's field menu: **Recent Queries** (with Add to Favorites and Clear
  Recents), then **Favorites** by name (with Manage Favorites…). A row reads
  `Name: "pattern"  flags`. A pick fills the field, sets encoding and case, and
  searches; it records nothing in the history.
- **Add to Favorites** takes the field as it stands — the encoding that worked —
  and asks for a name.
- **Manage Favorites** is a dialog: rename, edit, reorder by dragging, remove;
  where the library lives (this browser, or the folder) with Move… and Keep in
  This Browser; the folder's files; Export and Import; the conflict line and
  Resolve….
- **The resolver**: one row per question — what this browser says, what the other
  file says, keep which, *Keep both* where the searches genuinely differ, *Keep
  all mine* / *Keep all theirs*.

## Stages

| # | Stage | Where | Status |
|---|---|---|---|
| 1 | **The core**: `SearchPatternEntry` with its bookkeeping, `SyncedCollection`, `VersionVector`, `SyncMerge`, `SyncDocument`, the file codec — pure TypeScript in `src/core/sync` and `src/core/search`, with upstream's `VersionVectorTests`, `SearchPatternEntryTests`, `PatternLibraryTests`, `FavoritesDocumentTests` and `LibraryMergeTests` | all | done |
| 2 | **Favourites in the browser**: the IndexedDB document, the device id and label, persistent storage; the field menu's Favorites section, Add to Favorites, Manage Favorites (without the folder) | all | done |
| 3 | **Export and Import**: the library file saved and opened by hand, an import merged as a peer without a base | all | done |
| 4 | **The folder, both ways**: Move… / Keep in This Browser, the handle and its permission, one file per device, a merge per peer, watching, several tabs, the resolver, "This was me" | Chromium | done |
| 5 | **Get Favorites from a Folder**: a read-only merge from a picked folder | Firefox, Safari | done |

As built. The loop is `src/core/sync/folderSync.ts`, upstream's `FolderSync` in
pure TypeScript over a folder interface, asynchronous and serialised, with
upstream's `LibrarySyncTests` ported against two machines over a memory folder.
`src/platform/files/libraryFolder.ts` is the folder a browser reaches: a
directory handle kept in IndexedDB, its `readwrite` permission, a
`FileSystemObserver` where there is one, and the files a directory input hands
over where there is not. `src/state/favoritesStore.ts` owns the one loop: a
change is applied to the list on screen at once and to the loop's own copy when
its turn comes, so a merge that landed meanwhile is not written over; the folder
is looked at again on its own events, when the window comes forward, and once a
minute; a Web Lock is held around a merge-and-publish. **This was me** recovers
the device a file belongs to from the file itself — the counter in its vector
whose stamp names it — and carries on writing that file, removing the one the
browser had started since.

## Open questions

1. The tombstone lifetime is upstream's month. A browser that Safari wiped after a
   week and that comes back after five would resurrect nothing (its old file's
   deletions are older than the entries), but a deletion made in a browser that is
   then away for more than a month is one the others never hear about.
2. Whether "This was me" should also be offered when the labels differ — a bench
   renamed between the two runs.
