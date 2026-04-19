import { describe, it, expect } from "vitest";
import { createModel, type TransformPrivateState } from "../index.js";
import {
  createLinearPrimitive,
  createExponentialPrimitive,
} from "../primitives.js";

function makeReduce(config?: Parameters<typeof createModel>[0]) {
  return createModel(config).reduce;
}

function makeTransform(x = 0, y = 0, scale = 1) {
  return {
    x: createLinearPrimitive(x),
    y: createLinearPrimitive(y),
    scale: createExponentialPrimitive(scale),
  };
}

function makeTransformWithVelocity(vx = 0, vy = 0, x = 0, y = 0) {
  return {
    x: { value: x, velocity: vx, lastUpdatedAt: 0 },
    y: { value: y, velocity: vy, lastUpdatedAt: 0 },
    scale: createExponentialPrimitive(1),
  };
}

describe("createModel", () => {
  describe("initial state", () => {
    it("returns settled state with zero transform when called with undefined", () => {
      const reduce = makeReduce();
      const state = reduce(undefined, { type: "tick", timestamp: 0 });
      expect(state.type).toBe("settled");
      expect(state.transform.x.value).toBe(0);
      expect(state.transform.y.value).toBe(0);
      expect(state.transform.scale.value).toBe(1);
    });
  });

  describe("settled state", () => {
    it("transitions to tracking on motion", () => {
      const reduce = makeReduce();
      const state = reduce(
        { type: "settled", transform: makeTransform() },
        {
          type: "motion",
          timestamp: 0,
          dx: 10,
          dy: 5,
          dScale: 1,
          originX: 0,
          originY: 0,
        },
      );
      expect(state.type).toBe("tracking");
    });

    it("stays settled on tick", () => {
      const reduce = makeReduce();
      const state = reduce(
        { type: "settled", transform: makeTransform() },
        { type: "tick", timestamp: 16 },
      );
      expect(state.type).toBe("settled");
    });

    it("stays settled on release", () => {
      const reduce = makeReduce();
      const state = reduce(
        { type: "settled", transform: makeTransform() },
        { type: "release" },
      );
      expect(state.type).toBe("settled");
    });
  });

  describe("tracking state", () => {
    it("stays tracking on motion", () => {
      const reduce = makeReduce();
      const state = reduce(
        { type: "tracking", transform: makeTransform() },
        {
          type: "motion",
          timestamp: 0,
          dx: 10,
          dy: 5,
          dScale: 1,
          originX: 0,
          originY: 0,
        },
      );
      expect(state.type).toBe("tracking");
    });

    it("applies translation delta to transform", () => {
      const reduce = makeReduce();
      const state = reduce(
        { type: "tracking", transform: makeTransform(10, 20) },
        {
          type: "motion",
          timestamp: 0,
          dx: 5,
          dy: -3,
          dScale: 1,
          originX: 0,
          originY: 0,
        },
      );
      expect(state.transform.x.value).toBeCloseTo(15);
      expect(state.transform.y.value).toBeCloseTo(17);
    });

    it("adjusts translation for scale origin", () => {
      const reduce = makeReduce();
      // Zoom 2x at (100, 100) from (0, 0)
      // newTx = 100 + (0 - 100) * 2 + 0 = -100
      // newTy = 100 + (0 - 100) * 2 + 0 = -100
      const state = reduce(
        { type: "tracking", transform: makeTransform() },
        {
          type: "motion",
          timestamp: 0,
          dx: 0,
          dy: 0,
          dScale: 2,
          originX: 100,
          originY: 100,
        },
      );
      expect(state.transform.x.value).toBeCloseTo(-100);
      expect(state.transform.y.value).toBeCloseTo(-100);
      expect(state.transform.scale.value).toBeCloseTo(2);
    });

    it("transitions to settled on release with no velocity and no snap", () => {
      const reduce = makeReduce();
      const state = reduce(
        { type: "tracking", transform: makeTransform() },
        { type: "release" },
      );
      expect(state.type).toBe("settled");
    });

    it("transitions to inertia on release when velocity is significant", () => {
      const reduce = makeReduce();
      const state = reduce(
        {
          type: "tracking",
          transform: makeTransformWithVelocity(5, 0),
        },
        { type: "release" },
      );
      expect(state.type).toBe("inertia");
    });

    it("transitions to snapping on release with snap", () => {
      const reduce = makeReduce({
        snapTarget: (t) => ({
          x: Math.round(t.x.value / 100) * 100,
          y: t.y.value,
          scale: t.scale.value,
        }),
      });
      const state = reduce(
        { type: "tracking", transform: makeTransform(60) },
        { type: "release" },
      );
      expect(state.type).toBe("snapping");
      if (state.type === "snapping") {
        expect(state.target.x).toBe(100);
      }
    });

    it("stays tracking on tick", () => {
      const reduce = makeReduce();
      const state = reduce(
        { type: "tracking", transform: makeTransform() },
        { type: "tick", timestamp: 16 },
      );
      expect(state.type).toBe("tracking");
    });
  });

  describe("inertia state", () => {
    it("transitions to tracking on motion", () => {
      const reduce = makeReduce();
      const state = reduce(
        { type: "inertia", transform: makeTransformWithVelocity(1, 0) },
        {
          type: "motion",
          timestamp: 0,
          dx: 5,
          dy: 0,
          dScale: 1,
          originX: 0,
          originY: 0,
        },
      );
      expect(state.type).toBe("tracking");
    });

    it("advances inertia on tick when velocity is significant", () => {
      const reduce = makeReduce();
      const before = {
        type: "inertia" as const,
        transform: makeTransformWithVelocity(10, 0),
      };
      const after = reduce(before, { type: "tick", timestamp: 16 });
      expect(after.type).toBe("inertia");
      expect(after.transform.x.value).toBeGreaterThan(0);
    });

    it("transitions to settled on tick when velocity is negligible (no snap)", () => {
      const reduce = makeReduce();
      const state = reduce(
        { type: "inertia", transform: makeTransformWithVelocity(0, 0) },
        { type: "tick", timestamp: 16 },
      );
      expect(state.type).toBe("settled");
    });

    it("transitions to settled on release without snap", () => {
      const reduce = makeReduce();
      const state = reduce(
        { type: "inertia", transform: makeTransformWithVelocity() },
        { type: "release" },
      );
      expect(state.type).toBe("settled");
    });

    it("transitions to snapping on release with snap", () => {
      const reduce = makeReduce({
        snapTarget: (t) => ({
          x: Math.round(t.x.value / 100) * 100,
          y: t.y.value,
          scale: t.scale.value,
        }),
      });
      const state = reduce(
        { type: "inertia", transform: makeTransformWithVelocity(0, 0, 60) },
        { type: "release" },
      );
      expect(state.type).toBe("snapping");
    });

    it("transitions to snapping on tick when velocity decays and snap target is far", () => {
      const reduce = makeReduce({
        snapTarget: (t) => ({
          x: Math.round(t.x.value / 100) * 100,
          y: t.y.value,
          scale: t.scale.value,
        }),
      });
      // at x=60, no velocity — snap target is 100, gap is 40 > SNAP_THRESHOLD
      const state = reduce(
        { type: "inertia", transform: makeTransformWithVelocity(0, 0, 60) },
        { type: "tick", timestamp: 16 },
      );
      expect(state.type).toBe("snapping");
    });

    it("transitions to settled on tick when snap target is already within threshold", () => {
      const reduce = makeReduce({
        snapTarget: (t) => ({
          x: Math.round(t.x.value / 100) * 100,
          y: t.y.value,
          scale: t.scale.value,
        }),
      });
      // at x=100.1, snap target is 100, gap is 0.1 < SNAP_THRESHOLD (0.5)
      const state = reduce(
        { type: "inertia", transform: makeTransformWithVelocity(0, 0, 100.1) },
        { type: "tick", timestamp: 16 },
      );
      expect(state.type).toBe("settled");
      expect(state.transform.x.value).toBeCloseTo(100, 1);
    });
  });

  describe("snapping state", () => {
    function makeSnappingState(
      x: number,
      targetX: number,
    ): TransformPrivateState {
      return {
        type: "snapping",
        transform: makeTransform(x),
        target: { x: targetX, y: 0, scale: 1 },
      };
    }

    it("transitions to tracking on motion", () => {
      const reduce = makeReduce();
      const state = reduce(makeSnappingState(60, 100), {
        type: "motion",
        timestamp: 0,
        dx: 5,
        dy: 0,
        dScale: 1,
        originX: 0,
        originY: 0,
      });
      expect(state.type).toBe("tracking");
    });

    it("stays snapping on release", () => {
      const reduce = makeReduce();
      const state = reduce(makeSnappingState(60, 100), { type: "release" });
      expect(state.type).toBe("snapping");
    });

    it("advances spring toward target on tick when far", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingState(60, 100), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.type).toBe("snapping");
      expect(after.transform.x.value).toBeGreaterThan(60);
      expect(after.transform.x.value).toBeLessThan(100);
    });

    it("transitions to settled when within snap threshold", () => {
      const reduce = makeReduce();
      const after = reduce(makeSnappingState(99.9, 100), {
        type: "tick",
        timestamp: 16,
      });
      expect(after.type).toBe("settled");
      expect(after.transform.x.value).toBeCloseTo(100);
    });

    it("converges to snap target over many frames", () => {
      const reduce = makeReduce();
      let state: TransformPrivateState = makeSnappingState(0, 100);
      for (let i = 1; i <= 200; i++) {
        state = reduce(state, { type: "tick", timestamp: i * 16 });
        if (state.type === "settled") break;
      }
      expect(state.type).toBe("settled");
      expect(state.transform.x.value).toBeCloseTo(100, 0);
    });
  });
});
