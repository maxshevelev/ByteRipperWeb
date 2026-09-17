/**
 * A value that is fetched once and then re-checked once a day.
 *
 * It holds the *parsed* value rather than the bytes it came from, because the
 * parse is as much of the cost as the download for a 680 KB CSV, and because
 * what every caller wants back is the model.
 *
 * It knows nothing about HTTP. `value()` is handed a closure that receives
 * whatever validator was stored with the held value — an `ETag`, a
 * `Last-Modified`, anything the source can echo back — and answers either
 * "unchanged" or "here is a new one". That keeps the network in the repository,
 * and it means the rules below can be tested without a network and without the
 * wall clock.
 *
 * The rules, which are the reason this is a type rather than three fields:
 *
 * - **Nothing held.** Fetch. If the fetch fails, the error is thrown and
 *   **nothing is remembered** — a remembered failure outlives the network that
 *   caused it, and a bench that opened a tool while offline would go on seeing
 *   the same error after plugging the cable back in.
 * - **Held and younger than `ttl`.** The closure is not called at all. This is
 *   the case that matters: the second, third and fourth file opened in a run.
 * - **Held and older than `ttl`.** The held value is returned *at once* and
 *   the check runs behind it, so no reader ever waits on the network for
 *   something already in hand. `unchanged` keeps the value and restarts the
 *   clock — no bytes, no re-parse. A new value replaces it and is announced
 *   through `changes()`, which is how a consumer knows to do its work again
 *   against the database that has just arrived.
 * - **A check that could not be made.** The held value is returned and no
 *   error is raised: a database from yesterday is what the tool is for. The
 *   failure is remembered for `retryInterval` only, so a day without a network
 *   does not put a fetch timeout in front of every file opened.
 * - **Two callers at once.** One call to the closure.
 *
 * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened
 */

/**
 * What a check found.
 *
 * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.Outcome
 */
export type FreshenedOutcome<Value> =
  /** The source says what we hold is still current — an HTTP `304`. */
  | { readonly kind: "unchanged" }
  /** A new value, with the validator to present at the next check. */
  | { readonly kind: "fresh"; readonly value: Value; readonly validator: string | undefined };

/** The closure `value()` is handed: one check, and what it found. */
export type FreshenedCheck<Value> = (
  validator: string | undefined
) => Promise<FreshenedOutcome<Value>>;

/**
 * The closure answered `.unchanged` when nothing was held, which it cannot
 * know: with nothing held it is passed a `undefined` validator and has nothing
 * to compare against.
 *
 * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.Failure
 */
export class FreshenedFailure extends Error {
  /** Upstream's one case; read by tests, the way the enum case is. */
  readonly failure = "unchangedWithNothingHeld";

  constructor() {
    super("Nothing is held, so nothing can be unchanged.");
    this.name = "FreshenedFailure";
  }
}

/**
 * What the panel's header needs to say how old the data is.
 *
 * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.Status
 */
export interface FreshenedStatus {
  /**
   * When the body last actually changed. This is the date to show: a check that
   * answered `304` today does not make last week's database any fresher.
   *
   * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.Status.changedAt
   */
  readonly changedAt: number;
  /**
   * When it was last confirmed current.
   *
   * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.Status.checkedAt
   */
  readonly checkedAt: number;
}

/** What is held, and what is known about it. */
interface Held<Value> {
  value: Value;
  validator: string | undefined;
  changedAt: number;
  checkedAt: number;
}

