import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentProcessorTables,
  EMPTY_PROCESSOR_TABLES,
  installProcessorTables,
  notesOn,
} from "@/firmware/intelCpuid/processorTables";
import { INTEL_CPUID_BASE, intelCpuidRepository } from "@/state/intelCpuidRepository";

/**
 * The one repository every reader of the tables asks: what it installs, what it
 * keeps, and how often it asks — upstream's `IntelCPUIDRepositoryTests`, against
 * a stubbed `fetch` and a stubbed Cache API. Nothing here reaches the network.
 */

/**
 * What the test says of one file of the repository.
 *
 * @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#RepositoryStub.Answer
 */
interface Answer {
  readonly status?: number;
  readonly body?: string;
  readonly etag?: string;
  readonly offline?: boolean;
}

/**
 * Answers each file of the repository from what the test says of it, and
 * records the validator each was asked with.
 *
 * @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#RepositoryStub
 * @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#RepositoryStub.Script
 * @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#RepositoryStub.Script.ask
 * @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#RepositoryStub.startLoading
 */
class Script {
  readonly answers = new Map<string, Answer>();
  readonly asked: { readonly file: string; readonly etag: string | undefined }[] = [];

  readonly fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const file = url.slice(url.lastIndexOf("/") + 1);
    const etag = new Headers(init?.headers).get("If-None-Match") ?? undefined;
    this.asked.push({ file, etag });
    const answer = this.answers.get(file) ?? { status: 404 };
    if (answer.offline === true) throw new TypeError("Failed to fetch");
    const status = answer.status ?? 200;
    return new Response(status === 304 ? null : (answer.body ?? ""), {
      status,
      headers: answer.etag === undefined ? {} : { ETag: answer.etag },
    });
  };
}

/**
 * The Cache API a session leaves behind: the kept copy, by URL. Two
 * repositories over one of these are two sessions of one browser; a new one is
 * a browser that has kept nothing.
 *
 * @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.folder
 */
class Kept {
  readonly entries = new Map<string, { readonly text: string; readonly headers: Headers }>();

  readonly caches = {
    open: async () => ({
      match: async (url: string) => {
        const entry = this.entries.get(url);
        return entry === undefined
          ? undefined
          : new Response(entry.text, { headers: new Headers(entry.headers) });
      },
      put: async (url: string, response: Response) => {
        this.entries.set(url, { text: await response.text(), headers: response.headers });
      },
    }),
  };

  text(file: string): string | undefined {
    return this.entries.get(INTEL_CPUID_BASE + file)?.text;
  }
}

const day = 24 * 60 * 60 * 1000;

const names = "IntelCPUIDBrandNames.json";
const signatures = "IntelMicrocodeSignatures.json";
const notes = "extra-entries.json";

/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.namesFile */
function namesFile(code: string, version = 1): Answer {
  return ok(
    JSON.stringify({
      formatVersion: version,
      entries: [
        {
          cpuids: ["806EA"],
          codeNames: ["Kaby Lake Refresh U"],
          cores: [],
          productFamilies: [],
          steppings: ["Y0"],
          segments: [],
          processors: [{ name: "Intel Core i5-8250U", sSpec: [code] }],
        },
      ],
    }),
    `n-${code}`
  );
}

/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.signaturesFile */
const signaturesFile = (): Answer => ok(JSON.stringify({ formatVersion: 1, updates: [] }), "s1");

/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.notesFile */
function notesFile(note: string): Answer {
  return ok(
    JSON.stringify({
      entries: [{ cpuids: ["806EA"], codeNames: ["Kaby Lake Refresh U"], note }],
    }),
    `x-${note}`
  );
}

/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.ok */
const ok = (body: string, etag: string): Answer => ({ status: 200, body, etag });
/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.notModified */
const notModified: Answer = { status: 304 };
/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.offline */
const offline: Answer = { offline: true };

/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.installedCode */
const installedCode = (): string | undefined =>
  currentProcessorTables().families[0]?.processors[0]?.sSpec[0];

/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.installedNote */
function installedNote(): string | undefined {
  const tables = currentProcessorTables();
  const family = tables.families[0];
  return family === undefined ? undefined : notesOn(tables, family)?.note;
}

