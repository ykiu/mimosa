import type {
  Store,
  MountedStore,
  MountedInterpreter,
  InterpreterEvent,
  State,
  Callback,
  UnsubscribeFn,
  SnapConfig,
} from "../types.js";
import {
  LinearPrimitive,
  ExponentialPrimitive,
  createLinearPrimitive,
  createExponentialPrimitive,
  applyLinearDelta,
  applyExponentialFactor,
  advanceLinearInertia,
  advanceExponentialInertia,
  advanceLinearSpring,
} from "./primitives.js";

type Transform = {
  x: LinearPrimitive;
  y: LinearPrimitive;
  scale: ExponentialPrimitive;
};

type MotionEvent = Extract<InterpreterEvent, { type: "motion" }>;

type StoreState =
  | { type: "tracking"; transform: Transform }
  | { type: "inertia"; transform: Transform }
  | {
      type: "snapping";
      transform: Transform;
      target: { x: number; y: number };
    }
  | { type: "settled"; transform: Transform };

type StoreAction = InterpreterEvent | { type: "tick"; timestamp: number };

type Reducer = (state: StoreState, action: StoreAction) => StoreState;

const SNAP_THRESHOLD = 0.5; // px

function applyMotion(transform: Transform, motion: MotionEvent): Transform {
  // When the scale origin is not at (0,0), we need to adjust the translation
  // so that the point under the pinch stays fixed.
  //
  // Formula: newTX = originX + (tx - originX) * dScale + dx
  //          newTY = originY + (ty - originY) * dScale + dy
  const { dx, dy, dScale, originX, originY, timestamp } = motion;

  const tx = transform.x.value;
  const ty = transform.y.value;

  const newTx = originX + (tx - originX) * dScale + dx;
  const newTy = originY + (ty - originY) * dScale + dy;

  return {
    x: applyLinearDelta(transform.x, newTx - tx, timestamp),
    y: applyLinearDelta(transform.y, newTy - ty, timestamp),
    scale: applyExponentialFactor(transform.scale, dScale, timestamp),
  };
}

function advanceInertia(transform: Transform, timestamp: number): Transform {
  return {
    x: advanceLinearInertia(transform.x, timestamp),
    y: advanceLinearInertia(transform.y, timestamp),
    scale: advanceExponentialInertia(transform.scale, timestamp),
  };
}

function toPublicState(transform: Transform): State {
  return {
    transformX: transform.x.value,
    transformY: transform.y.value,
    scale: transform.scale.value,
  };
}

const VELOCITY_THRESHOLD = 0.01; // px/ms
const LOG_VELOCITY_THRESHOLD = 0.0001; // log-units/ms

