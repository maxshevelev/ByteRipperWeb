# Repairing a Dump from a Donor

> The common job: a board that will not post, a dump that is damaged, and a good image from somewhere else.

The aim is almost never to flash the donor image whole. It is to find out **what is broken**, and to move across only that.

1. **Read the patient's chip** and save the dump untouched. Read it twice and compare the two dumps against each other — if they differ, the read is unreliable (bad contact, weak power, a board still partly powered) and nothing after this step means anything.
2. **Open the patient and the donor** side by side ([[topic:first-comparison|comparison]]).
3. **Check the sizes** in the status bars. Different sizes mean different chips or a wrong read — sort that out first.
4. **Turn on [[topic:tool-uefi|UEFI Structure]]** for the patient. The tree tells you which region each address belongs to.
5. **Look at the shape of the damage** in the [[topic:minimap|minimap]] overview: is one block different, or is the image different all over? One block usually means one damaged region; everywhere usually means a different firmware version, which is a different job.
6. **Identify the damaged region.** A region that reads as all `FF` was erased. A region full of noise, or whose structures the panel cannot parse, is corrupted. The panel's summary line and the tree say which.
7. **Move that region over, not the whole file.** Select the region's byte range in the donor (its offsets are in the panel's detail pane; **Edit ▸ Select Block…** takes them as numbers), copy, then select the same range in the patient and paste — plain ⌘V, which **overwrites** and does not move anything.
8. **Put the board's own data back.** A donor region carries the donor's identity — see [[topic:recipe-board-data|Keeping board-unique data]]. This is the step that gets forgotten and the one that produces a board that boots but has the wrong MAC address or no serial number.
9. **Check before flashing**: no red bytes left, the file's size unchanged, checksums right, and a final comparison against the original dump where every difference is one you intended ([[topic:bench-safety|Bench rules]]).

## When the whole image has to be replaced

Sometimes it does — a totally corrupted flash, or a board whose firmware version has to change. Then the donor must be from the **same model and the same hardware revision**, and the board-unique data has to be transplanted into it rather than the other way round.

! Check for [[term:boot-guard|Boot Guard]] first. On a board with Boot Guard fused on, an image signed for another vendor key will not boot, whatever else you do to it, and the panel's protected-range count is your warning.