// @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests
describe("the IntelCPUID repository", () => {
  let script: Script;

  /**
   * A browser's session: a repository over the copy `kept` holds.
   *
   * @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.repository
   */
  function repository(kept: Kept) {
    vi.stubGlobal("caches", kept.caches);
    return intelCpuidRepository();
  }

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.script
  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.ticker
  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#Ticker
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T00:00:00Z"));
    script = new Script();
    vi.stubGlobal("fetch", script.fetch);
    installProcessorTables(EMPTY_PROCESSOR_TABLES);
  });

  afterEach(() => {
    installProcessorTables(EMPTY_PROCESSOR_TABLES);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.testTheTablesAreReadKeptAndCheckedOnceADay
  it("reads the tables, keeps them, and checks them once a day", async () => {
    const kept = new Kept();
    script.answers.set(names, namesFile("SR3LA"));
    script.answers.set(signatures, signaturesFile());
    script.answers.set(notes, notesFile("first"));
    const source = repository(kept);
    await source.refresh();
    expect(installedCode()).toBe("SR3LA");
    expect(installedNote()).toBe("first");
    expect(kept.text(names)).toContain("SR3LA");
    expect(kept.text("Skills/update-cpuid-brand-names/scripts/extra-entries.json")).toContain(
      "first"
    );

    await source.refresh();
    expect(script.asked.length, "the same day asks nothing").toBe(3);

    advance(day + 1);
    script.answers.set(names, notModified);
    script.answers.set(signatures, notModified);
    script.answers.set(notes, notModified);
    await source.refresh();
    expect(
      script.asked.slice(-3).map((one) => [one.file, one.etag]),
      "each asked with its kept ETag"
    ).toEqual(
      expect.arrayContaining([
        [names, "n-SR3LA"],
        [signatures, "s1"],
        [notes, "x-first"],
      ])
    );
    expect(installedCode()).toBe("SR3LA");
    expect(installedNote()).toBe("first");
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.testWithNoNetworkTheKeptCopyIsWhatIsShown
  it("shows the kept copy with no network, and nothing where nothing is kept", async () => {
    const kept = new Kept();
    script.answers.set(names, namesFile("SR3LA"));
    script.answers.set(signatures, signaturesFile());
    await repository(kept).refresh();

    installProcessorTables(EMPTY_PROCESSOR_TABLES);
    script.answers.set(names, offline);
    script.answers.set(signatures, offline);
    // A day on, so the next session's check is due and cannot be made.
    advance(day + 1);
    await repository(kept).refresh();
    expect(installedCode(), "the kept copy stands in for the network").toBe("SR3LA");

    installProcessorTables(EMPTY_PROCESSOR_TABLES);
    await repository(new Kept()).refresh();
    expect(installedCode(), "nothing kept, nothing known").toBe(undefined);
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.testANewerFormatLeavesTheTablesAsTheyWere
  it("leaves the tables as they were for a file of a newer format, and keeps none of it", async () => {
    const kept = new Kept();
    script.answers.set(names, namesFile("SR3LA"));
    script.answers.set(signatures, signaturesFile());
    const source = repository(kept);
    await source.refresh();

    advance(day + 1);
    script.answers.set(names, namesFile("SRXXX", 2));
    script.answers.set(signatures, notModified);
    await source.refresh();
    expect(installedCode()).toBe("SR3LA");
    expect(kept.text(names), "the newer file is not kept").toContain("SR3LA");
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/IntelCPUIDRepositoryTests.swift#IntelCPUIDRepositoryTests.testTheTablesDoNotWaitOnTheNotes
  it("installs the tables without the notes, and the notes when they come", async () => {
    const kept = new Kept();
    script.answers.set(names, namesFile("SR3LA"));
    script.answers.set(signatures, signaturesFile());
    script.answers.set(notes, offline);
    const source = repository(kept);
    await source.refresh();
    expect(installedCode()).toBe("SR3LA");
    expect(installedNote()).toBe(undefined);

    advance(day + 1);
    script.answers.set(names, notModified);
    script.answers.set(signatures, notModified);
    script.answers.set(notes, notesFile("late"));
    await source.refresh();
    expect(installedNote()).toBe("late");
    expect(installedCode()).toBe("SR3LA");
  });
});
