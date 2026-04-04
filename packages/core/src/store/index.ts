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

type InternalState = {
  x: LinearPrimitive;
  y: LinearPrimitive;
  scale: ExponentialPrimitive;
};

function applyMotion(state: InternalState, motion: Motion, dtMs: number): InternalState {
  // When the scale origin is not at (0,0), we need to adjust the translation
  // so that the point under the pinch stays fixed.
  //
  // Formula: newTX = originX + (tx - originX) * dScale + dx
  //          newTY = originY + (ty - originY) * dScale + dy
  const { dx, dy, dScale, originX, originY } = motion;

  const tx = state.x.value;
  const ty = state.y.value;

  const newTx = originX + (tx - originX) * dScale + dx;
  const newTy = originY + (ty - originY) * dScale + dy;

  const deltaTx = newTx - tx;
  const deltaTy = newTy - ty;

  return {
    x: applyLinearDelta(state.x, deltaTx, dtMs),
    y: applyLinearDelta(state.y, deltaTy, dtMs),
    scale: applyExponentialFactor(state.scale, dScale, dtMs),
  };
}

function advanceInertia(state: InternalState, dtMs: number): InternalState {
  return {
    x: advanceLinearInertia(state.x, dtMs),
    y: advanceLinearInertia(state.y, dtMs),
    scale: advanceExponentialInertia(state.scale, dtMs),
  };
}

function toPublicState(state: InternalState): State {
  return {
    transformX: state.x.value,
    transformY: state.y.value,
    scale: state.scale.value,
  };
}

const VELOCITY_THRESHOLD = 0.01; // px/ms
const LOG_VELOCITY_THRESHOLD = 0.0001; // log-units/ms

function hasSignificantVelocity(state: InternalState): boolean {
  return (
    Math.abs(state.x.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(state.y.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(state.scale.logVelocity) > LOG_VELOCITY_THRESHOLD
  );
}

export function createStore(): Store {
  return (interpreters: MountedInterpreter[]): MountedStore => {
    const callbacks = new Set<Callback<State>>();
    const pendingMotions: Motion[] = [];

    let internalState: InternalState = {
      x: createLinearPrimitive(0),
      y: createLinearPrimitive(0),
      scale: createExponentialPrimitive(1),
    };

    let lastTimestamp: number | null = null;
    let rafId: number | null = null;
    let mounted = true;

    function emit() {
      const state = toPublicState(internalState);
      for (const cb of callbacks) cb(state);
    }

    function loop(timestamp: number) {
      if (!mounted) return;

      const dtMs = lastTimestamp !== null ? Math.min(timestamp - lastTimestamp, 100) : 16;
      lastTimestamp = timestamp;

      if (pendingMotions.length > 0) {
        // Collapse all pending motions into the state
        for (const motion of pendingMotions) {
          internalState = applyMotion(internalState, motion, dtMs / pendingMotions.length);
        }
        pendingMotions.length = 0;
        emit();
      } else if (hasSignificantVelocity(internalState)) {
        internalState = advanceInertia(internalState, dtMs);
        emit();
      }

      rafId = requestAnimationFrame(loop);
    }

    // Subscribe to all interpreters
    const unsubscribers = interpreters.map((interp) =>
      interp.subscribe((motion: Motion) => {
        pendingMotions.push(motion);
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
