import { remoteSource } from "@/platform/net/cachedSource";
import { Freshened, type FreshenedStatus } from "@/platform/net/freshened";

/**
 * One file fetched from GitHub and kept fresh by `Freshened`'s rule: what every
 * third-party database this app reads is (`CLAUDE.md`, "Third-party data").
 *
 * The copy the last session left in the Cache API is adopted before the first
 * ask, so a bench with no network still has yesterday's file, and its dates
 * decide whether the day's check is due. Each check is one conditional request
 * (`remoteSource`), and what it brings back is parsed here, once, into the value
 * the source hands out: the text itself, or what is read off it.
 */
export interface FreshRemote<Value> {
  /**
   * The value: what is held, answered at once with the day's check behind it
   * when one is due, or the first fetch when nothing is held.
   */
  value(signal?: AbortSignal): Promise<Value>;
  /** Hears a check behind an answer bring a newer file. */
  changes(listener: (value: Value) => void): () => void;
  /** When the file last changed and was last checked, or nothing before it is held. */
  freshness(): FreshenedStatus | undefined;
  /** Makes the next ask check, whatever the clock says. */
  markStale(): void;
  /**
   * Waits for a check running behind an answer — the seam a test needs.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.settle
   */
  settle(): Promise<void>;
}

/**
 * The file at `url`, held fresh, as what `parse` reads off its text. A copy that
 * does not parse is no copy: the next ask fetches the file again. A fetched file
 * that does not parse is the ask's error.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.check
 * @upstream-differs one source per file, each seeded from the copy the Cache API kept, where upstream's repository holds its three files' `Freshened` itself and keeps nothing between runs; and the request is `remoteSource`'s, which asks the browser to revalidate where a script cannot read the validator
 */
export function freshRemote<Value>(
  url: string,
  parse: (text: string) => Value
): FreshRemote<Value> {
  const held = new Freshened<Value>();
  const remote = remoteSource(url);

  let seeded: Promise<void> | undefined;
  const seed = (): Promise<void> =>
    (seeded ??= (async () => {
      try {
        const stored = await remote.stored();
        if (stored === undefined) return;
        held.adopt(parse(stored.text), stored.validator, {
          changedAt: stored.changedAt,
          checkedAt: stored.checkedAt,
        });
      } catch {
        // A copy that cannot be read — or no longer parses — is not a reason to
        // refuse this ask: the request below is still to be made, and it
        // replaces the copy.
      }
    })());

  return {
    async value(signal) {
      await seed();
      return held.value(async (validator) => {
        const answer = await remote.check(validator, signal === undefined ? {} : { signal });
        return answer.kind === "unchanged"
          ? { kind: "unchanged" }
          : { kind: "fresh", value: parse(answer.text), validator: answer.validator };
      });
    },
    changes: (listener) => held.changes(listener),
    freshness: () => held.status,
    markStale: () => held.markStale(),
    settle: () => held.settle(),
  };
}
