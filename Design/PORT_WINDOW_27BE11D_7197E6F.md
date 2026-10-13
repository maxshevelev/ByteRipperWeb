# ByteRipperWeb — porting the window `27be11d`…`7197e6f`

The twenty upstream commits past `27be11d` (one merge, `e08be83`, carries
nothing of its own), as work units in dependency order. Each unit is a separate
commit that ends with the check suite green (`npm run check`,
`check_anchors.py`, the help checks) and its share of `GAPS.md` moved; the
boxes are ticked as units close.

**The baseline.** `PORT_STATE.json` names `ce0ff33e`, the commit the web's
`90eb4fc` was brought level with — the bookmark menu's Add and Delete in place
of Toggle (`607c0659..ce0ff33e`) and the ru/de help's «называть»/«benennt»
re-wording. Neither commit exists upstream: not on `main`, not on any branch
on GitHub, not in the local clone's objects, reflog or stash, and upstream's
own session finds no trace of the work in its transcripts (2026-10-12).
Upstream `main` still says *Toggle Bookmark at %1$@*. The port was made in a
cloud session (`claude/stoic-greider-ba8704`), so the commits were most likely
made in that session's own copy of the upstream clone and never pushed. The
window therefore starts at `27be11d`, the last commit both histories share,
and `check_anchors.py` cannot run against a baseline that does not exist until
the baseline moves. What the web holds of `ce0ff33e` is behaviour the master
does not have; whether upstream builds it or the web takes it back is the
owner's decision, asked on 2026-10-12.

Standing rules: shared upstream strings word for word, the web's own strings
translated here; help edited in all three languages and re-stamped
(`help-coverage --bless`); anything the browser cannot do is an `unported`
entry with the reason, a test the web has no level for a `later` entry.

The window holds three stories and some fixes:

- **Annotations** (`2220481`, `0247de2`, `66ee745`, `0fa1c01`, `7416d51`,
  `7197e6f`): the agent's marks and findings become one kind, an annotation —
  a title, a note and a place in a file, kept for the session whether the file
  is open or not, drawn by every pane that shows the file. Then cards, places
  in decompressed bytes, annotations made by the person, and a panel of their
  own. Upstream ends the window with a window-tab of its own for them; the web
  keeps the dock panel of `7416d51`, as upstream's `AGENT_PLAN.md` records.
- **The UEFI tree's Contents search** (`4f74159`, `07eaac9`, `8d2f662`,
  `37c9a4d`, `0dc4305`, `de50064`, `ff2ca8e`) and the pattern controls it
  shares with the Find bar (`0137760`).
- **Naming things to the person** (`b7f6d71`, `f755f40`): a label for every
  node and document, and a `byteripper://` link that opens it.
- Fixes: a part opened from a node is that node (`4db7ed7`, `606ba34`), an
  edit does not publish a zone (`03f8943`), a fragment panel let go on a pane
  (`7a11bed`), the PSP's BIOS image after Update Anyway (`b4bb198`), the relay
  that starts the app only when asked (part of `7197e6f`).

## Units

