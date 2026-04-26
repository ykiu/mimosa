import type { InterpreterEvent, StoreAction } from "../types.js";
import {
  type LinearPrimitive,
  type ExponentialPrimitive,
  createLinearPrimitive,
  createExponentialPrimitive,
  applyLinearDelta,
  applyExponentialFactor,
  advanceLinearInertia,
  advanceExponentialInertia,
  advanceLinearSpring,
  advanceExponentialSpring,
} from "./primitives.js";

export type Transform = {
  x: LinearPrimitive;
  y: LinearPrimitive;
  scale: ExponentialPrimitive;
};

export type TransformSnapTarget = { x: number; y: number; scale: number };

export type TransformConfig = {
  bounds?: (scale: number) => {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  snapTarget?: (transform: Transform) => TransformSnapTarget | null;
};

export type TransformPrivateState =
  | { type: "tracking"; transform: Transform }
  | { type: "inertia"; transform: Transform }
  | { type: "snapping"; transform: Transform; target: TransformSnapTarget }
  | { type: "settled"; transform: Transform };

type MotionEvent = Extract<InterpreterEvent, { type: "motion" }>;

const SNAP_THRESHOLD = 0.5; // px
const SCALE_SNAP_THRESHOLD = 0.001;
const VELOCITY_THRESHOLD = 0.01; // px/ms
const LOG_VELOCITY_THRESHOLD = 0.0001; // log-units/ms

function applyMotion(
  transform: Transform,
  motion: MotionEvent,
  bounds?: TransformConfig["bounds"],
): Transform {
  const { dx, dy, dScale, originX, originY, timestamp } = motion;
  const tx = transform.x.value;
  const ty = transform.y.value;
  const newScale = transform.scale.value * dScale;

  const proposedTx = originX + (tx - originX) * dScale + dx;
  const proposedTy = originY + (ty - originY) * dScale + dy;

  let clampedTx = proposedTx;
  let clampedTy = proposedTy;
  if (bounds) {
    const b = bounds(newScale);
    clampedTx = Math.max(b.minX, Math.min(b.maxX, proposedTx));
    clampedTy = Math.max(b.minY, Math.min(b.maxY, proposedTy));
  }

  return {
    x: applyLinearDelta(transform.x, clampedTx - tx, timestamp),
    y: applyLinearDelta(transform.y, clampedTy - ty, timestamp),
    scale: applyExponentialFactor(transform.scale, dScale, timestamp),
  };
}

function hasSignificantVelocity(transform: Transform): boolean {
  return (
    Math.abs(transform.x.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(transform.y.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(transform.scale.logVelocity) > LOG_VELOCITY_THRESHOLD
  );
}

function advanceInertia(transform: Transform, timestamp: number): Transform {
  return {
    x: advanceLinearInertia(transform.x, timestamp),
    y: advanceLinearInertia(transform.y, timestamp),
    scale: advanceExponentialInertia(transform.scale, timestamp),
  };
}

function advanceSpring(
  transform: Transform,
  target: TransformSnapTarget,
  timestamp: number,
): Transform {
  return {
    x: advanceLinearSpring(transform.x, target.x, timestamp),
    y: advanceLinearSpring(transform.y, target.y, timestamp),
    scale: advanceExponentialSpring(transform.scale, target.scale, timestamp),
  };
}

function isSnapSettled(
  transform: Transform,
  target: TransformSnapTarget,
): boolean {
  return (
    Math.abs(transform.x.value - target.x) < SNAP_THRESHOLD &&
    Math.abs(transform.y.value - target.y) < SNAP_THRESHOLD &&
    Math.abs(transform.scale.value - target.scale) < SCALE_SNAP_THRESHOLD
  );
}

export function settleTransform(transform: Transform): Transform {
  return {
    x: {
      value: transform.x.value,
      velocity: 0,
      lastUpdatedAt: transform.x.lastUpdatedAt,
    },
    y: {
      value: transform.y.value,
      velocity: 0,
      lastUpdatedAt: transform.y.lastUpdatedAt,
    },
    scale: {
      value: transform.scale.value,
      logVelocity: 0,
      lastUpdatedAt: transform.scale.lastUpdatedAt,
    },
  };
}

function settleAtTarget(
  target: TransformSnapTarget,
  timestamp: number,
): Transform {
  return {
    x: { value: target.x, velocity: 0, lastUpdatedAt: timestamp },
    y: { value: target.y, velocity: 0, lastUpdatedAt: timestamp },
    scale: { value: target.scale, logVelocity: 0, lastUpdatedAt: timestamp },
  };
}

export function createTransformReduce(config?: TransformConfig) {
  const { bounds, snapTarget } = config ?? {};

  return function reduce(
    state: TransformPrivateState | undefined = {
      type: "settled",
      transform: {
        x: createLinearPrimitive(0),
        y: createLinearPrimitive(0),
        scale: createExponentialPrimitive(1),
      },
    },
    action: StoreAction,
  ): TransformPrivateState {
    switch (state.type) {
      case "tracking": {
        switch (action.type) {
          case "motion":
            return {
              ...state,
              transform: applyMotion(state.transform, action, bounds),
            };
          case "release": {
            if (snapTarget) {
              const target = snapTarget(state.transform);
              if (target)
                return { type: "snapping", transform: state.transform, target };
            }
            if (hasSignificantVelocity(state.transform)) {
              return { type: "inertia", transform: state.transform };
            }
            return {
              type: "settled",
              transform: settleTransform(state.transform),
            };
          }
          case "tick":
            return state;
        }
        throw new Error("unreachable");
      }
      case "inertia": {
        switch (action.type) {
          case "motion":
            return {
              type: "tracking",
              transform: applyMotion(state.transform, action, bounds),
            };
          case "release": {
            if (snapTarget) {
              const target = snapTarget(state.transform);
              if (target)
                return { type: "snapping", transform: state.transform, target };
            }
            return {
              type: "settled",
              transform: settleTransform(state.transform),
            };
          }
          case "tick": {
            if (hasSignificantVelocity(state.transform)) {
              return {
                ...state,
                transform: advanceInertia(state.transform, action.timestamp),
              };
            }
            if (snapTarget) {
              const target = snapTarget(state.transform);
              if (target) {
                if (isSnapSettled(state.transform, target)) {
                  return {
                    type: "settled",
                    transform: settleAtTarget(target, action.timestamp),
                  };
                }
                return { type: "snapping", transform: state.transform, target };
              }
            }
            return {
              type: "settled",
              transform: settleTransform(state.transform),
            };
          }
        }
        throw new Error("unreachable");
      }
      case "snapping": {
        switch (action.type) {
          case "motion":
            return {
              type: "tracking",
              transform: applyMotion(state.transform, action, bounds),
            };
          case "release":
            return state;
          case "tick": {
            const { target } = state;
            if (isSnapSettled(state.transform, target)) {
              return {
                type: "settled",
                transform: settleAtTarget(
                  target,
                  action.timestamp,
                ),
              };
            }
            return {
              ...state,
              transform: advanceSpring(
                state.transform,
                target,
                action.timestamp,
              ),
            };
          }
        }
        throw new Error("unreachable");
      }
      case "settled": {
        switch (action.type) {
          case "motion":
            return {
              type: "tracking",
              transform: applyMotion(state.transform, action, bounds),
            };
          case "release":
            return state;
          case "tick":
            return state;
        }
        throw new Error("unreachable");
      }
    }
  };
}
