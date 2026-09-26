# ME Analyzer

> What Intel's Management Engine firmware in this image is, and what it is made of.

@covers panel.me

**Tools ▸ ME Analyzer** runs an analysis of the [[term:me-region|ME region]] and shows it on two tabs.

## Summary

The report a bench reads first: the firmware family and version, the [[term:sku|SKU]], the release and type, the [[term:svn|security version numbers]], whether the image is a full production firmware or an update, and any messages the analysis raised.

Copy it as text (for a note or a job sheet) or as a picture, with the two buttons in the tab row.

## Full Info

Everything the analysis decoded, as a tree of the real structures in the region, each row standing for real bytes: the [[term:fpt|partition table]], the [[term:cpd|code partitions]] and their modules, the [[term:manifest|manifests]], the [[term:mfs|file system]] and its configuration, the [[term:oem-config|OEM configuration]], the [[term:utok|unlock tokens]].

Select a row and the dump scrolls to those bytes and outlines them. The detail list under the tree is what that row's header actually says.

## Reading it on a bench

Three questions the panel answers quickly:

- **Is there ME firmware here at all, and what version?** A region full of `FF` is an erased or "cleaned" ME. A version wildly older than the board is a donor dump from the wrong machine.
- **Is it complete?** The tree lists the partitions the [[term:fpt|$FPT]] declares. A partition whose bytes are not there, or whose size does not match, is a truncated or damaged region.
- **Is it configured for this board?** The [[term:mfs|MFS]] configuration and the [[term:oem-config|OEM configuration]] are where board-specific settings live. A donor image brings the donor's settings.

! The ME region is verified by the engine itself before it runs. Hand-editing it is not a repair — it produces a board that hangs, reboots on a timer, or refuses to come out of reset. Replace the whole region with a matching one instead. See [[topic:recipe-me-check|Checking an ME region]].

## What the names mean

Every acronym in this panel has a glossary entry: select a row and press the **?** beside the detail list for the term that row is about, or open the ME glossary from the help window's contents.

Where the decode comes from, and how far it can be trusted, is [[topic:provenance|its own page]] — worth reading once.
