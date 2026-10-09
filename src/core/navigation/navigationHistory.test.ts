import { describe, expect, it } from "vitest";
import { NavigationHistory } from "@/core/navigation/navigationHistory";

/**
 * §10.6 — the history itself, without a document: what records, what walking does to the two
 * stacks, and what is stepped over.
 *
 * @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryModelTests
 */

const everywhere = () => true;

describe("the navigation history", () => {
  // @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryModelTests.testBackReturnsToWhereTheJumpLeftAndForwardComesBack
  it("goes back to where the jump left and forward comes back", () => {
    const history = new NavigationHistory<number>();
    history.record(1);
    history.record(2);
    expect(history.goBack(3, everywhere)).toBe(2);
    expect(history.goBack(2, everywhere)).toBe(1);
    expect(history.goBack(1, everywhere)).toBeUndefined();
    expect(history.goForward(1, everywhere)).toBe(2);
    expect(history.goForward(2, everywhere)).toBe(3);
    expect(history.goForward(3, everywhere)).toBeUndefined();
  });

  // @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryModelTests.testANewJumpClearsTheForwardStack
  it("clears the forward stack on a new jump", () => {
    const history = new NavigationHistory<number>();
    history.record(1);
    history.goBack(2, everywhere);
    expect(history.canGoForward(1, everywhere)).toBe(true);
    history.record(1);
    expect(history.canGoForward(5, everywhere)).toBe(false);
  });

  // @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryModelTests.testTwoJumpsFromOnePlaceAreOneWayBack
  it("makes two jumps from one place one way back", () => {
    const history = new NavigationHistory<number>();
    history.record(1);
    history.record(1);
    expect(history.backStack).toEqual([1]);
  });

  // @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryModelTests.testThePlaceTheUserIsOnAndUnreachablePlacesAreSteppedOver
  it("steps over the place the user is on and places that cannot be reached", () => {
    const history = new NavigationHistory<number>();
    history.record(1);
    history.record(2);
    history.record(3);
    // 3 is where the user already is, 2 is in a file since closed.
    expect(history.goBack(3, (place) => place !== 2)).toBe(1);
    expect(history.canGoBack(1, (place) => place !== 2)).toBe(false);
  });

  // @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryModelTests.testTheHistoryKeepsItsLastFiftyPlaces
  it("keeps its last fifty places", () => {
    const history = new NavigationHistory<number>();
    for (let place = 0; place < 70; place++) history.record(place);
    expect(history.backStack).toHaveLength(50);
    expect(history.backStack[0]).toBe(20);
  });
});
