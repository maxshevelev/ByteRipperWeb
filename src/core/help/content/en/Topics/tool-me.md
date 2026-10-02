# ME Analyzer

> Which Intel Management Engine firmware the image holds, and which structures it is composed of.

@covers panel.me

**Tools ▸ ME Analyzer** analyses the [[term:me-region|ME region]] of the file in its pane and reports the result on two tabs.

## Summary

A report of what the firmware is: its family and version, its [[term:sku|SKU]], its release and type, the [[term:svn|security version numbers]], whether the image is a complete firmware or an update, and the messages the analysis raised. The individual rows are described in [[topic:recipe-me-check|Reading the ME Region Report]].

The row labels are in English in every language of the interface, as they are the labels of the project the analysis is derived from. See [[topic:provenance|Where This Knowledge Comes From]].

The tab is shown as soon as the region has been read. Some values depend on databases of the project the analysis is derived from, which are downloaded while the panel is open. Until they have been downloaded and taken into account, those values read **Loading…**, and the line at the bottom of the panel says what is being downloaded. They are the **File System State** of a firmware with an EFS volume, and **Module checks** at the end of **Messages**; the **Issues** group on the **Full Info** tab shows the same row. The messages above it are final. If a database cannot be downloaded, the values shown stand.

The two buttons in the tab row copy the tab as text or as an image of the panel.

## Full Info

The structures the analysis decoded, as a tree in which every row corresponds to actual bytes of the region: the [[term:fpt|partition table]], the [[term:cpd|code partitions]] and their modules, the [[term:manifest|manifests]], the [[term:mfs|file system]] and its configuration, the [[term:oem-config|OEM configuration]] and the [[term:utok|unlock tokens]].

Selecting a row scrolls the dump to those bytes and outlines them. The detail list under the tree holds the fields of that row's header as they are recorded in the file.

## What the tool reports

- **Whether the image holds ME firmware, and of which version.** A region consisting of `FF` holds none. The version identifies the generation of the platform the firmware was built for.
- **Whether the region is complete.** The tree lists the partitions declared by the [[term:fpt|$FPT]] table. A partition whose bytes are absent, or whose declared length does not agree with the region, is reported as such.
- **Whether the region carries a configuration, and of what kind.** Board-specific settings are held in the [[term:mfs|MFS]] configuration and in the [[term:oem-config|OEM configuration]]; the **File System State** row reports which of the three states the file system is in.

! The engine verifies the ME region before it starts. A region altered in place is not accepted by it, and no editor can produce a manifest signature the engine will accept. What the states of the region mean, and what follows from moving a region between boards, is set out in [[topic:recipe-me-check|Reading the ME Region Report]].

## The terms the tool uses

Every abbreviation in this panel has a glossary entry: select a row and press **?** beside the detail list to open the entry for that row, or open the ME glossary from the contents of this book.

Where the decoding comes from, and how far it can be relied on, is set out in [[topic:provenance|Where This Knowledge Comes From]].
