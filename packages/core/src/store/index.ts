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
  | { type: "tracking"; transform: Transform; pendingRelease: boolean }
  | { type: "inertia"; transform: Transform; pendingRelease: boolean }
  | {
      type: "snapping";
      transform: Transform;
      pendingRelease: boolean;
      target: { x: number; y: number };
    }
  | { type: "settled"; transform: Transform; pendingRelease: boolean };

type StoreAction = InterpreterEvent | { type: "tick"; timestamp: number };

type ReducerResult = { state: StoreState; shouldEmit: boolean };

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

function reduce(
  state: StoreState,
  action: StoreAction,
  snap?: SnapConfig,
): ReducerResult {
  switch (state.type) {
    case "tracking": {
      switch (action.type) {
        case "motion":
          return {
            state: {
              ...state,
              type: "tracking",
              transform: applyMotion(state.transform, action),
            },
            shouldEmit: false,
          };
        case "release":
          return {
            state: { ...state, pendingRelease: true },
            shouldEmit: false,
          };
        case "tick": {
          if (state.pendingRelease) {
            if (snap) {
              const target = computeSnapTarget(snap, state.transform);
              return {
                state: {
                  ...state,
                  type: "snapping",
                  target,
                  pendingRelease: false,
                },
                shouldEmit: false,
              };
            }
            return {
              state: { ...state, type: "settled", pendingRelease: false },
              shouldEmit: false,
            };
          }
          if (hasSignificantVelocity(state.transform)) {
            // Transition to inertia without advancing yet — inertia advances from the next tick.
            return { state: { ...state, type: "inertia" }, shouldEmit: false };
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
              return {
                state: { type: "settled", transform, pendingRelease: false },
                shouldEmit: true,
              };
            }
            return {
              state: { ...state, type: "snapping", target },
              shouldEmit: false,
            };
          }
          return { state: { ...state, type: "settled" }, shouldEmit: false };
        }
      }
    }
    case "inertia": {
      switch (action.type) {
        case "motion":
          return {
            state: {
              ...state,
              type: "tracking",
              transform: applyMotion(state.transform, action),
            },
            shouldEmit: false,
          };
        case "release":
          return {
            state: { ...state, pendingRelease: true },
            shouldEmit: false,
          };
        case "tick": {
          if (state.pendingRelease) {
            if (snap) {
              const target = computeSnapTarget(snap, state.transform);
              return {
                state: {
                  ...state,
                  type: "snapping",
                  target,
                  pendingRelease: false,
                },
                shouldEmit: false,
              };
            }
            return {
              state: { ...state, type: "settled", pendingRelease: false },
              shouldEmit: false,
            };
          }
          if (hasSignificantVelocity(state.transform)) {
            return {
              state: {
                ...state,
                type: "inertia",
                transform: advanceInertia(state.transform, action.timestamp),
              },
              shouldEmit: true,
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
              return {
                state: { type: "settled", transform, pendingRelease: false },
                shouldEmit: true,
              };
            }
            return {
              state: { ...state, type: "snapping", target },
              shouldEmit: false,
            };
          }
          return { state: { ...state, type: "settled" }, shouldEmit: false };
        }
      }
    }
    case "snapping": {
      switch (action.type) {
        case "motion":
          return {
            state: {
              ...state,
              type: "tracking",
              transform: applyMotion(state.transform, action),
            },
            shouldEmit: false,
          };
        case "release":
          return { state, shouldEmit: false };
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
            return {
              state: { type: "settled", transform, pendingRelease: false },
              shouldEmit: true,
            };
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
          return {
            state: { ...state, transform: { ...state.transform, x, y } },
            shouldEmit: true,
          };
        }
      }
    }
    case "settled": {
      switch (action.type) {
        case "motion":
          return {
            state: {
              ...state,
              type: "tracking",
              transform: applyMotion(state.transform, action),
            },
            shouldEmit: false,
          };
        case "release":
          return { state, shouldEmit: false };
        case "tick":
          return { state, shouldEmit: false };
      }
    }
  }
}

export function createStore(options?: { snap?: SnapConfig }): Store {
  return (interpreters: MountedInterpreter[]): MountedStore => {
    const callbacks = new Set<Callback<State>>();

    let state: StoreState = {
      type: "settled",
      transform: {
        x: createLinearPrimitive(0),
        y: createLinearPrimitive(0),
        scale: createExponentialPrimitive(1),
      },
      pendingRelease: false,
    };

    let pendingMotions: MotionEvent[] = [];
    let rafId: number | null = null;
    let mounted = true;

    function dispatch(action: Extract<StoreAction, { type: "release" }>) {
      const result = reduce(state, action, options?.snap);
      state = result.state;
    }

    function loop(timestamp: number) {
      if (!mounted) return;
      const motions = pendingMotions;
      pendingMotions = [];
      for (const motion of motions) {
        state = reduce(state, motion, options?.snap).state;
      }
      const tickResult = reduce(
        state,
        { type: "tick", timestamp },
        options?.snap,
      );
      state = tickResult.state;
      if (motions.length > 0 || tickResult.shouldEmit) {
        const publicState = toPublicState(state.transform);
        for (const cb of callbacks) cb(publicState);
      }
      rafId = requestAnimationFrame(loop);
    }

    // Subscribe to all interpreters
    const unsubscribers = interpreters.map((interp) =>
      interp.subscribe((event) => {
        if (event.type === "motion") {
          pendingMotions.push(event);
        } else {
          dispatch(event);
        }
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
