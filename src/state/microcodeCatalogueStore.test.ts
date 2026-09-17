import { beforeEach, describe, expect, it } from "vitest";
import { RemoteFetchError } from "@/platform/net/cachedSource";
import type { MicrocodeSource } from "@/state/microcodeCatalogueSource";
import { fixedMicrocodeSource } from "@/state/microcodeCatalogueSource";
import {
  cancelMicrocodeCatalogue,
  loadMicrocodeCatalogue,
  microcodeCatalogueMessage,
  microcodeCatalogueStore,
} from "@/state/microcodeCatalogueStore";
import { entriesFromTree, type MicrocodeCatalogueEntry } from "@/tools/fit/microcodeCatalogue";

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

/** A second listing, for the day's check landing behind an answer. */
const NEWER_TREE = `{"tree":[
  {"path":"Intel/cpu906EB_plat02_ver0000007C_2017-12-03_PRD_5046D998.bin","type":"blob","size":2048},
  {"path":"Intel/cpu906EA_plat02_ver000000F4_2020-01-01_PRD_1F2A3B4C.bin","type":"blob","size":2048}
]}`;

/**
 * A source with only the part a case is about, and a stub for the rest — the
 * four members a case is not about are never what it is asserting on.
 */
const stub = (over: Partial<MicrocodeSource>): MicrocodeSource => {
  const at = Date.now();
  return {
    catalogue: async () => entriesFromTree(TREE),
    download: () => Promise.reject(new Error("not asked")),
    changes: () => () => undefined,
    freshness: () => ({ changedAt: at, checkedAt: at }),
    markStale: () => undefined,
    ...over,
  };
};

/** A source that never answers, so "loading" can be looked at. */
const pending = stub({
  catalogue: () => new Promise(() => undefined),
  download: () => new Promise(() => undefined),
});

const failing = (error: unknown): MicrocodeSource =>
  stub({
    catalogue: () => Promise.reject(error),
    download: () => Promise.reject(error),
  });

/** A source that counts the asks, and answers with one entry of its own. */
const counted = (onAsked: () => void): MicrocodeSource =>
  stub({
    catalogue: async () => {
      onAsked();
      return entriesFromTree(TREE);
    },
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  // The store is one per session, so a case starts from nothing held. The
  // sources a case installs are its own; the live one holds nothing.
  cancelMicrocodeCatalogue();
  microcodeCatalogueStore.update(() => ({
    status: "idle",
    entries: [],
    fetchedAt: undefined,
    failure: undefined,
  }));
});

describe("loadMicrocodeCatalogue", () => {
  it("says it is loading while nothing is in hand", () => {
    loadMicrocodeCatalogue(pending);

    const state = microcodeCatalogueStore.getSnapshot();
    expect(state.status).toBe("loading");
    expect(state.failure).toBeUndefined();
  });

  it("says what it holds and when a listing lands", async () => {
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
    const source = counted(() => asked++);

    loadMicrocodeCatalogue(source);
    loadMicrocodeCatalogue(source);
    await settle();

    expect(asked).toBe(1);
  });

  it("leaves what it holds on screen while the day's check runs behind it", async () => {
    // The listing is in hand, so a second ask is not a wait: the panel keeps
    // what it is reading and the source decides, behind the answer, whether a
    // check is even due (`Freshened`).
    loadMicrocodeCatalogue(fixedMicrocodeSource(TREE));
    await settle();

    let asked = 0;
    loadMicrocodeCatalogue(counted(() => asked++));

    expect(microcodeCatalogueStore.getSnapshot().status).toBe("ready");
    expect(microcodeCatalogueStore.getSnapshot().entries).toHaveLength(1);
    await settle();
    expect(asked).toBe(1);
  });

  it("takes a listing a background check replaced, and says when it changed", async () => {
    // A source with a listing in hand that can still change its mind: the day's
    // check found a newer one, and what it announces is what the store takes.
    let announce: ((entries: readonly MicrocodeCatalogueEntry[]) => void) | undefined;
    const source = stub({
      changes: (listener) => {
        announce = listener;
        return () => undefined;
      },
    });
    loadMicrocodeCatalogue(source);
    await settle();
    expect(microcodeCatalogueStore.getSnapshot().entries).toHaveLength(1);

    announce?.(entriesFromTree(NEWER_TREE));

    const state = microcodeCatalogueStore.getSnapshot();
    expect(state.status).toBe("ready");
    expect(state.entries).toHaveLength(2);
    expect(state.fetchedAt).toBe(source.freshness()?.changedAt);
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
});
