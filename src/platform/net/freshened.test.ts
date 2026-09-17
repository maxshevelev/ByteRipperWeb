import { describe, expect, it } from "vitest";
import { Freshened, FreshenedFailure } from "@/platform/net/freshened";

/**
 * `Freshened` — the rules a held database follows: fetched once, checked once a
 * day, and kept when the check cannot be made.
 *
 * All fifteen cases of `FreshenedTests` are here, with the clock, the recording
 * double and the gate the same three helpers upstream's file carries.
 *
 * @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests
 */

/**
 * A clock the test moves by hand, so nothing here waits on real seconds.
 *
 * @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#TestClock
 */
class TestClock {
  private at: number;

  /** @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#TestClock.init */
  constructor(at = 1_700_000_000_000) {
    this.at = at;
  }

  /** @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#TestClock.now */
  get now(): number {
    return this.at;
  }

  /** @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#TestClock.advance */
  advance(seconds: number): void {
    this.at += seconds * 1000;
  }
}

/**
 * What the closure was asked, and how often.
 *
 * @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#Checks
 */
class Checks {
  /** @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#Checks.validators */
  readonly validators: (string | undefined)[] = [];

  /** @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#Checks.count */
  get count(): number {
    return this.validators.length;
  }

  /** @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#Checks.record */
  record(validator: string | undefined): void {
    this.validators.push(validator);
  }
}

/**
 * A one-shot gate, so a test can hold a fetch open and let it go.
 *
 * @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#Gate
 */
class Gate {
  private waiting: (() => void) | undefined;
  private opened = false;

  /** @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#Gate.open */
  open(): void {
    this.opened = true;
    this.waiting?.();
    this.waiting = undefined;
  }

  /** @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#Gate.wait */
  async wait(): Promise<void> {
    if (this.opened) return;
    await new Promise<void>((resolve) => {
      this.waiting = resolve;
    });
  }
}

const day = 24 * 60 * 60;

/** A check that fails the way a network that is not there does. */
class Offline extends Error {}

