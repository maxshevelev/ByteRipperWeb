import { useEffect, useState } from "react";
import { editStore } from "@/state/editStore";
import { useStore } from "@/state/useStore";

/**
 * The edit tick, once the typing has stopped.
 *
 * Some answers about a document are worth their cost only when the bytes have
 * settled: a part's link has to read both sides to say whether they still
 * match, and a part is megabytes. An answer per keystroke is not work, it is
 * heat — the same reason the firmware tree waits out a burst before it is told
 * what changed (`firmwareStore`'s `CHANGE_DELAY`) — and what these answers are
 * about is a dot and a menu title, neither of which anybody reads mid-word.
 *
 * The first tick is not waited out: a part that has just opened says where it
 * came from at once.
 *
 * @web-only upstream asks these questions on the change notification itself,
 * where the same answer costs a native SHA-256 over bytes already in memory
 */
export const SETTLE_DELAY = 300;

export function useSettledEdits(delay: number = SETTLE_DELAY): number {
  const version = useStore(editStore).version;
  const [settled, setSettled] = useState(version);

  useEffect(() => {
    if (settled === version) return;
    const timer = setTimeout(() => setSettled(version), delay);
    return () => clearTimeout(timer);
  }, [version, settled, delay]);

  return settled;
}
