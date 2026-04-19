import { describe, it, expect } from "vitest";
import {
  createCarouselReduce,
  toCarouselPublicState,
  type CarouselPrivateState,
  type ItemPrivateState,
} from "../carousel.js";

const ITEM_WIDTH = 400;
const ITEM_HEIGHT = 600;
const ITEM_IDS = ["a", "b", "c"] as const;

function makeReduce() {
  return createCarouselReduce({
    itemWidth: ITEM_WIDTH,
    itemHeight: ITEM_HEIGHT,
    itemIds: ITEM_IDS,
  });
}

function makeItemTransform(
  x = 0,
  y = 0,
  scale = 1,
  velocity = 0,
  logVelocity = 0,
) {
  return {
    x: { value: x, velocity, lastUpdatedAt: 0 },
    y: { value: y, velocity, lastUpdatedAt: 0 },
    scale: { value: scale, logVelocity, lastUpdatedAt: 0 },
  };
}

function makeSettledItem(x = 0, y = 0, scale = 1): ItemPrivateState {
  return { type: "settled", transform: makeItemTransform(x, y, scale) };
}

function makeInertiaItem(
  x = 0,
  y = 0,
  scale = 1,
  velocity = 0,
): ItemPrivateState {
  return {
    type: "inertia",
    transform: makeItemTransform(x, y, scale, velocity),
  };
}

function makeTrackingItem(x = 0, y = 0, scale = 1): ItemPrivateState {
  return { type: "tracking", transform: makeItemTransform(x, y, scale) };
}

function settled(
  carouselX = 0,
  itemOverrides: Partial<
    Record<string, { x?: number; y?: number; scale?: number }>
  > = {},
): CarouselPrivateState {
  const items: Record<string, ItemPrivateState> = {};
  for (const id of ITEM_IDS) {
    const { x = 0, y = 0, scale = 1 } = itemOverrides[id] ?? {};
    items[id] = {
      type: "settled",
      transform: {
        x: { value: x, velocity: 0, lastUpdatedAt: NaN },
        y: { value: y, velocity: 0, lastUpdatedAt: NaN },
        scale: { value: scale, logVelocity: 0, lastUpdatedAt: NaN },
      },
    };
  }
  return {
    type: "settled",
    carousel: { value: carouselX, velocity: 0, lastUpdatedAt: NaN },
    items,
  };
}

