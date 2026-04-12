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

    it("transitions to tracking on carousel pan (no itemId)", () => {
      const reduce = makeReduce();
      const state = reduce(settled(), motion({ dx: -50 }));
      expect(state.type).toBe("tracking");
      expect(state.carousel.value).toBeCloseTo(-50);
    });

    it("transitions to tracking on item motion and updates the target item", () => {
      const reduce = makeReduce();
      // At scale=2, item pan bounds are x ∈ [-400, 0] and y ∈ [-600, 0].
      // Start at (-50, -50) so both dx=10 and dy=5 move within bounds.
      const state = reduce(
        settled(0, { a: { x: -50, y: -50, scale: 2 } }),
        motion({ itemId: "a", dx: 10, dy: 5 }),
      );
      expect(state.type).toBe("tracking");
      expect(state.items["a"].x.value).toBeCloseTo(-40);
      expect(state.items["a"].y.value).toBeCloseTo(-45);
      // Other items are untouched
      expect(state.items["b"].x.value).toBe(0);
    });

    it("ignores motion events with an unknown itemId (returns same state reference)", () => {
      const reduce = makeReduce();
      const before = settled();
      const after = reduce(before, motion({ itemId: "unknown", dx: 10 }));
      expect(after).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // tracking state
  // -------------------------------------------------------------------------

  describe("tracking state", () => {
    it("returns the same reference on tick", () => {
      const reduce = makeReduce();
      const state = reduce(settled(), motion({ dx: -10 }));
      expect(state.type).toBe("tracking");
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

    it("item snap targets are all at neutral {x:0, y:0, scale:1}", () => {
      const reduce = makeReduce();
      let state = reduce(
        settled(),
        motion({ itemId: "b", dScale: 2, originX: 0, originY: 0 }),
      );
      state = reduce(state, { type: "release" });
      if (state.type === "snapping") {
        expect(state.itemTargets["a"]).toEqual({ x: 0, y: 0, scale: 1 });
        expect(state.itemTargets["b"]).toEqual({ x: 0, y: 0, scale: 1 });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Item overflow → carousel
  // -------------------------------------------------------------------------

  describe("item overflow to carousel", () => {
    it("pan within item bounds does not affect carousel", () => {
      const reduce = makeReduce();
      // At scale 2, item can pan in [-400, 0]. dx = -100 stays within bounds.
      const state = reduce(
        settled(0, { a: { x: 0, y: 0, scale: 2 } }),
        motion({ itemId: "a", dx: -100 }),
      );
      expect(state.carousel.value).toBeCloseTo(0);
      expect(state.items["a"].x.value).toBeCloseTo(-100);
    });

    it("overflow pan beyond item left bound transfers to carousel", () => {
      const reduce = makeReduce();
      // At scale 2, item bounds are [-400, 0]. Starting at x=-400 (left edge), any leftward pan overflows.
      const state = reduce(
        settled(0, { a: { x: -400, y: 0, scale: 2 } }),
        motion({ itemId: "a", dx: -50 }),
      );
      // Item stays clamped at minX = ITEM_WIDTH * (1 - 2) = -400
      expect(state.items["a"].x.value).toBeCloseTo(-400);
      // Overflow of -50 is forwarded to the carousel
      expect(state.carousel.value).toBeCloseTo(-50);
    });

    it("overflow pan beyond item right bound transfers to carousel", () => {
      const reduce = makeReduce();
      // At scale 2, item bounds are [-400, 0]. Starting at x=0 (right edge), any rightward pan overflows.
      const state = reduce(
        settled(0, { a: { x: 0, y: 0, scale: 2 } }),
        motion({ itemId: "a", dx: 30 }),
      );
      expect(state.items["a"].x.value).toBeCloseTo(0);
      expect(state.carousel.value).toBeCloseTo(30);
    });

    it("at scale 1 all pan overflows to carousel", () => {
      const reduce = makeReduce();
      const state = reduce(settled(), motion({ itemId: "a", dx: -80 }));
      // scale=1 → bounds are [0, 0], so all dx overflows
      expect(state.items["a"].x.value).toBeCloseTo(0);
      expect(state.carousel.value).toBeCloseTo(-80);
    });
  });

  // -------------------------------------------------------------------------
  // inertia state
  // -------------------------------------------------------------------------

  describe("inertia state", () => {
    function makeInertiaState(): CarouselPrivateState {
      return {
        type: "inertia",
        carousel: { value: -200, velocity: -5, lastUpdatedAt: 0 },
        items: {
          a: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
          b: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
          c: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
        },
      };
    }

    it("advances carousel inertia on tick when velocity is significant", () => {
      const reduce = makeReduce();
      const before = makeInertiaState();
      const after = reduce(before, { type: "tick", timestamp: 16 });
      expect(after.type).toBe("inertia");
      expect(after.carousel.value).toBeLessThan(-200);
    });

    it("transitions to settled on tick when velocity decays and already at snap target", () => {
      const reduce = makeReduce();
      // At x=0 with no velocity — already at snap target 0, all items neutral
      const state: CarouselPrivateState = {
        type: "inertia",
        carousel: { value: 0, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
          b: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
          c: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.type).toBe("settled");
    });

    it("transitions to snapping on tick when velocity decays and snap target is far", () => {
      const reduce = makeReduce();
      // At x=-210, no velocity — snap target is -400, gap is 190 > SNAP_THRESHOLD
      const state: CarouselPrivateState = {
        type: "inertia",
        carousel: { value: -210, velocity: 0, lastUpdatedAt: 0 },
        items: {
          a: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
          b: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
          c: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
        },
      };
      const next = reduce(state, { type: "tick", timestamp: 16 });
      expect(next.type).toBe("snapping");
    });

    it("transitions to tracking on motion", () => {
      const reduce = makeReduce();
      const next = reduce(makeInertiaState(), motion({ dx: -30 }));
      expect(next.type).toBe("tracking");
    });

    it("transitions to snapping on release", () => {
      const reduce = makeReduce();
      const next = reduce(makeInertiaState(), { type: "release" });
      expect(next.type).toBe("snapping");
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
          a: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1.5, logVelocity: 0, lastUpdatedAt: 0 },
          },
          b: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
          c: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
        },
        itemTargets: {
          a: { x: 0, y: 0, scale: 1 },
          b: { x: 0, y: 0, scale: 1 },
          c: { x: 0, y: 0, scale: 1 },
        },
      };
    }

    it("advances spring on tick when far from target", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingState(-200, -400), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.type).toBe("snapping");
      expect(after.carousel.value).toBeLessThan(-200);
      expect(after.carousel.value).toBeGreaterThan(-400);
    });

    it("springs item scale toward 1", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingState(), {
        type: "tick",
        timestamp: 16,
      });
      if (after.type === "snapping") {
        expect(after.items["a"].scale.value).toBeLessThan(1.5);
        expect(after.items["a"].scale.value).toBeGreaterThan(1);
      }
    });

    it("transitions to settled when within snap threshold", () => {
      const reduce = makeReduce();
      // Carousel is already very close to target
      const state = makeSnappingState(-399.9, -400);
      // Override item scale to be near 1 as well
      (state.items["a"].scale as { value: number }).value = 1.005;
      const after = reduce(state, { type: "tick", timestamp: 16 });
      expect(after.type).toBe("settled");
      expect(after.carousel.value).toBeCloseTo(-400);
    });

    it("converges carousel to snap target over many frames", () => {
      const reduce = makeReduce();
      let state: CarouselPrivateState = makeSnappingState(-200, -400);
      // Override item to avoid blocking convergence
      (state.items["a"].scale as { value: number }).value = 1;
      for (let i = 1; i <= 300; i++) {
        state = reduce(state, { type: "tick", timestamp: i * 16 });
        if (state.type === "settled") break;
      }
      expect(state.type).toBe("settled");
      expect(state.carousel.value).toBeCloseTo(-400, 0);
    });

    it("converges item scale to 1 over many frames", () => {
      const reduce = makeReduce();
      let state: CarouselPrivateState = {
        type: "snapping",
        carousel: { value: -400, velocity: 0, lastUpdatedAt: 0 },
        carouselTarget: -400,
        items: {
          a: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 2, logVelocity: 0, lastUpdatedAt: 0 },
          },
          b: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
          c: {
            x: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            y: { value: 0, velocity: 0, lastUpdatedAt: 0 },
            scale: { value: 1, logVelocity: 0, lastUpdatedAt: 0 },
          },
        },
        itemTargets: {
          a: { x: 0, y: 0, scale: 1 },
          b: { x: 0, y: 0, scale: 1 },
          c: { x: 0, y: 0, scale: 1 },
        },
      };
      for (let i = 1; i <= 300; i++) {
        state = reduce(state, { type: "tick", timestamp: i * 16 });
        if (state.type === "settled") break;
      }
      expect(state.type).toBe("settled");
      expect(state.items["a"].scale.value).toBeCloseTo(1, 1);
    });

    it("stays snapping on release", () => {
      const reduce = makeReduce();
      const state = makeSnappingState();
      expect(reduce(state, { type: "release" })).toBe(state);
    });

    it("transitions to tracking on motion", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingState(), motion({ dx: -20 }));
      expect(after.type).toBe("tracking");
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
      expect(pub.items["a"]).toEqual({
        transformX: -10,
        transformY: 5,
        scale: 1.5,
      });
      expect(pub.items["b"]).toEqual({
        transformX: 0,
        transformY: 0,
        scale: 1,
      });
    });
  });
});
