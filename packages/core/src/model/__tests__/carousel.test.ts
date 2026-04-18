import { describe, it, expect } from "vitest";
import {
  createCarouselReduce,
  toCarouselPublicState,
  type CarouselPrivateState,
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

function settled(
  carouselX = 0,
  items: Record<string, { x: number; y: number; scale: number }> = {},
): CarouselPrivateState {
  const defaultItems: Record<
    string,
    {
      x: { value: number; velocity: number; lastUpdatedAt: number };
      y: { value: number; velocity: number; lastUpdatedAt: number };
      scale: { value: number; logVelocity: number; lastUpdatedAt: number };
    }
  > = {};
  for (const id of ITEM_IDS) {
    const { x = 0, y = 0, scale = 1 } = items[id] ?? {};
    defaultItems[id] = {
      x: { value: x, velocity: 0, lastUpdatedAt: NaN },
      y: { value: y, velocity: 0, lastUpdatedAt: NaN },
      scale: { value: scale, logVelocity: 0, lastUpdatedAt: NaN },
    };
  }
  return {
    type: "settled",
    carousel: { value: carouselX, velocity: 0, lastUpdatedAt: NaN },
    items: defaultItems,
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

function makeItem(x = 0, y = 0, scale = 1, velocity = 0, logVelocity = 0) {
  return {
    x: { value: x, velocity, lastUpdatedAt: 0 },
    y: { value: y, velocity, lastUpdatedAt: 0 },
    scale: { value: scale, logVelocity, lastUpdatedAt: 0 },
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("createCarouselReduce", () => {
  describe("initial state", () => {
    it("starts settled with carousel at 0 and all items at neutral", () => {
      const reduce = makeReduce();
      const state = reduce(undefined, { type: "tick", timestamp: 0 });
      expect(state.type).toBe("settled");
      expect(state.carousel.value).toBe(0);
      for (const id of ITEM_IDS) {
        expect(state.items[id].x.value).toBe(0);
        expect(state.items[id].y.value).toBe(0);
        expect(state.items[id].scale.value).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // settled state
  // -------------------------------------------------------------------------

  describe("settled state", () => {
    it("returns the same reference on tick (reference equality contract)", () => {
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
      expect(state.items.a.x.value).toBe(0);
    });

    it("transitions to focused when a zoomed-in item is panned", () => {
      const reduce = makeReduce();
      // At scale=2, item pan bounds are x ∈ [-400, 0] and y ∈ [-600, 0].
      // Start at (-50, -50) so both dx=10 and dy=5 move within bounds.
      const state = reduce(
        settled(0, { a: { x: -50, y: -50, scale: 2 } }),
        motion({ itemId: "a", dx: 10, dy: 5 }),
      );
      expect(state.type).toBe("focused");
      if (state.type === "focused") expect(state.focusedItemId).toBe("a");
      expect(state.items.a.x.value).toBeCloseTo(-40);
      expect(state.items.a.y.value).toBeCloseTo(-45);
      expect(state.items.b.x.value).toBe(0);
    });

    it("transitions to focused on pinch (dScale != 1), even when item is at scale=1", () => {
      const reduce = makeReduce();
      const state = reduce(settled(), motion({ itemId: "a", dScale: 1.5 }));
      expect(state.type).toBe("focused");
      if (state.type === "focused") expect(state.focusedItemId).toBe("a");
    });

    it("treats unknown itemId as carousel motion", () => {
      const reduce = makeReduce();
      const state = reduce(settled(), motion({ itemId: "unknown", dx: -30 }));
      expect(state.type).toBe("scrolling");
      expect(state.carousel.value).toBeCloseTo(-30);
    });
  });

  // -------------------------------------------------------------------------
  // scrolling state
  // -------------------------------------------------------------------------

  describe("scrolling state", () => {
    it("returns the same reference on tick", () => {
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
      // Swiped more than halfway to item 1 → should snap to -400
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
      // Swiped well past the last item (index 2, target = -800)
      let state = reduce(settled(-800), motion({ dx: -1000 }));
      state = reduce(state, { type: "release" });
      if (state.type === "snapping") {
        expect(state.carouselTarget).toBe(-(ITEM_IDS.length - 1) * ITEM_WIDTH);
      }
    });

    it("transitions to focused on pinch mid-scroll", () => {
      const reduce = makeReduce();
      let state = reduce(settled(), motion({ dx: -50 }));
      expect(state.type).toBe("scrolling");
      state = reduce(state, motion({ itemId: "a", dScale: 1.5 }));
      expect(state.type).toBe("focused");
    });
  });

  // -------------------------------------------------------------------------
  // focused state
  // -------------------------------------------------------------------------

  describe("focused state", () => {
    function makeFocusedState(
      aConfig: { x: number; y: number; scale: number } = {
        x: -50,
        y: -50,
        scale: 2,
      },
    ): CarouselPrivateState {
      return {
        type: "focused",
        focusedItemId: "a",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeItem(aConfig.x, aConfig.y, aConfig.scale),
          b: makeItem(),
          c: makeItem(),
        },
      };
    }

    it("returns the same reference on tick", () => {
      const reduce = makeReduce();
      const state = makeFocusedState();
      expect(reduce(state, { type: "tick", timestamp: 16 })).toBe(state);
    });

    it("applies motion to the focused item", () => {
      const reduce = makeReduce();
      const state = reduce(
        makeFocusedState(),
        motion({ itemId: "a", dx: 10, dy: 5 }),
      );
      expect(state.type).toBe("focused");
      expect(state.items.a.x.value).toBeCloseTo(-40);
      expect(state.items.a.y.value).toBeCloseTo(-45);
    });

    it("does not move non-focused items", () => {
      const reduce = makeReduce();
      const state = reduce(makeFocusedState(), motion({ itemId: "a", dx: 10 }));
      expect(state.items.b.x.value).toBe(0);
      expect(state.items.c.x.value).toBe(0);
    });

    it("ignores motion targeting a different item (returns same reference)", () => {
      const reduce = makeReduce();
      const before = makeFocusedState();
      const after = reduce(before, motion({ itemId: "b", dx: 30 }));
      expect(after).toBe(before);
    });

    it("ignores motion with no itemId (returns same reference)", () => {
      const reduce = makeReduce();
      const before = makeFocusedState();
      const after = reduce(before, motion({ dx: 30 }));
      expect(after).toBe(before);
    });

    it("does not move the carousel during item pan", () => {
      const reduce = makeReduce();
      const state = reduce(makeFocusedState(), motion({ itemId: "a", dx: 30 }));
      expect(state.carousel.value).toBe(0);
    });

    it("discards overflow when item is panned beyond its right bound", () => {
      const reduce = makeReduce();
      // At scale=2, maxX=0. Item is already at x=0; panning right overflows.
      const before = makeFocusedState({ x: 0, y: 0, scale: 2 });
      const after = reduce(before, motion({ itemId: "a", dx: 50 }));
      expect(after.items.a.x.value).toBeCloseTo(0); // clamped at maxX=0
      expect(after.carousel.value).toBeCloseTo(0); // overflow is discarded
    });

    it("discards overflow when item is panned beyond its left bound", () => {
      const reduce = makeReduce();
      // At scale=2, minX=-400. Item is already at x=-400; panning left overflows.
      const before = makeFocusedState({ x: -400, y: 0, scale: 2 });
      const after = reduce(before, motion({ itemId: "a", dx: -50 }));
      expect(after.items.a.x.value).toBeCloseTo(-400); // clamped at minX=-400
      expect(after.carousel.value).toBeCloseTo(0); // overflow is discarded
    });

    it("transitions to inertia on release, preserving focusedItemId", () => {
      const reduce = makeReduce();
      const state = reduce(makeFocusedState(), { type: "release" });
      expect(state.type).toBe("inertia");
      if (state.type === "inertia") expect(state.focusedItemId).toBe("a");
    });
  });

  // -------------------------------------------------------------------------
  // inertia state
  // -------------------------------------------------------------------------

  describe("inertia state", () => {
    function makeInertiaState(): CarouselPrivateState {
      return {
        type: "inertia",
        focusedItemId: "a",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeItem(-50, 0, 2, -5),
          b: makeItem(),
          c: makeItem(),
        },
      };
    }

    it("advances focused item inertia on tick when velocity is significant", () => {
      const reduce = makeReduce();
      const before = makeInertiaState();
      const after = reduce(before, { type: "tick", timestamp: 16 });
      expect(after.type).toBe("inertia");
      expect(after.items.a.x.value).toBeLessThan(-50);
    });

    it("does not move the carousel during inertia", () => {
      const reduce = makeReduce();
      const after = reduce(makeInertiaState(), { type: "tick", timestamp: 16 });
      expect(after.carousel.value).toBe(0);
    });

    it("does not move non-focused items during inertia", () => {
      const reduce = makeReduce();
      const after = reduce(makeInertiaState(), { type: "tick", timestamp: 16 });
      expect(after.items.b.x.value).toBe(0);
    });

    it("transitions to settled when focused item velocity decays", () => {
      const reduce = makeReduce();
      // No velocity on item a → should settle immediately
      const state: CarouselPrivateState = {
        type: "inertia",
        focusedItemId: "a",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeItem(-50, 0, 2),
          b: makeItem(),
          c: makeItem(),
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.type).toBe("settled");
    });

    it("item stays at its current position after settling (no snap to neutral)", () => {
      const reduce = makeReduce();
      const state: CarouselPrivateState = {
        type: "inertia",
        focusedItemId: "a",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: makeItem(-50, -30, 2),
          b: makeItem(),
          c: makeItem(),
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.type).toBe("settled");
      expect(next.items.a.x.value).toBeCloseTo(-50);
      expect(next.items.a.y.value).toBeCloseTo(-30);
      expect(next.items.a.scale.value).toBeCloseTo(2);
    });

    it("stays in inertia on release (returns same reference)", () => {
      const reduce = makeReduce();
      const state = makeInertiaState();
      expect(reduce(state, { type: "release" })).toBe(state);
    });

    it("transitions to scrolling on carousel motion", () => {
      const reduce = makeReduce();
      const next = reduce(makeInertiaState(), motion({ dx: -30 }));
      expect(next.type).toBe("scrolling");
    });

    it("transitions to focused on pinch", () => {
      const reduce = makeReduce();
      // Item a is at scale=2 > 1, so motion on it resolves to focused
      const next = reduce(makeInertiaState(), motion({ itemId: "a", dx: 10 }));
      expect(next.type).toBe("focused");
      if (next.type === "focused") expect(next.focusedItemId).toBe("a");
    });
  });

  // -------------------------------------------------------------------------
  // snapping state
  // -------------------------------------------------------------------------

  describe("snapping state", () => {
    function makeSnappingState(
      carouselX = -200,
      carouselTarget = -400,
    ): CarouselPrivateState {
      return {
        type: "snapping",
        carousel: { value: carouselX, velocity: 0, lastUpdatedAt: 0 },
        carouselTarget,
        items: {
          a: makeItem(-50, 0, 1.5),
          b: makeItem(),
          c: makeItem(),
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

    it("items do not spring during snapping (stay at current position)", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingState(), {
        type: "tick",
        timestamp: 16,
      });
      if (after.type === "snapping") {
        expect(after.items.a.scale.value).toBe(1.5); // unchanged
        expect(after.items.a.x.value).toBe(-50); // unchanged
      }
    });

    it("transitions to settled when carousel is within snap threshold", () => {
      const reduce = makeReduce();
      const state = makeSnappingState(-399.9, -400);
      const after = reduce(state, { type: "tick", timestamp: 16 });
      expect(after.type).toBe("settled");
      expect(after.carousel.value).toBeCloseTo(-400);
    });

    it("items stay at their current positions on settling (no reset to neutral)", () => {
      const reduce = makeReduce();
      const state = makeSnappingState(-399.9, -400);
      const after = reduce(state, { type: "tick", timestamp: 16 });
      expect(after.type).toBe("settled");
      expect(after.items.a.scale.value).toBe(1.5);
      expect(after.items.a.x.value).toBe(-50);
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

    it("transitions to focused when a zoomed-in item is panned during snapping", () => {
      const reduce = makeReduce();
      // Item a is at scale=1.5 > 1, so motion on it resolves to focused
      const after = reduce(
        makeSnappingState(),
        motion({ itemId: "a", dx: 10 }),
      );
      expect(after.type).toBe("focused");
      if (after.type === "focused") expect(after.focusedItemId).toBe("a");
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
