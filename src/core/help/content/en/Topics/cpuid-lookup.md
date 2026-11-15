# Intel CPUID Lookup

> A [[edition:panel||window]] that searches the table of Intel processors by CPUID, model, S-SPEC, code name or stepping — the same table the FIT panel names processors from.

@covers window.cpuid-lookup
@covers menu.window.cpuid-lookup

**Window ▸ Intel CPUID Lookup** [[edition:opens the lookup as a panel over the panes, with a pill in the dock along the bottom edge ([[topic:fragments|Fragment Panels]]); asked for again, it raises the panel. **Esc** in an empty search field, the pill or the ⌄ in the panel's header folds it into the pill, and ✕ on the pill closes it. The lookup belongs to no dump||opens a window of its own, which belongs to no dump and can stay open beside them. There is one such window for the whole application, whichever window it is opened from; asked for again, it comes forward]]. It answers the questions a bench asks about a processor: which CPUID a chip with a given S-SPEC has, which models stand behind the CPUID of a microcode, and which other processors the same microcode update serves.

## Searching

Type into the search field. The table below lists every model the query matches, with its CPUID, its S-SPEC codes, the stepping and the code name. Case, spaces and punctuation are ignored, so `i72600k`, `i7 2600K` and `Core i7-2600K` find the same model. Several words narrow the search: every word must be found in the row, as in `xeon 906EA`. A CPUID the table writes with an `X`, such as `606AX`, stands for every CPUID with any hexadecimal digit in that place and is found by each of them. What matched is marked in each row.

While typing, a list under the field offers completions — CPUIDs, S-SPEC codes, models and code names, each with what it belongs to. **↑** and **↓** move through it, **Return** takes the completion chosen, **Esc** closes the list, and a click takes a completion directly. The magnifier in the field opens the last ten searches; a search is remembered when **Return** is pressed, when a completion is taken, or when it has stood unchanged for two seconds and found something. **Clear Recents** in the same menu removes them.

Clicking a column title sorts the table by that column; a second click reverses the order. A double click on a row looks up its CPUID. The columns are made wider or narrower by dragging the boundary between their titles; a double click on the boundary restores the original widths, and the widths are kept. The table and the entry above it are set in the size chosen for the dump in [[topic:settings|Settings]], as the tool panels are.

## A CPUID typed whole

When the query is exactly one CPUID, everything the table knows about it is shown above the models: the code names, the steppings, the product family, the segment, the cores and the number of models. **Shared microcode** lists the microcode updates that also serve other CPUIDs through their extended signature table, with each update's revision and date; a click on one of those CPUIDs looks it up. For CPUIDs added to the table from Intel's own documents, **Notes** and **Sources** give the reasoning (in English) and the pages each fact was read from, with the quoted line; a click on a page opens it in [[edition:a new tab||the browser]]. Where the table lists no models for the CPUID, this is all the [[edition:panel||window]] shows. A CPUID the table has no entry for, but which a microcode update names, is still shown with the updates that serve it.

## Copying

[[edition:[[key:copy]]||**Edit ▸ Copy**]] copies the selected rows, one line per row with the columns separated by tabs. A click selects a row; with ⌘ or Ctrl held, a click adds a row to the selection or takes it away, and with Shift held it selects every row up to the one clicked; **↑** and **↓** move the selection. The context menu of a row also offers **Copy S-SPEC**, **Copy Model** and **Copy Row**, and for a single row **Look Up CPUID** with its CPUID.

## Where the table comes from

The table is the public repository `github.com/maxshevelev/IntelCPUID`, the one described in [[topic:tool-fit|FIT Table]]; the link at the bottom of the [[edition:panel||window]] opens it, and the date beside it is the day its sources were last read. The lookup and the FIT panel read one and the same copy: opening either of them asks the repository whether the table changed, at most once a day, and a newer table, once read, is shown by both. The last copy read in full is kept [[edition:in this browser||on this computer]] and is what the lookup searches without a network; before any copy has been read, the [[edition:panel||window]] says so and finds nothing. See also [[topic:databases|The Online Catalogues]].

The table is not complete and says so: a model whose S-SPEC is not known is listed with a dash, and a CPUID it does not contain is not found. It lists every model sold with a CPUID, whatever the platform of a particular board.