/** A cancel is the caller's own doing, not a check that could not be made. */
function isCancel(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class Freshened<Value> {
  private readonly ttl: number;
  private readonly retryInterval: number;
  private readonly now: () => number;

  private held: Held<Value> | undefined;
  private checkFailedAt: number | undefined;
  private inFlight: Promise<Value> | undefined;
  private readonly listeners = new Set<(value: Value) => void>();

  /**
   * @param ttl how long a value is used without asking the source. A day, for
   *   databases that change about weekly.
   * @param retryInterval how long a failed check suppresses the next one.
   * @param now the clock, so the tests do not have one.
   *
   * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.init
   */
  constructor(
    options: {
      readonly ttl?: number;
      readonly retryInterval?: number;
      readonly now?: () => number;
    } = {}
  ) {
    this.ttl = options.ttl ?? 24 * 60 * 60 * 1000;
    this.retryInterval = options.retryInterval ?? 5 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * The held value, or the result of a fetch, by the rules above.
   *
   * This waits only when there is nothing to answer with. Once something is
   * held it returns immediately, every time — a check that has come due runs
   * behind the answer, and what it finds arrives through `changes()`.
   *
   * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.value
   */
  async value(check: FreshenedCheck<Value>): Promise<Value> {
    const held = this.held;
    if (held !== undefined) {
      if (this.isDue(held) && this.inFlight === undefined) {
        // Not awaited on purpose. With a value in hand `run` does not throw —
        // a check it cannot make is recorded, not raised.
        const started = this.run(check);
        this.inFlight = started;
        void started.catch(() => undefined);
      }
      return held.value;
    }
    const running = this.inFlight;
    if (running !== undefined) return running;

    const task = this.run(check);
    this.inFlight = task;
    return task;
  }

  /**
   * Every value that *replaced* one already held — a background check that
   * found something new. The first fetch is not announced here: it is the
   * return of `value()`, and a consumer that acted on both would do its work
   * twice.
   *
   * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.changes
   * @upstream-differs a listener returning its own removal, rather than an
   * `AsyncStream`: the stores that hold a body are subscribed to rather than
   * iterated, the same call the store in `src/state/store.ts` already is
   */
  changes(listener: (value: Value) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Wait for a check that is running behind an answer — for tests, which must
   * not race it.
   *
   * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.settle
   */
  async settle(): Promise<void> {
    while (this.inFlight !== undefined) {
      // A check that could not be made is recorded, not raised.
      await this.inFlight.catch(() => undefined);
    }
  }

  /**
   * What is held and how old it is, or `undefined` if nothing has been fetched.
   *
   * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.status
   */
  get status(): FreshenedStatus | undefined {
    const held = this.held;
    return held === undefined
      ? undefined
      : { changedAt: held.changedAt, checkedAt: held.checkedAt };
  }

  /**
   * Make the next `value()` check, whatever the clock says — the Refresh
   * command. It does not throw the value away: a Refresh on a bench with no
   * network must not be the gesture that empties the panel.
   *
   * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.markStale
   */
  markStale(): void {
    // `.distantPast`, which is what makes `isDue` answer yes whatever the ttl.
    if (this.held !== undefined) this.held.checkedAt = Number.NEGATIVE_INFINITY;
    this.checkFailedAt = undefined;
  }

  /**
   * Take up a body that outlived the page it was fetched in, with the dates it
   * was fetched and last checked.
   *
   * @web-only the desktop's offline answer for a fresh launch is the baseline
   * compiled into the build, so it never has to adopt anything; the web ships
   * no such baseline for these databases, and the Cache API's copy stands where
   * it stands — otherwise a reload would empty a bench that has no network.
   */
  adopt(value: Value, validator: string | undefined, status: FreshenedStatus): void {
    this.held = {
      value,
      validator,
      changedAt: status.changedAt,
      checkedAt: status.checkedAt,
    };
  }

  private isDue(held: Held<Value>): boolean {
    const t = this.now();
    if (t - held.checkedAt < this.ttl) return false;
    if (this.checkFailedAt !== undefined && t - this.checkFailedAt < this.retryInterval) {
      return false;
    }
    return true;
  }

  private async run(check: FreshenedCheck<Value>): Promise<Value> {
    try {
      let outcome: FreshenedOutcome<Value>;
      try {
        outcome = await check(this.held?.validator);
      } catch (error) {
        const held = this.held;
        // A cancel is the caller's own doing: it must neither be reported as a
        // check that could not be made nor hold the next one back.
        if (held === undefined || isCancel(error)) throw error;
        this.checkFailedAt = this.now();
        return held.value;
      }

      const t = this.now();
      this.checkFailedAt = undefined;
      if (outcome.kind === "unchanged") {
        const held = this.held;
        if (held === undefined) throw new FreshenedFailure();
        held.checkedAt = t;
        return held.value;
      }

      const replacing = this.held !== undefined;
      this.held = {
        value: outcome.value,
        validator: outcome.validator,
        changedAt: t,
        checkedAt: t,
      };
      if (replacing) {
        for (const listener of [...this.listeners]) listener(outcome.value);
      }
      return outcome.value;
    } finally {
      this.inFlight = undefined;
    }
  }
}
