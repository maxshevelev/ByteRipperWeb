/**
 * What a link is called, in the words a control has room for.
 *
 * A term is written with its quoting — `Flash Partition Table (\`$FPT\`)` — and
 * a tooltip, a breadcrumb or a row of the contents can only hold words, so the
 * markup is read and struck out rather than shown.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpButton.swift#HelpButton.describe
 */

import { type HelpBook, helpTerm, helpTopic } from "@/core/help/helpBook";
import type { HelpLink } from "@/core/help/helpIds";
import { helpSpans, spansPlainText } from "@/core/help/helpMarkup";

/** A name as words alone. */
export const plainHelpName = (name: string): string => spansPlainText(helpSpans(name));

/**
 * What `link` points at is called, or its id while the book is not here yet —
 * which is honest rather than blank, and is what a tooltip says before anybody
 * has opened the help.
 */
export function helpNameOf(book: HelpBook | undefined, link: HelpLink): string {
  if (book === undefined) return String(link.id);
  if (link.kind === "topic") return helpTopic(book, link.id)?.title ?? String(link.id);
  const term = helpTerm(book, link.id);
  return term === undefined ? String(link.id) : plainHelpName(term.name);
}