function hasSignificantVelocity(transform: Transform): boolean {
  return (
    Math.abs(transform.x.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(transform.y.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(transform.scale.logVelocity) > LOG_VELOCITY_THRESHOLD
  );
}

function computeSnapTarget(
  snap: SnapConfig,
  transform: Transform,
): { x: number; y: number } {
  return {
    x: snap.x ? snap.x(transform.x.value) : transform.x.value,
    y: snap.y ? snap.y(transform.y.value) : transform.y.value,
  };
}

function createReduce(snap?: SnapConfig): Reducer {
  return function reduce(state: StoreState, action: StoreAction): StoreState {
    switch (state.type) {
      case "tracking": {
        switch (action.type) {
          case "motion":
            return {
              ...state,
              type: "tracking",
              transform: applyMotion(state.transform, action),
            };
          case "release": {
            if (snap) {
              const target = computeSnapTarget(snap, state.transform);
              return {
                ...state,
                type: "snapping",
                target,
              };
            }
            return { ...state, type: "inertia" };
          }
          case "tick": {
            return state;
          }
        }
      }
      case "inertia": {
        switch (action.type) {
          case "motion":
            return {
              ...state,
              type: "tracking",
              transform: applyMotion(state.transform, action),
            };
          case "release": {
            if (snap) {
              const target = computeSnapTarget(snap, state.transform);
              return {
                ...state,
                type: "snapping",
                target,
              };
            }
            return { ...state, type: "settled" };
          }
          case "tick": {
            if (hasSignificantVelocity(state.transform)) {
              return {
                ...state,
                type: "inertia",
                transform: advanceInertia(state.transform, action.timestamp),
              };
            }
            if (snap) {
              const target = computeSnapTarget(snap, state.transform);
              const gapX = Math.abs(target.x - state.transform.x.value);
              const gapY = Math.abs(target.y - state.transform.y.value);
              if (gapX < SNAP_THRESHOLD && gapY < SNAP_THRESHOLD) {
                const transform = {
                  ...state.transform,
                  x: {
                    value: target.x,
                    velocity: 0,
                    lastUpdatedAt: action.timestamp,
                  },
                  y: {
                    value: target.y,
                    velocity: 0,
                    lastUpdatedAt: action.timestamp,
                  },
                };
                return { type: "settled", transform };
              }
              return { ...state, type: "snapping", target };
            }
            return { ...state, type: "settled" };
          }
        }
      }
      case "snapping": {
        switch (action.type) {
          case "motion":
            return {
              ...state,
              type: "tracking",
              transform: applyMotion(state.transform, action),
            };
          case "release":
            return state;
          case "tick": {
            const { target } = state;
            const gapX = Math.abs(target.x - state.transform.x.value);
            const gapY = Math.abs(target.y - state.transform.y.value);
            if (gapX < SNAP_THRESHOLD && gapY < SNAP_THRESHOLD) {
              const transform = {
                ...state.transform,
                x: {
                  value: target.x,
                  velocity: 0,
                  lastUpdatedAt: action.timestamp,
                },
                y: {
                  value: target.y,
                  velocity: 0,
                  lastUpdatedAt: action.timestamp,
                },
              };
              return { type: "settled", transform };
            }
            const x = advanceLinearSpring(
              state.transform.x,
              target.x,
              action.timestamp,
            );
            const y = advanceLinearSpring(
              state.transform.y,
              target.y,
              action.timestamp,
            );
            return { ...state, transform: { ...state.transform, x, y } };
          }
        }
      }
      case "settled": {
        switch (action.type) {
          case "motion":
            return {
              ...state,
              type: "tracking",
              transform: applyMotion(state.transform, action),
            };
          case "release":
            return state;
          case "tick":
            return state;
        }
      }
    }
  };
}

export function createStore(options?: { snap?: SnapConfig }): Store {
  const reduce = createReduce(options?.snap);
  return (interpreters: MountedInterpreter[]): MountedStore => {
    const callbacks = new Set<Callback<State>>();

    let state: StoreState = {
      type: "settled",
      transform: {
        x: createLinearPrimitive(0),
        y: createLinearPrimitive(0),
        scale: createExponentialPrimitive(1),
      },
    };

    let rafId: number | null = null;
    let mounted = true;

    function loop(timestamp: number) {
      if (!mounted) return;
      const tickResult = reduce(state, { type: "tick", timestamp });
      state = tickResult;
      const publicState = toPublicState(state.transform);
      for (const cb of callbacks) cb(publicState);
      rafId = requestAnimationFrame(loop);
    }

    // Subscribe to all interpreters
    const unsubscribers = interpreters.map((interp) =>
      interp.subscribe((event) => {
        state = reduce(state, event);
      }),
    );

    // Start the loop
    rafId = requestAnimationFrame(loop);

    return {
      subscribe(cb: Callback<State>): UnsubscribeFn {
        callbacks.add(cb);
        return () => callbacks.delete(cb);
      },
      unmount() {
        mounted = false;
        if (rafId !== null) cancelAnimationFrame(rafId);
        for (const unsub of unsubscribers) unsub();
        callbacks.clear();
      },
    };
  };
}
