/**
 * The help book, in the panel over the panes (`Design/HELP.md`).
 *
 * Upstream opens a window with a contents outline down its side; there are no
 * windows here, so the book takes a pill in the fragment dock and this is what
 * rises from it. The panel is wide and short where that window is tall, which
 * is the one thing the layout has to answer for: the contents is a column
 * beside the page, and folds into a button when the panel is too narrow to
 * hold both.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpWindowController.swift#HelpWindowController
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpWindowController.swift#HelpWindowController
 * @upstream-differs a panel in the dock rather than a window, and the outline
 * is a column that collapses rather than a sidebar that is always there
 */

import { useEffect, useRef } from "react";
import type { HelpBook } from "@/core/help/helpBook";
import {
  glossaryName,
  helpTerm,
  helpTermsIn,
  helpTopic,
  resultLink,
  resultSummary,
  resultTitle,
  searchHelp,
} from "@/core/help/helpBook";
import { type HelpLink, linkKey, sameLink, termLink, topicLink } from "@/core/help/helpIds";
import { helpSpans } from "@/core/help/helpMarkup";
import { HELP_TERM_GROUPS, type HelpTermGroup } from "@/core/help/helpTopic";
import { L } from "@/core/localization/localization";
import {
  closeHelp,
  goToHelp,
  helpBack,
  helpCanGoBack,
  helpCanGoForward,
  helpForward,
  helpHere,
  helpStore,
  setHelpQuery,
  toggleHelpContents,
} from "@/state/helpStore";
import { useStore } from "@/state/useStore";
import { foldParts } from "@/state/workspaceStore";
import { HelpBlocks } from "@/ui/help/HelpBlocks";
import { helpNameOf, plainHelpName } from "@/ui/help/helpNames";
import { CloseButton } from "@/ui/shell/CloseButton";

/**
 * The whole panel: a header that says where the reader is and how to leave, and
 * the book under it.
 */
export function HelpPanel() {
  const state = useStore(helpStore);
  const { book, query } = state;
  const here = helpHere(state);
  const search = useRef<HTMLInputElement>(null);
  const page = useRef<HTMLDivElement>(null);

  // The keyboard lands in the search field when the panel opens: it is the one
  // control that is useful before the reader has decided anything, and a field
  // that has to be clicked first is a field nobody uses on a bench.
  useEffect(() => {
    search.current?.focus();
  }, []);

  // A new page starts at its top. Without this the reader who followed a link
  // from the foot of a long page lands in the middle of the next one, looking
  // at a paragraph that has nothing to do with what they clicked — measured,
  // and it is the same rule the tool detail follows for a new subject.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the page's identity is what resets the scroll, not the element
  useEffect(() => {
    if (page.current !== null) page.current.scrollTop = 0;
  }, [here === undefined ? undefined : linkKey(here), query.trim() === ""]);

  const results = book === undefined || query.trim() === "" ? [] : searchHelp(book, query);

  return (
    <section className="help-panel" aria-label={L("Help", { context: "panel" })}>
      <header className="help-bar">
        <div className="help-history">
          <button
            type="button"
            className="help-step"
            onClick={helpBack}
            disabled={!helpCanGoBack(state)}
            aria-label={L("Back")}
            title={L("Back")}
          >
            ‹
          </button>
          <button
            type="button"
            className="help-step"
            onClick={helpForward}
            disabled={!helpCanGoForward(state)}
            aria-label={L("Forward")}
            title={L("Forward")}
          >
            ›
          </button>
        </div>
        <button
          type="button"
          className="help-contents-toggle"
          onClick={toggleHelpContents}
          aria-expanded={state.contentsOpen}
        >
          {L("Contents")}
        </button>
        <h2 className="help-where">
          {book === undefined ? L("Help", { context: "panel" }) : whereAmI(book, here)}
        </h2>
        <input
          ref={search}
          type="search"
          className="help-search"
          value={query}
          placeholder={L("Search the help")}
          aria-label={L("Search the help")}
          onChange={(event) => setHelpQuery(event.target.value)}
        />
        <button
          type="button"
          className="help-fold"
          onClick={foldParts}
          aria-label={L("Fold the help down")}
          title={L("Fold the help down")}
        >
          ⌄
        </button>
        <CloseButton label="Close the help" onClick={closeHelp} />
      </header>

      <div className="help-body" data-contents={state.contentsOpen ? "" : undefined}>
        {book === undefined ? null : <Contents book={book} here={here} />}
        <div className="help-page" ref={page}>
          {book === undefined ? (
            <p className="help-waiting">
              {state.loading ? L("Fetching the help…") : L("The help is not available.")}
            </p>
          ) : results.length > 0 || query.trim() !== "" ? (
            <Results book={book} query={query} />
          ) : (
            <Page book={book} link={here} />
          )}
        </div>
      </div>
    </section>
  );
}

/** A name with its quoting drawn, for the one place that has room for it. */
function Name({ name }: { readonly name: string }) {
  return (
    <>
      {helpSpans(name).map((span, index) =>
        span.kind === "code" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the run's place in the name is its identity
          <code key={index} className="help-code">
            {span.text}
          </code>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the run's place in the name is its identity
          <span key={index}>{span.text}</span>
        )
      )}
    </>
  );
}

