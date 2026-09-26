# Checking an ME Region

> Is the engine firmware there, whole, and for this board?

Open the dump, turn on **Tools ▸ ME Analyzer**, and read the Summary tab.

## What the answers mean

- **"Nothing in this file reads as Intel ME firmware."** Either the dump has no ME region (an AMD board, an older platform, an EC dump) or the region has been erased. Check the [[topic:tool-uefi|UEFI panel]]: if there is an ME region in the descriptor and it is full of `FF`, it has been erased or "cleaned".
- **A version and an SKU.** The region is there and its headers parse. Compare the version against what the board should have — a version from a different platform generation is a donor image from the wrong machine.
- **Messages in the summary.** The analysis raises what it noticed. Read them; they are the short version of what Full Info would tell you.

## Full Info checks

- The [[term:fpt|$FPT]] lists the partitions the region declares. If a partition's bytes are not actually there, or its size does not match what the table says, the region is truncated — a very common result of a bad dump or a partial flash.
- The [[term:cpd|code partitions]] and their modules should be present and their sizes consistent.
- An erased or zero-size section is drawn grey: it is a place in the layout rather than something to read.

## Common situations on a bench

- **A "cleaned" ME** (the region cut down to a bootable minimum by a tool like me_cleaner) is a legitimate state, not damage. The panel will show a much smaller set of partitions.
- **An ME in recovery**, on the board, shows up as a machine that runs for 30 minutes and reboots. If the board does that, the ME region is a good place to look.
- **Provisioned values** live inside the region's configuration. A donor ME brings the donor's.

! Patching the ME region by hand is not a repair. It is verified before it runs, and a modified region gets rejected rather than executed. The repair is to put a matching region in whole — from the vendor's update package for the exact model, or from a known-good dump of the same board — and then leave the board-unique parts alone ([[topic:recipe-board-data|Keeping board-unique data]]).

The words the panel uses are explained in the ME glossary; press the **?** beside the detail list for the row you are looking at.
