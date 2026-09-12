import { beforeEach, describe, expect, it } from "vitest";
import { RemoteFetchError } from "@/platform/net/cachedSource";
import type { MicrocodeSource } from "@/state/microcodeCatalogueSource";
import { fixedMicrocodeSource } from "@/state/microcodeCatalogueSource";
import {
  cancelMicrocodeCatalogue,
  forgetMicrocodeCatalogue,
  loadMicrocodeCatalogue,
  microcodeCatalogueMessage,
  microcodeCatalogueStore,
} from "@/state/microcodeCatalogueStore";

/**
 * What the panel is told while the listing is on its way, and what it is told
 * when it does not arrive.
 *
 * The three failures are three different problems with three different
 * answers, and the store keeps them apart so the panel can say which — the
 * rate-limited one most of all, since it is temporary and a bench told to wait
 * needs the button to work when they come back.
 */

const TREE = `{"tree":[
  {"path":"Intel/cpu906EB_plat02_ver0000007C_2017-12-03_PRD_5046D998.bin","type":"blob","size":2048}
]}`;

/** A source that never answers, so "loading" can be looked at. */
const pending: MicrocodeSource = {
  catalogue: () => new Promise(() => undefined),
  download: () => new Promise(() => undefined),
};

const failing = (error: unknown): MicrocodeSource => ({
  catalogue: () => Promise.reject(error),
  download: () => Promise.reject(error),
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  forgetMicrocodeCatalogue();
});

describe("loadMicrocodeCatalogue", () => {
  it("says it is loading, then what it holds and when", async () => {
    loadMicrocodeCatalogue(pending);
    expect(microcodeCatalogueStore.getSnapshot().status).toBe("loading");

    forgetMicrocodeCatalogue();
    loadMicrocodeCatalogue(fixedMicrocodeSource(TREE));
    await settle();

    const state = microcodeCatalogueStore.getSnapshot();
    expect(state.status).toBe("ready");
    expect(state.entries.map((one) => one.cpuidText)).toEqual(["906EB"]);
    expect(state.fetchedAt).toBeTypeOf("number");
    expect(microcodeCatalogueMessage(state)).toBeUndefined();
  });

  it("makes one request when two panels ask", async () => {
    let asked = 0;
    const counted: MicrocodeSource = {
      catalogue: async () => {
        asked++;
        return { entries: [], fetchedAt: Date.now() };
      },
      download: () => Promise.reject(new Error("not asked")),
    };

    loadMicrocodeCatalogue(counted);
    loadMicrocodeCatalogue(counted);
    await settle();

    expect(asked).toBe(1);
  });

  it("names being rate-limited, and stays startable", async () => {
    // It is temporary: a bench told to try again in a few minutes has to find
    // the button working when they do.
    loadMicrocodeCatalogue(failing(new RemoteFetchError({ kind: "rateLimited" })));
    await settle();

    const state = microcodeCatalogueStore.getSnapshot();
    expect(state.status).toBe("failed");
    expect(state.failure).toEqual({ kind: "rateLimited" });
    expect(microcodeCatalogueMessage(state)).toContain("rate-limiting");

    loadMicrocodeCatalogue(fixedMicrocodeSource(TREE));
    await settle();
    expect(microcodeCatalogueStore.getSnapshot().status).toBe("ready");
  });

  it("names being offline, and keeps what the network said", async () => {
    loadMicrocodeCatalogue(
      failing(new RemoteFetchError({ kind: "offline", detail: "network unreachable" }))
    );
    await settle();

    const state = microcodeCatalogueStore.getSnapshot();
    expect(state.failure).toEqual({ kind: "offline", detail: "network unreachable" });
    expect(microcodeCatalogueMessage(state)).toContain("network unreachable");
  });

  it("names a rate limit raised by another copy of the module", async () => {
    // `instanceof` is a question about which copy of a module built the error,
    // and the answer is no whenever there are two — a second module graph, a
    // worker with its own bundle. The browser found exactly this, and it turned
    // "rate-limited", which is temporary, into "offline", which is not.
    class OtherCopy extends Error {
      readonly failure = { kind: "rateLimited" } as const;
    }

    loadMicrocodeCatalogue(failing(new OtherCopy("rate limited")));
    await settle();

    const state = microcodeCatalogueStore.getSnapshot();
    expect(state.failure).toEqual({ kind: "rateLimited" });
    // And the message is not the formatted one wrapped a second time.
    expect(microcodeCatalogueMessage(state)).toBe(
      "GitHub is rate-limiting this address. Try again in a few minutes, or " +
        "choose a file you already have."
    );
  });

  it("reads an error that is not ours as being offline", async () => {
    // A listing that will not parse, a fetch that threw something else: the
    // panel still gets a failure it can print rather than a silent idle.
    loadMicrocodeCatalogue(failing(new Error("that listing has no tree in it")));
    await settle();

    expect(microcodeCatalogueStore.getSnapshot().failure).toEqual({
      kind: "offline",
      detail: "that listing has no tree in it",
    });
  });

  it("treats a cancel as the user's own doing", async () => {
    // Back to idle, not failed: a message about a download the user stopped
    // says nothing they do not already know.
    const abort = new Error("aborted");
    abort.name = "AbortError";
    loadMicrocodeCatalogue(failing(abort));
    await settle();

    const state = microcodeCatalogueStore.getSnapshot();
    expect(state.status).toBe("idle");
    expect(state.failure).toBeUndefined();
  });

  it("goes back to idle when a running download is cancelled", () => {
    loadMicrocodeCatalogue(pending);
    cancelMicrocodeCatalogue();

    expect(microcodeCatalogueStore.getSnapshot().status).toBe("idle");
  });

  it("does not ask again once a listing has landed", async () => {
    loadMicrocodeCatalogue(fixedMicrocodeSource(TREE));
    await settle();

    let asked = 0;
    loadMicrocodeCatalogue({
      catalogue: async () => {
        asked++;
        return { entries: [], fetchedAt: Date.now() };
      },
      download: () => Promise.reject(new Error("not asked")),
    });
    await settle();

    expect(asked).toBe(0);
    expect(microcodeCatalogueStore.getSnapshot().entries).toHaveLength(1);
  });
});