/** The section and the page, so a reader who arrived by a link knows where they are. */
function whereAmI(book: HelpBook, link: HelpLink | undefined): string {
  if (link === undefined) return L("Help", { context: "panel" });
  if (link.kind === "term") {
    const term = helpTerm(book, link.id);
    return term === undefined
      ? L("Help", { context: "panel" })
      : `${glossaryName(book, term.group)} ▸ ${plainHelpName(term.name)}`;
  }
  const topic = helpTopic(book, link.id);
  const section = book.sections.find((one) => one.topics.includes(link.id));
  if (topic === undefined) return L("Help", { context: "panel" });
  return section === undefined ? topic.title : `${section.name} ▸ ${topic.title}`;
}

/**
 * The contents: the sections in the order the book lists them, then the three
 * glossaries with their words.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpWindowController.swift#HelpWindowController
 */
function Contents({
  book,
  here,
}: {
  readonly book: HelpBook;
  readonly here: HelpLink | undefined;
}) {
  return (
    <nav className="help-contents" aria-label={L("Contents")}>
      {book.sections.map((section) => (
        <details key={section.id} open>
          <summary>{section.name}</summary>
          <ul>
            {section.topics.map((id) => {
              const topic = helpTopic(book, id);
              if (topic === undefined) return null;
              const link = topicLink(id);
              return (
                <li key={id}>
                  <Row link={link} here={here} label={topic.title} />
                </li>
              );
            })}
          </ul>
        </details>
      ))}
      {HELP_TERM_GROUPS.map((group) => (
        <Glossary key={group} book={book} group={group} here={here} />
      ))}
    </nav>
  );
}

/** One glossary, shut until a reader wants it: it is a long list of short things. */
function Glossary({
  book,
  group,
  here,
}: {
  readonly book: HelpBook;
  readonly group: HelpTermGroup;
  readonly here: HelpLink | undefined;
}) {
  const terms = helpTermsIn(book, group);
  if (terms.length === 0) return null;
  const holdsHere = here?.kind === "term" && terms.some((term) => term.id === here.id);
  return (
    <details open={holdsHere}>
      <summary>{glossaryName(book, group)}</summary>
      <ul>
        {terms.map((term) => (
          <li key={term.id}>
            <Row link={termLink(term.id)} here={here} label={plainHelpName(term.name)} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** One row of the contents. */
function Row({
  link,
  here,
  label,
}: {
  readonly link: HelpLink;
  readonly here: HelpLink | undefined;
  readonly label: string;
}) {
  const current = here !== undefined && sameLink(here, link);
  return (
    <button
      type="button"
      className="help-row"
      data-current={current ? "" : undefined}
      aria-current={current ? "page" : undefined}
      onClick={() => goToHelp(link)}
    >
      {label}
    </button>
  );
}

/**
 * A page, or a glossary entry — which is a page with a sentence at the top and
 * its cross-references at the bottom.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpBodyView.swift#HelpBodyView.show
 */
function Page({ book, link }: { readonly book: HelpBook; readonly link: HelpLink | undefined }) {
  if (link === undefined) return null;

  if (link.kind === "term") {
    const term = helpTerm(book, link.id);
    if (term === undefined) return <MissingPage />;
    return (
      <article className="help-article">
        <h1 className="help-title">
          <Name name={term.name} />
        </h1>
        {term.summary === "" ? null : <p className="help-summary">{term.summary}</p>}
        <HelpBlocks blocks={term.blocks} onFollow={goToHelp} />
        {term.seeAlso.length === 0 ? null : (
          <p className="help-see-also">
            <span className="help-see-also-label">{L("See also:")}</span>
            {term.seeAlso.map((see) => (
              <button
                key={linkKey(see)}
                type="button"
                className="help-link"
                onClick={() => goToHelp(see)}
              >
                {helpNameOf(book, see)}
              </button>
            ))}
          </p>
        )}
      </article>
    );
  }

  const topic = helpTopic(book, link.id);
  if (topic === undefined) return <MissingPage />;
  return (
    <article className="help-article">
      <h1 className="help-title">{topic.title}</h1>
      {topic.summary === "" ? null : <p className="help-summary">{topic.summary}</p>}
      <HelpBlocks blocks={topic.blocks} onFollow={goToHelp} />
    </article>
  );
}

/** What a link into nothing shows. The content tests make this unreachable. */
const MissingPage = () => (
  <p className="help-waiting">{L("That page has not been written yet.")}</p>
);

/**
 * What the reader typed, matched over title, summary and body. Pages first,
 * then terms, each in the order the book lists it — no ranking, the book being
 * forty pages.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpWindowController.swift#HelpWindowController.search
 */
function Results({ book, query }: { readonly book: HelpBook; readonly query: string }) {
  const hits = searchHelp(book, query);
  if (hits.length === 0) {
    return <p className="help-waiting">{L("Nothing in the help matches “%1$@”.", query.trim())}</p>;
  }
  return (
    <ul className="help-results" aria-label={L("Search results")}>
      {hits.map((hit) => (
        <li key={linkKey(resultLink(hit))}>
          <button type="button" className="help-result" onClick={() => goToHelp(resultLink(hit))}>
            <span className="help-result-title">{plainHelpName(resultTitle(hit))}</span>
            <span className="help-result-summary">{resultSummary(hit)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
