/**
 * The places a tab's jumps have left behind, and the way back to them (§10.6).
 *
 * A jump — Go To, a difference, a search result, a click on the minimap — records the place
 * it leaves. **Back** returns to the last such place and keeps the one it left on the forward
 * stack; **Forward** goes the other way. Walking the history records nothing of its own, and a
 * new jump clears the forward stack, the way a browser's history does.
 *
 * What counts as a jump is decided by the callers, not here: an arrow key or a scroll is not
 * one, and a history that filled up a row at a time would be one nobody could use.
 *
 * Generic over the place, so it is tested without a document. A place can stop being reachable
 * — its file closed, another file opened in its pane — and the walk steps over such places
 * rather than landing nowhere.
 *
 * @upstream ByteRipperApp/Navigation/NavigationHistory.swift#NavigationHistory
 * @upstream-differs a class, where upstream is a struct the window model holds by value
 */
export class NavigationHistory<Place> {
  /**
   * How far back the history reaches. A bench session makes many jumps, but nobody walks fifty
   * of them back.
   *
   * @upstream ByteRipperApp/Navigation/NavigationHistory.swift#NavigationHistory.capacity
   */
  static readonly capacity = 50;

  /** @upstream ByteRipperApp/Navigation/NavigationHistory.swift#NavigationHistory.backStack */
  private back: Place[] = [];
  /** @upstream ByteRipperApp/Navigation/NavigationHistory.swift#NavigationHistory.forwardStack */
  private forward: Place[] = [];

  private readonly same: (left: Place, right: Place) => boolean;

  /**
   * @param same Whether two places are the same one — upstream's `Equatable`.
   */
  constructor(same: (left: Place, right: Place) => boolean = Object.is) {
    this.same = same;
  }

  get backStack(): readonly Place[] {
    return this.back;
  }

  get forwardStack(): readonly Place[] {
    return this.forward;
  }

  /**
   * A jump is leaving `place`. Nothing is recorded when the last place recorded is this one:
   * two jumps from the same spot are one way back.
   *
   * @upstream ByteRipperApp/Navigation/NavigationHistory.swift#NavigationHistory.record
   */
  record(place: Place): void {
    this.forward = [];
    const last = this.back[this.back.length - 1];
    if (last !== undefined && this.same(last, place)) return;
    this.back.push(place);
    if (this.back.length > NavigationHistory.capacity) {
      this.back.splice(0, this.back.length - NavigationHistory.capacity);
    }
  }

  /**
   * Whether Back has somewhere to go from `current`.
   *
   * @upstream ByteRipperApp/Navigation/NavigationHistory.swift#NavigationHistory.canGoBack
   */
  canGoBack(current: Place, isReachable: (place: Place) => boolean): boolean {
    return this.back.some((place) => !this.same(place, current) && isReachable(place));
  }

  /** @upstream ByteRipperApp/Navigation/NavigationHistory.swift#NavigationHistory.canGoForward */
  canGoForward(current: Place, isReachable: (place: Place) => boolean): boolean {
    return this.forward.some((place) => !this.same(place, current) && isReachable(place));
  }

  /**
   * The place Back goes to from `current`, or nothing when there is none. The places stepped
   * over — unreachable, or the one the user is already on — are dropped; `current` goes onto
   * the forward stack.
   *
   * @upstream ByteRipperApp/Navigation/NavigationHistory.swift#NavigationHistory.goBack
   */
  goBack(current: Place, isReachable: (place: Place) => boolean): Place | undefined {
    const place = this.pop(this.back, current, isReachable);
    if (place === undefined) return undefined;
    this.forward.push(current);
    return place;
  }

  /** @upstream ByteRipperApp/Navigation/NavigationHistory.swift#NavigationHistory.goForward */
  goForward(current: Place, isReachable: (place: Place) => boolean): Place | undefined {
    const place = this.pop(this.forward, current, isReachable);
    if (place === undefined) return undefined;
    this.back.push(current);
    return place;
  }

  /** @upstream ByteRipperApp/Navigation/NavigationHistory.swift#NavigationHistory.removeAll */
  removeAll(): void {
    this.back = [];
    this.forward = [];
  }

  /** @upstream ByteRipperApp/Navigation/NavigationHistory.swift#NavigationHistory.pop */
  private pop(
    stack: Place[],
    current: Place,
    isReachable: (place: Place) => boolean
  ): Place | undefined {
    if (!stack.some((place) => !this.same(place, current) && isReachable(place))) return undefined;
    for (let place = stack.pop(); place !== undefined; place = stack.pop()) {
      if (!this.same(place, current) && isReachable(place)) return place;
    }
    return undefined;
  }
}
