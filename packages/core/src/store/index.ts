import type {
  Store,
  MountedStore,
  MountedInterpreter,
  Motion,
  State,
  Callback,
  UnsubscribeFn,
} from '../types.js';
import {
  LinearPrimitive,
  ExponentialPrimitive,
  createLinearPrimitive,
  createExponentialPrimitive,
  applyLinearDelta,
  applyExponentialFactor,
  advanceLinearInertia,
  advanceExponentialInertia,
} from './primitives.js';

type Transform = {
  x: LinearPrimitive;
  y: LinearPrimitive;
  scale: ExponentialPrimitive;
};

type StoreState = {
  transform: Transform;
  pendingMotions: Motion[];
};

type StoreAction = { type: 'motion'; motion: Motion } | { type: 'tick'; dtMs: number };

type ReducerResult = { state: StoreState; shouldEmit: boolean };

function applyMotion(transform: Transform, motion: Motion, dtMs: number): Transform {
  // When the scale origin is not at (0,0), we need to adjust the translation
  // so that the point under the pinch stays fixed.
  //
  // Formula: newTX = originX + (tx - originX) * dScale + dx
  //          newTY = originY + (ty - originY) * dScale + dy
  const { dx, dy, dScale, originX, originY } = motion;

  const tx = transform.x.value;
  const ty = transform.y.value;

  const newTx = originX + (tx - originX) * dScale + dx;
  const newTy = originY + (ty - originY) * dScale + dy;

  return {
    x: applyLinearDelta(transform.x, newTx - tx, dtMs),
    y: applyLinearDelta(transform.y, newTy - ty, dtMs),
    scale: applyExponentialFactor(transform.scale, dScale, dtMs),
  };
}

function advanceInertia(transform: Transform, dtMs: number): Transform {
  return {
    x: advanceLinearInertia(transform.x, dtMs),
    y: advanceLinearInertia(transform.y, dtMs),
    scale: advanceExponentialInertia(transform.scale, dtMs),
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

function reduce(state: StoreState, action: StoreAction): ReducerResult {
  switch (action.type) {
    case 'motion':
      return {
        state: { ...state, pendingMotions: [...state.pendingMotions, action.motion] },
        shouldEmit: false,
      };
    case 'tick': {
      if (state.pendingMotions.length > 0) {
        let transform = state.transform;
        for (const motion of state.pendingMotions) {
          transform = applyMotion(transform, motion, action.dtMs / state.pendingMotions.length);
        }
        return { state: { transform, pendingMotions: [] }, shouldEmit: true };
      }
      if (hasSignificantVelocity(state.transform)) {
        return {
          state: { transform: advanceInertia(state.transform, action.dtMs), pendingMotions: [] },
          shouldEmit: true,
        };
      }
      return { state, shouldEmit: false };
    }
  }
}

export function createStore(): Store {
  return (interpreters: MountedInterpreter[]): MountedStore => {
    const callbacks = new Set<Callback<State>>();

    let state: StoreState = {
      transform: {
        x: createLinearPrimitive(0),
        y: createLinearPrimitive(0),
        scale: createExponentialPrimitive(1),
      },
      pendingMotions: [],
    };

    let lastTimestamp: number | null = null;
    let rafId: number | null = null;
    let mounted = true;

    function dispatch(action: StoreAction) {
      const result = reduce(state, action);
      state = result.state;
      if (result.shouldEmit) {
        const publicState = toPublicState(state.transform);
        for (const cb of callbacks) cb(publicState);
      }
    }

    function loop(timestamp: number) {
      if (!mounted) return;
      const dtMs = lastTimestamp !== null ? Math.min(timestamp - lastTimestamp, 100) : 16;
      lastTimestamp = timestamp;
      dispatch({ type: 'tick', dtMs });
      rafId = requestAnimationFrame(loop);
    }

    // Subscribe to all interpreters
    const unsubscribers = interpreters.map((interp) =>
      interp.subscribe((motion: Motion) => {
        dispatch({ type: 'motion', motion });
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
