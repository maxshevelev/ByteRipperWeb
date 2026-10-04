import { describe, expect, it } from "vitest";
import { releaseFromJson } from "@/core/updates/releases";

const repository = "https://github.com/maxshevelev/ByteRipperWeb";

describe("reading a release out of github.com's answer", () => {
  it("carries the body its answer has, and nothing when the answer has none", () => {
    const withBody = releaseFromJson(
      {
        tag_name: "v0.9-1",
        html_url: "https://github.com/x/y/releases/tag/v0.9-1",
        body: "The notes.",
      },
      repository
    );
    expect(withBody?.body).toBe("The notes.");

    const without = releaseFromJson(
      { tag_name: "v0.9-1", html_url: "https://github.com/x/y/releases/tag/v0.9-1" },
      repository
    );
    expect(without?.body).toBeUndefined();
  });

  it("does not read a body that is not text", () => {
    const notText = releaseFromJson({ tag_name: "v0.9-1", body: 42 }, repository);
    expect(notText?.body).toBeUndefined();
  });
});
