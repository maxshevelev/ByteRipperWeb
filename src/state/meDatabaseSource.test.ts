import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveDictionaries } from "@/state/huffmanDictionaryStore";
import { liveDatabase } from "@/state/meDatabaseStore";

/** What the server will answer next, in order; and what it was asked. */
interface Answer {
  readonly status: number;
  readonly body: string;
  readonly etag?: string | undefined;
  /** The request fails instead of answering — no network. */
  readonly offline?: boolean;
}

const ok = (body: string, etag?: string): Answer => ({ status: 200, body, etag });
const notModified: Answer = { status: 304, body: "" };
const failing: Answer = { status: 0, body: "", offline: true };

/**
 * A server the test scripts, behind `fetch`, and the Cache API the copies are
 * kept in, in memory. What is under test is the HTTP: the conditional request,
 * the `304`, and what is held when the answer never comes.
 *
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEAGitHubDataRepositoryTests.swift#StubProtocol
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEAGitHubDataRepositoryTests.swift#StubProtocol.Script
 * @upstream-differs `fetch` and `caches` stubbed with vitest, where upstream registers a URLProtocol; the clock is vitest's fake one, where upstream hands the repository a `Ticker`
 */
function installNetwork() {
  const answers: Answer[] = [];
  const asked: { path: string; ifNoneMatch: string | undefined }[] = [];
  const stored = new Map<string, Response>();
  vi.stubGlobal("caches", {
    open: async () => ({
      match: async (url: string) => stored.get(url)?.clone(),
      put: async (url: string, response: Response) => {
        stored.set(url, response.clone());
      },
    }),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      asked.push({
        path: url.split("/").at(-1) ?? "",
        ifNoneMatch: new Headers(init?.headers).get("If-None-Match") ?? undefined,
      });
      const answer = answers.shift() ?? ok("");
      if (answer.offline === true) throw new TypeError("Failed to fetch");
      return new Response(answer.status === 304 ? null : answer.body, {
        status: answer.status,
        headers: answer.etag === undefined ? {} : { ETag: answer.etag },
      });
    })
  );
  return { queue: (answer: Answer) => answers.push(answer), asked };
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** A line MEA.dat's parser accepts, so the text is a real database. */
const body = "Revision r300\n";

/**
 * The ME databases' source — one fetch per run, a check once a day, and what
 * happens on a bench whose network is gone.
 *
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEAGitHubDataRepositoryTests.swift#MEAGitHubDataRepositoryTests
 * @upstream-differs one source per file, each over the Cache API, where upstream's one repository holds all three; the database is the file's text, which the worker parses
 */
describe("the ME databases' source", () => {
  let network: ReturnType<typeof installNetwork>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    network = installNetwork();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEAGitHubDataRepositoryTests.swift#MEAGitHubDataRepositoryTests.testTheSecondFileInARunCostsNoRequest
  it("answers the second file in a run from memory", async () => {
    network.queue(ok(body, "etag-1"));
    const source = liveDatabase();

    await source.load();
    vi.advanceTimersByTime(HOUR);
    await source.load();

    expect(network.asked.length).toBe(1);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEAGitHubDataRepositoryTests.swift#MEAGitHubDataRepositoryTests.testAfterADayItAsksWithTheStoredETag
  it("asks with the stored validator after a day", async () => {
    network.queue(ok(body, "etag-1"));
    network.queue(notModified);
    const source = liveDatabase();

    await source.load();
    vi.advanceTimersByTime(DAY + 1);
    await source.load();
    await source.settle();

    expect(network.asked.length).toBe(2);
    // Nothing held, nothing to present.
    expect(network.asked[0]?.ifNoneMatch).toBeUndefined();
    expect(network.asked[1]?.ifNoneMatch).toBe("etag-1");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEAGitHubDataRepositoryTests.swift#MEAGitHubDataRepositoryTests.testANotModifiedKeepsTheDatabaseAndRestartsTheDay
  it("keeps the database on a 304, and starts the day again from the check", async () => {
    network.queue(ok(body, "etag-1"));
    network.queue(notModified);
    const source = liveDatabase();

    const first = await source.load();
    vi.advanceTimersByTime(DAY + 1);
    const second = await source.load();
    expect(second).toBe(first);
    await source.settle();

    vi.advanceTimersByTime(23 * HOUR);
    await source.load();
    // The day runs from the check, not from the fetch.
    expect(network.asked.length).toBe(2);
  });

  // The reading does not stop for a check: what is held answers at once and the
  // check runs behind it. This is the pause a bench used to blame on the tool
  // being slow — it was 350 KB arriving over somebody's hotel wifi.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEAGitHubDataRepositoryTests.swift#MEAGitHubDataRepositoryTests.testAnAnalysisDoesNotWaitForTheDailyCheck
  it("does not make an analysis wait for the day's check", async () => {
    network.queue(ok(body, "etag-1"));
    network.queue(ok("Revision r400\n", "etag-2"));
    const source = liveDatabase();

    await source.load();
    vi.advanceTimersByTime(DAY + 1);

    // Answered from what is held, not from the network.
    expect(await source.load()).toBe(body);
    // And the newer one is what the next reading gets.
    await source.settle();
    expect(await source.load()).toBe("Revision r400\n");
  });

  // Which is only honest if the panel is told, so it can read again against the
  // database that has just arrived.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEAGitHubDataRepositoryTests.swift#MEAGitHubDataRepositoryTests.testANewerDatabaseIsAnnounced
  it("announces a newer database", async () => {
    network.queue(ok(body, "etag-1"));
    network.queue(ok("Revision r400\n", "etag-2"));
    const source = liveDatabase();
    const announced: string[] = [];
    source.changes((text) => announced.push(text));

    await source.load();
    vi.advanceTimersByTime(DAY + 1);
    await source.load();
    await source.settle();

    // The analysis was made against the database before this one.
    expect(announced).toEqual(["Revision r400\n"]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEAGitHubDataRepositoryTests.swift#MEAGitHubDataRepositoryTests.testACheckThatCannotBeMadeKeepsYesterdaysDatabase
  it("keeps yesterday's database when the check cannot be made", async () => {
    network.queue(ok(body, "etag-1"));
    network.queue(failing);
    const source = liveDatabase();

    const first = await source.load();
    vi.advanceTimersByTime(DAY + 1);
    const second = await source.load();
    await source.settle();

    // No network is not a reason to lose what the tool already has.
    expect(second).toBe(first);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEAGitHubDataRepositoryTests.swift#MEAGitHubDataRepositoryTests.testAFailedFirstFetchDoesNotOutliveTheNetworkThatCausedIt
  it("does not let a failed first fetch outlive the network that caused it", async () => {
    network.queue(failing);
    network.queue(ok(body, "etag-1"));
    const source = liveDatabase();

    // Nothing is held, so the error belongs to the caller.
    await expect(source.load()).rejects.toThrow();

    // Cable back in, tool opened again — in the same run.
    expect(await source.load()).toBe(body);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEAGitHubDataRepositoryTests.swift#MEAGitHubDataRepositoryTests.testMEADatAndHuffmanDatAreCheckedSeparately
  it("checks MEA.dat and Huffman.dat separately", async () => {
    network.queue(ok(body, "etag-mea"));
    network.queue(ok("", "etag-huff"));

    await liveDatabase().load();
    await liveDictionaries()
      .load()
      .catch(() => undefined);

    expect(network.asked.map((one) => one.path)).toEqual(["MEA.dat", "Huffman.dat"]);
  });
});