describe("a held database", () => {
  // MARK: Nothing held

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testTheFirstCallFetches
  it("fetches on the first call", async () => {
    const cache = new Freshened<string>();
    const checks = new Checks();

    const value = await cache.value(async (validator) => {
      checks.record(validator);
      return { kind: "fresh", value: "database", validator: "etag-1" } as const;
    });

    expect(value).toBe("database");
    expect(checks.validators).toEqual([undefined]);
  });

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testAFailedFirstFetchIsNotRemembered
  it("does not remember a failed first fetch", async () => {
    const cache = new Freshened<string>();

    await expect(
      cache.value(async () => {
        throw new Offline();
      })
    ).rejects.toBeInstanceOf(Offline);

    // The network came back. The tool must not go on replaying the old error
    // for the rest of the run.
    const value = await cache.value(
      async () => ({ kind: "fresh", value: "database", validator: undefined }) as const
    );
    expect(value).toBe("database");
  });

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testUnchangedWithNothingHeldIsRefused
  it("refuses `unchanged` with nothing held", async () => {
    const cache = new Freshened<string>();

    await expect(cache.value(async () => ({ kind: "unchanged" }) as const)).rejects.toBeInstanceOf(
      FreshenedFailure
    );
  });

  // MARK: Held

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testWithinTheDayTheSourceIsNotAsked
  it("does not ask the source within the day", async () => {
    const clock = new TestClock();
    const cache = new Freshened<string>({ now: () => clock.now });
    const checks = new Checks();

    for (let i = 0; i < 3; i += 1) {
      clock.advance(60 * 60);
      const value = await cache.value(async (validator) => {
        checks.record(validator);
        return { kind: "fresh", value: "database", validator: "etag-1" } as const;
      });
      expect(value).toBe("database");
    }

    // The second and third file opened in a run cost nothing.
    expect(checks.count).toBe(1);
  });

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testAfterADayUnchangedKeepsTheValueAndRestartsTheClock
  it("keeps the value after a day of `unchanged`, and restarts the clock", async () => {
    const clock = new TestClock();
    const cache = new Freshened<string>({ now: () => clock.now });
    const checks = new Checks();

    await cache.value(
      async () => ({ kind: "fresh", value: "database", validator: "etag-1" }) as const
    );
    clock.advance(day + 1);

    const value = await cache.value(async (validator) => {
      checks.record(validator);
      return { kind: "unchanged" } as const;
    });
    expect(value).toBe("database");
    await cache.settle();
    // The check presents what was stored.
    expect(checks.validators).toEqual(["etag-1"]);

    // The clock restarted, so the day after the *check*, not after the fetch,
    // is when the next one is due.
    clock.advance(day - 60);
    const held = await cache.value(async () => {
      throw new Error("checked an hour ago; nothing to ask");
    });
    expect(held).toBe("database");
  });

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testAfterADayFreshReplacesTheValueForTheNextReader
  it("replaces the value after a day of `fresh`, for the next reader", async () => {
    const clock = new TestClock();
    const cache = new Freshened<string>({ now: () => clock.now });

    await cache.value(async () => ({ kind: "fresh", value: "old", validator: "etag-1" }) as const);
    clock.advance(day + 1);

    // This reader is answered from what is held; the new database arrives
    // behind it, for whoever asks next.
    const value = await cache.value(
      async () => ({ kind: "fresh", value: "new", validator: "etag-2" }) as const
    );
    expect(value).toBe("old");
    await cache.settle();

    const next = await cache.value(async () => {
      throw new Error("checked a moment ago; nothing to ask");
    });
    expect(next).toBe("new");

    clock.advance(day + 1);
    const validators: (string | undefined)[] = [];
    await cache.value(async (validator) => {
      validators.push(validator);
      return { kind: "unchanged" } as const;
    });
    await cache.settle();
    // The new validator is the one presented next.
    expect(validators).toEqual(["etag-2"]);
  });

  // MARK: Nobody waits on a check

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testAReaderIsAnsweredWhileTheCheckIsStillOpen
  it("answers a reader while the check is still open", async () => {
    const clock = new TestClock();
    const cache = new Freshened<string>({ now: () => clock.now });
    const release = new Gate();
    const entered = new Gate();

    await cache.value(
      async () => ({ kind: "fresh", value: "yesterday", validator: "etag-1" }) as const
    );
    clock.advance(day + 1);

    const value = await cache.value(async () => {
      entered.open();
      await release.wait();
      return { kind: "fresh", value: "today", validator: "etag-2" } as const;
    });
    // The check has not answered and cannot have: nothing has let it go.
    expect(value).toBe("yesterday");

    await entered.wait();
    release.open();
    await cache.settle();
    const next = await cache.value(async () => ({ kind: "unchanged" }) as const);
    expect(next).toBe("today");
  });

  // MARK: What a background check found

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testANewDatabaseIsAnnounced
  it("announces a new database", async () => {
    const clock = new TestClock();
    const cache = new Freshened<string>({ now: () => clock.now });
    const announced: string[] = [];
    cache.changes((value) => announced.push(value));

    await cache.value(async () => ({ kind: "fresh", value: "old", validator: "etag-1" }) as const);
    clock.advance(day + 1);
    await cache.value(async () => ({ kind: "fresh", value: "new", validator: "etag-2" }) as const);
    await cache.settle();

    // The work done against the old one can be done again.
    expect(announced).toEqual(["new"]);
  });

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testTheFirstFetchIsNotAnnounced
  it("does not announce the first fetch", async () => {
    const clock = new TestClock();
    const cache = new Freshened<string>({ now: () => clock.now });
    const announced: string[] = [];
    cache.changes((value) => announced.push(value));

    // The first fetch is the return of `value()`. Announcing it as well would
    // have the consumer do its work twice for one database.
    await cache.value(
      async () => ({ kind: "fresh", value: "database", validator: "etag-1" }) as const
    );
    clock.advance(day + 1);
    await cache.value(async () => ({ kind: "unchanged" }) as const);
    await cache.settle();

    // One fetch, one piece of work.
    expect(announced).toEqual([]);
  });

  // MARK: A check that could not be made

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testAFailedCheckKeepsWhatIsHeld
  it("keeps what is held when a check fails", async () => {
    const clock = new TestClock();
    const cache = new Freshened<string>({ now: () => clock.now });

    await cache.value(
      async () => ({ kind: "fresh", value: "yesterday", validator: "etag-1" }) as const
    );
    clock.advance(day + 1);

    const value = await cache.value(async () => {
      throw new Offline();
    });
    // A database from yesterday is what the tool is for.
    expect(value).toBe("yesterday");
    await cache.settle();
  });

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testAFailedCheckIsNotRepeatedUntilTheRetryIntervalHasPassed
  it("does not repeat a failed check until the retry interval has passed", async () => {
    const clock = new TestClock();
    const cache = new Freshened<string>({ retryInterval: 5 * 60 * 1000, now: () => clock.now });
    const checks = new Checks();

    await cache.value(
      async () => ({ kind: "fresh", value: "yesterday", validator: "etag-1" }) as const
    );
    clock.advance(day + 1);
    await cache.value(async () => {
      throw new Offline();
    });
    await cache.settle();

    // Every file opened in the next five minutes would otherwise wait out a
    // connection timeout of its own.
    clock.advance(60);
    await cache.value(async (validator) => {
      checks.record(validator);
      return { kind: "unchanged" } as const;
    });
    await cache.settle();
    expect(checks.count).toBe(0);

    clock.advance(5 * 60);
    await cache.value(async (validator) => {
      checks.record(validator);
      return { kind: "unchanged" } as const;
    });
    await cache.settle();
    expect(checks.count).toBe(1);
  });

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testASuccessfulCheckClearsTheFailure
  it("clears the failure with a successful check", async () => {
    const clock = new TestClock();
    const cache = new Freshened<string>({ retryInterval: 5 * 60 * 1000, now: () => clock.now });

    await cache.value(async () => ({ kind: "fresh", value: "old", validator: "etag-1" }) as const);
    clock.advance(day + 1);
    await cache.value(async () => {
      throw new Offline();
    });
    await cache.settle();
    clock.advance(5 * 60 + 1);
    await cache.value(async () => ({ kind: "fresh", value: "new", validator: "etag-2" }) as const);
    await cache.settle();

    // Back on the ordinary schedule: a day from the fetch, not five minutes
    // from the failure.
    clock.advance(60 * 60);
    const value = await cache.value(async () => {
      throw new Error("fetched an hour ago; nothing to ask");
    });
    expect(value).toBe("new");
  });

  // MARK: Two callers

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testASecondCallerDuringTheFetchDoesNotStartASecondOne
  it("starts one fetch for a second caller during it", async () => {
    const cache = new Freshened<string>();
    const checks = new Checks();
    const entered = new Gate();
    const release = new Gate();

    const first = cache.value(async (validator) => {
      checks.record(validator);
      entered.open();
      await release.wait();
      return { kind: "fresh", value: "database", validator: "etag-1" } as const;
    });

    await entered.wait();
    const second = cache.value(async (validator) => {
      checks.record(validator);
      return { kind: "fresh", value: "a second download", validator: "etag-2" } as const;
    });
    release.open();

    expect(await Promise.all([first, second])).toEqual(["database", "database"]);
    // One fetch answers both panes.
    expect(checks.count).toBe(1);
  });

  // MARK: Refresh, and the date shown

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testMarkStaleForcesACheckAndKeepsTheValueWhenItFails
  it("forces a check on Refresh, and keeps the value when it fails", async () => {
    const clock = new TestClock();
    const cache = new Freshened<string>({ now: () => clock.now });

    await cache.value(
      async () => ({ kind: "fresh", value: "database", validator: "etag-1" }) as const
    );
    cache.markStale();

    const value = await cache.value(async () => {
      throw new Offline();
    });
    // Refresh on a bench with no network must not empty the panel.
    expect(value).toBe("database");
    await cache.settle();
  });

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testStatusReportsWhenTheBodyChangedNotWhenItWasChecked
  it("reports when the body changed, not when it was checked", async () => {
    const clock = new TestClock();
    const start = clock.now;
    const cache = new Freshened<string>({ now: () => clock.now });

    await cache.value(
      async () => ({ kind: "fresh", value: "database", validator: "etag-1" }) as const
    );
    clock.advance(day + 1);
    await cache.value(async () => ({ kind: "unchanged" }) as const);
    await cache.settle();

    // A 304 today does not make last week's database fresher.
    expect(cache.status?.changedAt).toBe(start);
    expect(cache.status?.checkedAt).toBe(clock.now);
  });
});
