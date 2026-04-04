/**
 * LinearPrimitive tracks a linearly-behaving value (e.g. translation).
 * Velocity is expressed in units per millisecond.
 */
export type LinearPrimitive = {
  value: number;
  velocity: number; // units/ms
};

export function createLinearPrimitive(value = 0): LinearPrimitive {
  return { value, velocity: 0 };
}

/**
 * Apply a delta to a LinearPrimitive and update velocity.
 */
export function applyLinearDelta(
  prim: LinearPrimitive,
  delta: number,
  dtMs: number,
): LinearPrimitive {
  const newValue = prim.value + delta;
  const velocity = dtMs > 0 ? delta / dtMs : 0;
  return { value: newValue, velocity };
}

/**
 * Advance a LinearPrimitive by inertia (exponential decay of velocity).
 * decayFactor: fraction of velocity retained per ms (e.g. 0.99 = fast, 0.90 = slow)
 */
export function advanceLinearInertia(
  prim: LinearPrimitive,
  dtMs: number,
  decayFactor = 0.98,
): LinearPrimitive {
  const retainedFactor = Math.pow(decayFactor, dtMs);
  const velocity = prim.velocity * retainedFactor;
  const value = prim.value + velocity * dtMs;
  return { value, velocity };
}

/**
 * ExponentialPrimitive tracks a multiplicative value (e.g. scale).
 * Uses log-space internally for natural inertia behaviour.
 * velocity is expressed in log-units per millisecond.
 */
export type ExponentialPrimitive = {
  value: number; // actual scale (always positive)
  logVelocity: number; // d(ln value)/dt in 1/ms
};

export function createExponentialPrimitive(value = 1): ExponentialPrimitive {
  return { value, logVelocity: 0 };
}

/**
 * Apply a multiplicative factor to an ExponentialPrimitive and update velocity.
 */
export function applyExponentialFactor(
  prim: ExponentialPrimitive,
  factor: number,
  dtMs: number,
): ExponentialPrimitive {
  const newValue = prim.value * factor;
  const logVelocity = dtMs > 0 ? Math.log(factor) / dtMs : 0;
  return { value: newValue, logVelocity };
}

/**
 * Advance an ExponentialPrimitive by inertia.
 */
export function advanceExponentialInertia(
  prim: ExponentialPrimitive,
  dtMs: number,
  decayFactor = 0.98,
): ExponentialPrimitive {
  const retainedFactor = Math.pow(decayFactor, dtMs);
  const logVelocity = prim.logVelocity * retainedFactor;
  const value = prim.value * Math.exp(logVelocity * dtMs);
  return { value, logVelocity };
}

/**
 * Advance a LinearPrimitive toward a target using exponential spring.
 * Each millisecond, the gap between current value and target shrinks by (1 - decayFactor).
 * decayFactor: fraction of gap retained per ms (lower = faster convergence).
 */
export function advanceLinearSpring(
  prim: LinearPrimitive,
  target: number,
  dtMs: number,
  decayFactor = 0.9,
): LinearPrimitive {
  const retainFactor = Math.pow(decayFactor, dtMs);
  const value = target + (prim.value - target) * retainFactor;
  const velocity = dtMs > 0 ? (value - prim.value) / dtMs : 0;
  return { value, velocity };
}