- [x] **X1 — the relay starts the app only when asked** (the relay part of `7197e6f`; G82)
- [x] **X2 — fixes: the PSP's BIOS image goes back after Update Anyway, the compression named** (`b4bb198`, `0dc4305`; G83)
- [x] **X3 — a part opened from a UEFI node is that node** (`4db7ed7`, `606ba34`; G84)
- [x] **X4 — labels for nodes and documents; links n/a** (`b7f6d71`, `f755f40`; G85)
- [x] **X6 — the UEFI tree's Contents search, and `find_bytes` with a node** (`4f74159`, `07eaac9`, `8d2f662`, `37c9a4d`, `ff2ca8e`; G86 — the part's tree opened to the node, Space from the list and `03f8943` carried to X7)
- [x] **X7 — one set of pattern controls for the Find bar and the Contents search** (`0137760`, `de50064`, and X6's remainder; G87)
- [ ] **X5 — annotations, to their end state: one kind for marks and findings, cards, places in decoded bytes, the person's own, a dock panel, Add Annotation on a node** (`2220481`, `0247de2`, `66ee745`, `0fa1c01`, the annotation half of `7416d51`, the rest of `7197e6f`)
- [ ] **X8 — the language named at the call, `uefi_dmi`, and the rest of `7416d51`**
- [ ] **X9 — a fragment panel let go on a pane becomes that pane** (`7a11bed`)

Order, as it turned out: X6 and X7 before X5. Upstream rewrites the
annotations five times inside the window, and the last form leans on the
Contents search (`UEFIContentSearch.Match`, `openContentMatch`,
`nameAfterParent`, the codec badges of a match), so the annotations port once,
to that last form, after the search is in.

### X1. The relay

Done: G82 in `GAPS.md`.

### X2. Fixes

- `b4bb198`: a change inside the BIOS image an AMD PSP decompresses itself is
  a caution, not a refusal — the dialog says what is not known and offers
  **Update Anyway**, which compresses the image again behind AMD's header;
  `update_in_parent` takes `update_anyway`. A changed decompressed size is
  still refused. Web: the update-in-parent refusal and `UefiUpdateDialog`,
  the zlib deflate of `zlibCodec.ts`, the agent tool.
- `0dc4305`: `compressionName` asks the node that opens into the space, not
  the first node at its address (an AMD entry at its BFV's start).
- `03f8943` moved to X6: the case it fixes is a part opened from the
  Contents search's results, and its test is the search's flow.

### X3. A part from a node

`4db7ed7`: a part's layout carries the node it was opened from — its bytes'
own reader where one finds it, otherwise the node as the parent knew it (an
NVRAM store, a descriptor region, an Insyde map range, a FIT structure, an
NVAR variable). `606ba34`: a double click on a node with rows opens the whole
node, header and all; a leaf still opens as its body.

### X4. Labels and links

Every node an answer names has a `label`, and every document a `label` and
`document_label` on every answer; a refusal names a document `label (id)`.
The link is `byteripper://node` and `byteripper://file`, and it names the
file by its path on disk — which a page is never told, in the shell as in the
browser, the shell opening files through the page. So neither edition hands
out links: labels only, the links `unported` with that reason.

### X5. Annotations

`annotate`, `annotations` and `remove_annotations` replace `mark`, `unmark`,
`marks`, `finding` and `findings`; the service keeps them for the session by
file, and every pane showing the file draws them (a part that keeps the file's
addresses too). The Agent window's Marks and Findings pages become one
Annotations page of cards in as many columns as the panel is wide, each in the
shortest column, the card's height its text's (`66ee745`). In Russian:
заметки. Help: the agent page and the notes page in three languages.

### X6. Contents search

The tree's search bar gets a Contents mode: text (ASCII and UTF-16, any case)
or hex with `??`, in the selected node or the whole tree (ticked by default,
the ME region left out), every container opened, every compressed section
searched in what it decompresses to and only there, BIOS Guard in its
assembled region, LENV decoded. Results in a panel under the tree, a row per
match with the node after its parent's name, codec badges, the address; a
click goes to the node and the bytes, a double click or the row's menu opens
the part with the match selected. Runs in the firmware worker, cancellable,
with progress. `find_bytes` with `node` is the same search (`ff2ca8e`;
`uefi_find_bytes`, added and removed inside the window, never reaches the
web). Upstream's `Packages/BytePattern` is the web's `maskedSearch.ts`.
`03f8943` with it: the session remembers whether the dump shows the focus's
zones, and the reading after an edit republishes only those — so typing in a
part opened from the results does not select the node and scroll to its start.

### X7. Pattern controls

The Find bar's pattern field, its recents and library menu, the encoding,
Smart Search and the case toggle as one component the Contents search uses
too; the search keeps what found something, and the field as it is
(`de50064`).

### X8. Annotations, second half

`0fa1c01`: a place in decompressed or decoded bytes keeps its codecs; a
double click opens a fragment panel of those bytes with the place selected,
the panel draws it, a ✕ on the card removes it. `7416d51`: the person adds an
annotation from the dump's context menu on a selection; agent and person
annotations differ in colour and icon (the person's pencil edits it); the
annotations panel in the fragment dock exists while an annotation does, folds
instead of closing, and its pill counts the agent's unseen ones; `uefi_dmi`;
the localization's language named at the call (`L(_:in:)`) where the web's
mechanism differs. `7197e6f`: UEFI Structure's **Add Annotation…** on a node,
and a card's place in a file not open waits for the branches down to it. The
window-tab of `7197e6f` is `unported`: the web keeps the dock panel.

### X9. A panel let go on a pane

`7a11bed`: a part torn off into a tab of its own is the tab's file, and a
panel let go on the tab's free half becomes its second pane. Read against the
web's one workspace per tab before porting: what "a tab of its own" is here
decides whether this is a port or an `n/a`.
