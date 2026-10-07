import { describe, expect, it } from "vitest";
import { helpHash, helpLinkOfHash } from "@/core/help/helpAddress";
import { type HelpTermId, type HelpTopicId, termLink, topicLink } from "@/core/help/helpIds";

describe("a help page's address", () => {
  it("is the topic's id, and the term's under term/", () => {
    expect(helpHash(topicLink("opening-files" as HelpTopicId))).toBe("#help/opening-files");
    expect(helpHash(termLink("pch" as HelpTermId))).toBe("#help/term/pch");
  });

  it("reads back as the page it was made from", () => {
    for (const link of [
      topicLink("tool-uefi" as HelpTopicId),
      termLink("flash-descriptor" as HelpTermId),
    ]) {
      expect(helpLinkOfHash(helpHash(link))).toEqual(link);
    }
  });

  it("names no page for a hash that is not one", () => {
    for (const hash of [
      "",
      "#",
      "#help",
      "#help/",
      "#help/term",
      "#help/term/",
      "#other/x",
      "#help/Bad_Id",
      "#help/a/b",
      "#help/term/pch/x",
    ]) {
      expect(helpLinkOfHash(hash), hash).toBeUndefined();
    }
  });
});
