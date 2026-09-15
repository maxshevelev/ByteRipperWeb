---
name: port-from-byteripper
description: Find what changed in the macOS ByteRipper repository since this project was last brought level with it, and work out what of it belongs in the web edition. Use when asked to sync with ByteRipper, port upstream changes, check what is new upstream, or update the port baseline.
---

# Porting changes from ByteRipper

ByteRipper (macOS, Swift) is the reference implementation; this repository is
its web edition. Upstream keeps moving, and this skill is how the movement gets
here without anyone re-reading a year of commits.

The rule this skill follows: **it reports and proposes; it never rewrites code
on its own.** A run produces a report and, after you act on it, a diff to
review — the same rule ByteRipper's own skills follow.

## What you need

A ByteRipper clone the script can read. It looks in this order:

1. `--repo <path>`
2. `$BYTERIPPER_REPO`
3. `../ByteRipper` beside this repository

The clone must contain the baseline commit recorded in `PORT_STATE.json`, so
`git fetch` it first if it is stale.

## Running it

```bash
python3 Skills/port-from-byteripper/scripts/port_report.py
```

That prints a Markdown report: the upstream commits since the baseline, grouped
by Swift module and mapped onto the files of this repository, plus two lists
that matter as much as the first — paths that are deliberately **not
applicable**, and paths that are **unmapped** and therefore a decision nobody
has taken yet.

`--json` gives the same thing machine-readably. `--head <ref>` compares against
something other than upstream `HEAD`.

## Working through a report

For each module the report names:

1. **Read the upstream diff.** `git -C ../ByteRipper show <sha> -- <path>`. The
   commit message is usually the design rationale; ByteRipper's commits are
   written to be read.
2. **Decide what the change actually is.** Three kinds turn up, and they are
   treated differently:
   - *Behaviour* — a bug fix in a parser, a corrected checksum rule, a changed
     navigation semantic. **This ports.** It is the reason the skill exists.
   - *AppKit* — a drawing change, a view-controller reshuffle, a layout fix.
     Read it for the intent, port the intent, ignore the mechanism. A canvas
     renderer does not take an `NSView` patch.
   - *Platform* — sandbox, entitlements, signing, file-type registration, tabs
     and window management. Not applicable; if the path is not already covered
     by `notApplicable` in the map, add it there with a reason.
3. **Port it**, in this repository's own idiom. TypeScript that reads like the
   TypeScript around it, not Swift transliterated.
4. **Port the tests with it.** Upstream's unit tests are the cheapest possible
   verification that a port is faithful; a ported parser with upstream's test
   cases behind it is a ported parser you can trust.

Handle the two lists at the end of the report:

- **Unmapped paths** — add an entry to `reference/module-map.json`, either under
  `modules` with the web files it corresponds to, or under `notApplicable` with
  a reason. Leaving it unmapped means it resurfaces every run, which is the
  intended pressure.
- **Not applicable** — skim it once. It is there so that a genuinely relevant
  change cannot hide behind a rule written months ago.

## Recording the new baseline

Only after the work is done and reviewed:

```bash
python3 Skills/port-from-byteripper/scripts/port_report.py --set-base <sha>
```

This rewrites `PORT_STATE.json` and nothing else. Do not advance the baseline
past commits you decided not to port without saying so — put the reason in the
commit message that moves it, so the next reader knows the gap was a decision
rather than an oversight.

## The map

`reference/module-map.json` is the map from upstream paths to this repository's
files, and it doubles as the honest picture of how far the port has got: every
module carries a `status` of `planned`, `in-progress` or `ported`. Keep it
current as part of doing the work, not as a chore afterwards — a stale map makes
every future run lie.

## Anchors

ByteRipper is the master, and the web edition follows its behaviour *and* its
code structure: a type upstream is a module or a component here, a method is a
function, a test is a test. That is what makes a symbol-level check possible,
and the anchors are how the check knows which is which.

- **`@upstream <path>#<Type.member>`** — on every ported declaration: a function,
  a constant, a component, a store field, a test (as a `//` line above its
  `it`). The path is from the ByteRipper root; the symbol is the declaration's
  name qualified by its enclosing types — `ToolController.activate`,
  `ToolPanelView`, `ToolSessionTests.testNoneEndsTheSession`. Overloads share
  one name. One web declaration may carry several anchors.
- **`@upstream-differs <why>`** — on the line after an anchor, when the port
  deliberately does not do what upstream does. The why is the decision.
- **`@web-only <why>`** — on code with no upstream counterpart at all.
- **`unported`** in a module of `reference/module-map.json` —
  `"<path>#<pattern>": "<why>"` for upstream declarations left out on purpose.
  Patterns are shell-style (`ToolPanelView.dragging*`). Start the reason with
  `later —` for work not done yet and `n/a —` for what the browser takes away,
  so the two do not blur.

`Design/GAPS.md` is the human view of those entries: the gaps grouped into rows
to prioritise, and what the web edition does not support. A `later —` or `n/a —`
entry added, or one closed, changes a row there in the same change.
`scripts/unported_summary.py` prints the entries grouped by reason, with counts
and upstream files, which is how the tables are checked against the map:

```bash
python3 Skills/port-from-byteripper/scripts/unported_summary.py --later --no-tests
```

A module's `files` names the upstream files it ports whole; only those are
checked for gaps. A file the web takes a few methods from (a view controller of
thousands of lines) is anchored where it is used and reported as *anchored, not
claimed*.

Run the check after porting and before recording a baseline:

```bash
python3 Skills/port-from-byteripper/scripts/check_anchors.py            # report
python3 Skills/port-from-byteripper/scripts/check_anchors.py --all-mapped  # + files with no anchors yet
python3 Skills/port-from-byteripper/scripts/check_anchors.py --strict   # fail on gaps and drift too
```

It reports broken anchors (the upstream declaration is gone), stale `unported`
entries, **drift** — anchored declarations whose lines changed upstream since
the baseline, with the web code to re-read — gaps in claimed files, and every
deliberate difference. Broken anchors and stale entries fail the run. Drift
clears when the baseline moves past it, which is why the baseline moves only
after the drifted code has been re-read.

The check does not ask for upstream's `private` declarations to be anchored — a
port folds most of them into the code it anchors — so behaviour that lives only
in a private function can go missing unseen. `scripts/private_audit.py` is the
audit for that: the private declarations in claimed files that nothing anchors
or exempts, narrowed to names that appear nowhere in `src/` and are not AppKit
plumbing. Read each row against the web code; a real gap becomes a row in
`Design/GAPS.md` naming the private function, since it has no map entry.

```bash
python3 Skills/port-from-byteripper/scripts/private_audit.py              # the reading list
python3 Skills/port-from-byteripper/scripts/private_audit.py --path Hex/  # one area
```

`reference/` also holds the contract documents this project ports against.
`Design/ANALYSIS.md` in the repository root records which upstream features are
in scope at all, and a change to a feature marked *Dropped* there needs no port —
but if upstream's change makes that verdict look wrong, say so rather than
silently skipping it.
