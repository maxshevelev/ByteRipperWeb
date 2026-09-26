/**
 * The doors into the help book, in the order a bench walks through them.
 *
 * **One builder, two places.** The toolbar's `?` and the command menu's Help
 * block are the same list, so the toolbar can never offer a shorter one — which
 * is upstream's reason for building its Help menu once and hanging a fresh
 * instance wherever it is needed.
 *
 * Five destinations and no more: the book itself, the two pages a bench walks
 * in through, the two glossaries, and where the knowledge comes from. The one
 * thing a help menu can do better than a window is start the reader somewhere
 * useful.
 *
 * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeHelpMenu
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.showHelpBook
 * @upstream-differs no key equivalent on the first item: upstream's ⌘? is ⌘⇧/
 * in a browser, which several engines have spent, so F1 and ⌘/ carry it and are
 * taken at the window (`AppShell`)
 */

import { TOPIC, termId, termLink, topicLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import { showHelp } from "@/state/helpStore";
import type { MenuEntry } from "@/ui/shell/menuModel";

export function helpMenuEntries(): MenuEntry[] {
  return [
    // help: menu.help.book
    { label: L("ByteRipper Help"), onSelect: () => showHelp(topicLink(TOPIC.overview)) },
    { label: L("Getting Started"), onSelect: () => showHelp(topicLink(TOPIC.firstComparison)) },
    { label: L("Bench Rules"), onSelect: () => showHelp(topicLink(TOPIC.benchSafety)) },
    {
      label: L("Glossary: UEFI Images"),
      onSelect: () => showHelp(termLink(termId("flash-descriptor"))),
    },
    { label: L("Glossary: Intel ME"), onSelect: () => showHelp(termLink(termId("fpt"))) },
    {
      label: L("Where This Knowledge Comes From"),
      onSelect: () => showHelp(topicLink(TOPIC.provenance)),
    },
  ];
}