function motion(
  opts: Partial<{
    itemId: string;
    dx: number;
    dy: number;
    dScale: number;
    originX: number;
    originY: number;
    timestamp: number;
  }> = {},
) {
  return {
    type: "motion" as const,
    dx: 0,
    dy: 0,
    dScale: 1,
    originX: 0,
    originY: 0,
    timestamp: 0,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("createCarouselReduce", () => {
  describe("initial state", () => {
    it("starts settled with carousel at 0 and all items settled at neutral", () => {
      const reduce = makeReduce();
      const state = reduce(undefined, { type: "tick", timestamp: 0 });
      expect(state.type).toBe("settled");
      expect(state.carousel.value).toBe(0);
      for (const id of ITEM_IDS) {
        expect(state.items[id].type).toBe("settled");
        expect(state.items[id].transform.x.value).toBe(0);
        expect(state.items[id].transform.y.value).toBe(0);
        expect(state.items[id].transform.scale.value).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // settled state
  // -------------------------------------------------------------------------

  describe("settled state", () => {
    it("returns the same reference on tick when no items are in motion", () => {
      const reduce = makeReduce();
      const state = settled();
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next).toBe(state);
    });

    it("returns the same reference on release", () => {
      const reduce = makeReduce();
      const state = settled();
      expect(reduce(state, { type: "release" })).toBe(state);
    });

    it("transitions to scrolling on carousel pan (no itemId)", () => {
      const reduce = makeReduce();
      const state = reduce(settled(), motion({ dx: -50 }));
      expect(state.type).toBe("scrolling");
      expect(state.carousel.value).toBeCloseTo(-50);
    });

    it("transitions to scrolling when item at scale=1 is panned (carousel moves, item stays)", () => {
      const reduce = makeReduce();
      const state = reduce(settled(), motion({ itemId: "a", dx: -80 }));
      expect(state.type).toBe("scrolling");
      expect(state.carousel.value).toBeCloseTo(-80);
      expect(state.items.a.transform.x.value).toBe(0);
    });

    it("transitions to locked when a zoomed-in item is panned", () => {
      const reduce = makeReduce();
      const state = reduce(
        settled(0, { a: { x: -50, y: -50, scale: 2 } }),
        motion({ itemId: "a", dx: 10, dy: 5 }),
      );
      expect(state.type).toBe("locked");
      expect(state.items.a.type).toBe("tracking");
      expect(state.items.a.transform.x.value).toBeCloseTo(-40);
      expect(state.items.a.transform.y.value).toBeCloseTo(-45);
      expect(state.items.b.transform.x.value).toBe(0);
    });

    it("transitions to locked on pinch (dScale != 1), even when item is at scale=1", () => {
      const reduce = makeReduce();
      const state = reduce(settled(), motion({ itemId: "a", dScale: 1.5 }));
      expect(state.type).toBe("locked");
      expect(state.items.a.type).toBe("tracking");
    });

    it("treats unknown itemId as carousel motion", () => {
      const reduce = makeReduce();
      const state = reduce(settled(), motion({ itemId: "unknown", dx: -30 }));
      expect(state.type).toBe("scrolling");
      expect(state.carousel.value).toBeCloseTo(-30);
    });

    it("advances inertia items on tick (parallel operation)", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "settled",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeInertiaItem(-50, 0, 2, -5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.type).toBe("settled");
      expect(next.items.a.type).toBe("inertia");
      expect(next.items.a.transform.x.value).toBeLessThan(-50);
    });

    it("locks on an inertia item when a motion targets it", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "settled",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeInertiaItem(-50, 0, 2, -5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const next = reduce(state, motion({ itemId: "a", dx: 10 }));
      expect(next.type).toBe("locked");
      expect(next.items.a.type).toBe("tracking");
    });

    it("cancels inertia item when locking on a different item", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "settled",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeInertiaItem(-50, 0, 2, -5),
          b: makeSettledItem(0, 0, 2),
          c: makeSettledItem(),
        },
      };
      const next = reduce(state, motion({ itemId: "b", dx: 5 }));
      expect(next.type).toBe("locked");
      expect(next.items.a.type).toBe("settled"); // cancelled
      expect(next.items.b.type).toBe("tracking");
    });
  });

  // -------------------------------------------------------------------------
  // scrolling state
  // -------------------------------------------------------------------------

  describe("scrolling state", () => {
    it("returns the same reference on tick when no items are in motion", () => {
      const reduce = makeReduce();
      const state = reduce(settled(), motion({ dx: -10 }));
      expect(state.type).toBe("scrolling");
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next).toBe(state);
    });

    it("transitions to snapping on release", () => {
      const reduce = makeReduce();
      let state = reduce(settled(), motion({ dx: -50 }));
      state = reduce(state, { type: "release" });
      expect(state.type).toBe("snapping");
    });

    it("snap target is the nearest item boundary", () => {
      const reduce = makeReduce();
      let state = reduce(settled(), motion({ dx: -210 }));
      state = reduce(state, { type: "release" });
      expect(state.type).toBe("snapping");
      if (state.type === "snapping") {
        expect(state.carouselTarget).toBe(-ITEM_WIDTH);
      }
    });

    it("snap target stays at 0 when swiped less than halfway to next item", () => {
      const reduce = makeReduce();
      let state = reduce(settled(), motion({ dx: -190 }));
      state = reduce(state, { type: "release" });
      if (state.type === "snapping") {
        expect(state.carouselTarget).toBeCloseTo(0);
      }
    });

    it("snap target is clamped to the last item boundary", () => {
      const reduce = makeReduce();
      let state = reduce(settled(-800), motion({ dx: -1000 }));
      state = reduce(state, { type: "release" });
      if (state.type === "snapping") {
        expect(state.carouselTarget).toBe(-(ITEM_IDS.length - 1) * ITEM_WIDTH);
      }
    });

    it("does not transition to locked on pinch mid-scroll (locked only from settled)", () => {
      const reduce = makeReduce();
      let state = reduce(settled(), motion({ dx: -50 }));
      expect(state.type).toBe("scrolling");
      state = reduce(state, motion({ itemId: "a", dScale: 1.5 }));
      // Stays scrolling; carousel advances by dx (0 in this case)
      expect(state.type).toBe("scrolling");
    });

    it("advances inertia items on tick while scrolling (parallel operation)", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "scrolling",
        carousel: { value: -50, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeInertiaItem(-50, 0, 2, -5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.type).toBe("scrolling");
      expect(next.items.a.type).toBe("inertia");
      expect(next.items.a.transform.x.value).toBeLessThan(-50);
    });
  });

  // -------------------------------------------------------------------------
  // locked state
  // -------------------------------------------------------------------------

  describe("locked state", () => {
    function makeLockedState(
      aConfig: { x: number; y: number; scale: number } = {
        x: -50,
        y: -50,
        scale: 2,
      },
    ): CarouselPrivateState {
      return {
        type: "locked",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeTrackingItem(aConfig.x, aConfig.y, aConfig.scale),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
    }

    it("returns the same reference on tick when no items are animating", () => {
      const reduce = makeReduce();
      const state = makeLockedState();
      expect(reduce(state, { type: "tick", timestamp: 16 })).toBe(state);
    });

    it("applies motion to the tracking item", () => {
      const reduce = makeReduce();
      const state = reduce(
        makeLockedState(),
        motion({ itemId: "a", dx: 10, dy: 5 }),
      );
      expect(state.type).toBe("locked");
      expect(state.items.a.type).toBe("tracking");
      expect(state.items.a.transform.x.value).toBeCloseTo(-40);
      expect(state.items.a.transform.y.value).toBeCloseTo(-45);
    });

    it("does not move non-tracking items", () => {
      const reduce = makeReduce();
      const state = reduce(makeLockedState(), motion({ itemId: "a", dx: 10 }));
      expect(state.items.b.transform.x.value).toBe(0);
      expect(state.items.c.transform.x.value).toBe(0);
    });

    it("ignores motion targeting a different item (returns same reference)", () => {
      const reduce = makeReduce();
      const before = makeLockedState();
      const after = reduce(before, motion({ itemId: "b", dx: 30 }));
      expect(after).toBe(before);
    });

    it("ignores motion with no itemId (returns same reference)", () => {
      const reduce = makeReduce();
      const before = makeLockedState();
      const after = reduce(before, motion({ dx: 30 }));
      expect(after).toBe(before);
    });

    it("does not move the carousel during item pan", () => {
      const reduce = makeReduce();
      const state = reduce(makeLockedState(), motion({ itemId: "a", dx: 30 }));
      expect(state.carousel.value).toBe(0);
    });

    it("discards overflow when item is panned beyond its right bound", () => {
      const reduce = makeReduce();
      const before = makeLockedState({ x: 0, y: 0, scale: 2 });
      const after = reduce(before, motion({ itemId: "a", dx: 50 }));
      expect(after.items.a.transform.x.value).toBeCloseTo(0);
      expect(after.carousel.value).toBeCloseTo(0);
    });

    it("discards overflow when item is panned beyond its left bound", () => {
      const reduce = makeReduce();
      const before = makeLockedState({ x: -400, y: 0, scale: 2 });
      const after = reduce(before, motion({ itemId: "a", dx: -50 }));
      expect(after.items.a.transform.x.value).toBeCloseTo(-400);
      expect(after.carousel.value).toBeCloseTo(0);
    });

    it("transitions carousel to settled on release, item transitions to inertia", () => {
      const reduce = makeReduce();
      const state = reduce(makeLockedState(), { type: "release" });
      expect(state.type).toBe("settled");
      // item had no velocity → settled
      expect(state.items.a.type).toBe("settled");
    });

    it("item transitions to inertia on release when it has significant velocity", () => {
      const reduce = makeReduce();
      const lockedWithVelocity: CarouselPrivateState = {
        type: "locked",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: { type: "tracking", transform: makeItemTransform(-50, 0, 2, -5) },
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const state = reduce(lockedWithVelocity, { type: "release" });
      expect(state.type).toBe("settled");
      expect(state.items.a.type).toBe("inertia");
    });

    it("item transitions to snapping on release when under-zoomed", () => {
      const reduce = makeReduce();
      const lockedUnderZoom: CarouselPrivateState = {
        type: "locked",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeTrackingItem(0, 0, 0.5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const state = reduce(lockedUnderZoom, { type: "release" });
      expect(state.type).toBe("settled");
      expect(state.items.a.type).toBe("snapping");
      if (state.items.a.type === "snapping") {
        expect(state.items.a.target).toEqual({ x: 0, y: 0, scale: 1 });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Item-level inertia (carousel settled, item animating)
  // -------------------------------------------------------------------------

  describe("item inertia (parallel with carousel settled)", () => {
    function makeSettledCarouselWithInertiaItem(): CarouselPrivateState {
      return {
        type: "settled",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeInertiaItem(-50, 0, 2, -5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
    }

    it("advances item inertia on tick", () => {
      const reduce = makeReduce();
      const after = reduce(makeSettledCarouselWithInertiaItem(), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.type).toBe("settled");
      expect(after.items.a.type).toBe("inertia");
      expect(after.items.a.transform.x.value).toBeLessThan(-50);
    });

    it("does not move the carousel during item inertia", () => {
      const reduce = makeReduce();
      const after = reduce(makeSettledCarouselWithInertiaItem(), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.carousel.value).toBe(0);
    });

    it("does not move non-inertia items", () => {
      const reduce = makeReduce();
      const after = reduce(makeSettledCarouselWithInertiaItem(), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.items.b.transform.x.value).toBe(0);
    });

    it("item settles when velocity decays", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "settled",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeInertiaItem(-50, 0, 2), // no velocity → settles immediately
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.items.a.type).toBe("settled");
      expect(next.items.a.transform.x.value).toBeCloseTo(-50);
    });

    it("item stays at its current position after settling (no snap to neutral)", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "settled",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeInertiaItem(-50, -30, 2),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.items.a.transform.x.value).toBeCloseTo(-50);
      expect(next.items.a.transform.y.value).toBeCloseTo(-30);
      expect(next.items.a.transform.scale.value).toBeCloseTo(2);
    });

    it("can start scrolling the carousel while item is still in inertia", () => {
      const reduce = makeReduce();
      const next = reduce(
        makeSettledCarouselWithInertiaItem(),
        motion({ dx: -30 }),
      );
      expect(next.type).toBe("scrolling");
      expect(next.items.a.type).toBe("inertia"); // item continues
    });

    it("item transitions to snapping when inertia decays below scale=1", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "settled",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeInertiaItem(0, 0, 0.5), // no velocity, under-zoom
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.items.a.type).toBe("snapping");
      if (next.items.a.type === "snapping") {
        expect(next.items.a.target).toEqual({ x: 0, y: 0, scale: 1 });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Item-level snapping (under-zoom recovery)
  // -------------------------------------------------------------------------

  describe("item snapping (under-zoom recovery)", () => {
    function makeSnappingItemState(): CarouselPrivateState {
      return {
        type: "settled",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: {
            type: "snapping",
            transform: makeItemTransform(0, 0, 0.5),
            target: { x: 0, y: 0, scale: 1 },
          },
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
    }

    it("advances item spring toward scale=1 on tick", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingItemState(), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.items.a.type).toBe("snapping");
      expect(after.items.a.transform.scale.value).toBeGreaterThan(0.5);
      expect(after.items.a.transform.scale.value).toBeLessThan(1);
    });

    it("settles item when scale reaches target", () => {
      const reduce = makeReduce();
      let state = makeSnappingItemState();
      for (let i = 1; i <= 500; i++) {
        state = reduce(state, { type: "tick", timestamp: i * 16 });
        if (state.items.a.type === "settled") break;
      }
      expect(state.items.a.type).toBe("settled");
      expect(state.items.a.transform.scale.value).toBeCloseTo(1, 2);
    });
  });

  // -------------------------------------------------------------------------
  // snapping state (carousel-level)
  // -------------------------------------------------------------------------

  describe("snapping state (carousel)", () => {
    function makeSnappingState(
      carouselX = -200,
      carouselTarget = -400,
    ): CarouselPrivateState {
      return {
        type: "snapping",
        carousel: { value: carouselX, velocity: 0, lastUpdatedAt: 0 },
        carouselTarget,
        items: {
          a: makeSettledItem(-50, 0, 1.5),
          b: makeSettledItem(),
          c: makeSettledItem(),
        },
      };
    }

    it("advances carousel spring on tick when far from target", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingState(-200, -400), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.type).toBe("snapping");
      expect(after.carousel.value).toBeLessThan(-200);
      expect(after.carousel.value).toBeGreaterThan(-400);
    });

    it("items do not spring during carousel snapping (stay at current position)", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingState(), {
        type: "tick",
        timestamp: 16,
      });
      if (after.type === "snapping") {
        expect(after.items.a.transform.scale.value).toBe(1.5);
        expect(after.items.a.transform.x.value).toBe(-50);
      }
    });

    it("transitions to settled when carousel is within snap threshold", () => {
      const reduce = makeReduce();
      const state = makeSnappingState(-399.9, -400);
      const after = reduce(state, { type: "tick", timestamp: 16 });
      expect(after.type).toBe("settled");
      expect(after.carousel.value).toBeCloseTo(-400);
    });

    it("items stay at their current positions on settling", () => {
      const reduce = makeReduce();
      const state = makeSnappingState(-399.9, -400);
      const after = reduce(state, { type: "tick", timestamp: 16 });
      expect(after.type).toBe("settled");
      expect(after.items.a.transform.scale.value).toBe(1.5);
      expect(after.items.a.transform.x.value).toBe(-50);
    });

    it("converges carousel to snap target over many frames", () => {
      const reduce = makeReduce();
      let state: CarouselPrivateState = makeSnappingState(-200, -400);
      for (let i = 1; i <= 300; i++) {
        state = reduce(state, { type: "tick", timestamp: i * 16 });
        if (state.type === "settled") break;
      }
      expect(state.type).toBe("settled");
      expect(state.carousel.value).toBeCloseTo(-400, 0);
    });

    it("stays snapping on release (returns same reference)", () => {
      const reduce = makeReduce();
      const state = makeSnappingState();
      expect(reduce(state, { type: "release" })).toBe(state);
    });

    it("transitions to scrolling on motion without itemId", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingState(), motion({ dx: -20 }));
      expect(after.type).toBe("scrolling");
    });

    it("ignores item-targeted motions during carousel snapping", () => {
      const reduce = makeReduce();
      const state = makeSnappingState();
      const after = reduce(state, motion({ itemId: "a", dx: 10 }));
      expect(after).toBe(state);
    });
  });

  // -------------------------------------------------------------------------
  // toCarouselPublicState
  // -------------------------------------------------------------------------

  describe("toCarouselPublicState", () => {
    it("maps private state to public state correctly", () => {
      const state = settled(-400, { a: { x: -10, y: 5, scale: 1.5 } });
      const pub = toCarouselPublicState(state);
      expect(pub.carouselTranslateX).toBe(-400);
      expect(pub.items.a).toEqual({
        transformX: -10,
        transformY: 5,
        scale: 1.5,
      });
      expect(pub.items.b).toEqual({
        transformX: 0,
        transformY: 0,
        scale: 1,
      });
    });
  });
});
