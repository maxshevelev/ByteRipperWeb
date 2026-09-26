/**
 * The blocks of a page, drawn.
 *
 * A page is a list of values the parser produced, so this is a `switch` and
 * nothing more: no Markdown at render time, no HTML from a content file, and
 * no way for a page to reach past the four inline forms it is allowed.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpText.swift#HelpText
 * @upstream-differs upstream builds one `NSAttributedString` per page, with the
 * fonts and the paragraph styles in code; a browser has elements and a
 * stylesheet, so a block is an element and every rule about how it looks is in
 * `app.css`
 */

import type { HelpLink } from "@/core/help/helpIds";
import { linkKey } from "@/core/help/helpIds";
import type { HelpBlock, HelpSpan } from "@/core/help/helpMarkup";

/**
 * One run of text.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpText.swift#HelpText.attributed
 */
function Span({
  span,
  onFollow,
}: {
  readonly span: HelpSpan;
  readonly onFollow: (link: HelpLink) => void;
}) {
  switch (span.kind) {
    case "text":
      return <>{span.text}</>;
    case "strong":
      return <strong>{span.text}</strong>;
    case "code":
      return <code className="help-code">{span.text}</code>;
    case "link":
      return (
        <button type="button" className="help-link" onClick={() => onFollow(span.link)}>
          {span.text}
        </button>
      );
  }
}

/** A run of spans, keyed by where each sits in the line. */
function Spans({
  spans,
  onFollow,
}: {
  readonly spans: readonly HelpSpan[];
  readonly onFollow: (link: HelpLink) => void;
}) {
  return (
    <>
      {spans.map((span, index) => (
        <Span
          // The line is a value that only changes when the page does, so its
          // index is a stable key — and two identical words in one sentence
          // are not the same run.
          // biome-ignore lint/suspicious/noArrayIndexKey: the position in the line is the identity
          key={`${span.kind}:${index}`}
          span={span}
          onFollow={onFollow}
        />
      ))}
    </>
  );
}

/**
 * One block of a page.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpText.swift#HelpText.append
 */
function Block({
  block,
  onFollow,
}: {
  readonly block: HelpBlock;
  readonly onFollow: (link: HelpLink) => void;
}) {
  switch (block.kind) {
    case "heading":
      return <h3 className="help-heading">{block.text}</h3>;
    case "paragraph":
      return (
        <p className="help-paragraph">
          <Spans spans={block.spans} onFollow={onFollow} />
        </p>
      );
    case "bullets":
      return (
        <ul className="help-bullets">
          {block.items.map((item, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an item's place in the list is its identity
            <li key={at}>
              <Spans spans={item} onFollow={onFollow} />
            </li>
          ))}
        </ul>
      );
    case "steps":
      // Numbered by the list, never by the file: a step inserted in the middle
      // of a translated page cannot then be misnumbered.
      return (
        <ol className="help-steps">
          {block.items.map((item, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an item's place in the list is its identity
            <li key={at}>
              <Spans spans={item} onFollow={onFollow} />
            </li>
          ))}
        </ol>
      );
    case "caution":
      return (
        <p className="help-caution" role="note">
          <Spans spans={block.spans} onFollow={onFollow} />
        </p>
      );
  }
}

/**
 * A page's body.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpBodyView.swift#HelpBodyView
 */
export function HelpBlocks({
  blocks,
  onFollow,
}: {
  readonly blocks: readonly HelpBlock[];
  readonly onFollow: (link: HelpLink) => void;
}) {
  return (
    <>
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a block's place in the page is its identity
        <Block key={`${block.kind}:${index}`} block={block} onFollow={onFollow} />
      ))}
    </>
  );
}

/** A link's key, for a list that shows several of them. */
export const helpLinkKey = linkKey;
