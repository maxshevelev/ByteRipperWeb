import type { Release } from "@/core/updates/releases";

/**
 * The first paragraph of a release body, read as the prose it is written in.
 *
 * The body is markdown, but the opening paragraph is the summary the release
 * is written with — plain sentences, wrapped over source lines the way a
 * paragraph wraps. The reading is: the first paragraph that says anything, its
 * wrapped lines joined into one line, and the marks the prose may carry
 * reduced to the prose itself — **bold** and `code` lose their marks, a link
 * keeps its words and loses its destination. What is left is what the landing
 * screen prints under the version, and it is the whole of it: the sections and
 * the lists the body carries are not a summary.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#Release.firstParagraph
 */
export function firstParagraph(body: string): string {
  const normalized = body.replaceAll("\r\n", "\n");
  // A paragraph ends at a blank line; a single newline inside one is a wrap,
  // not a break.
  const first = normalized.split("\n\n").find((block) => block.trim() !== "");
  if (first === undefined) return "";
  let text = first
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
  // `[words](destination)` keeps its words. Measured against the shape the
  // bodies carry: the words have no `]` in them, and the destination has no
  // `)` in it.
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replaceAll("**", "");
  text = text.replaceAll("`", "");
  return text.trim();
}

/**
 * The opening paragraph of the notes as plain prose — the only part the
 * landing screen shows — or nothing when there is no paragraph to show: no
 * notes at all, or notes whose first paragraph is empty.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#Release.summary
 */
export const releaseSummary = (release: Release): string =>
  release.body === undefined ? "" : firstParagraph(release.body);
