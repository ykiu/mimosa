/**
 * LinearPrimitive tracks a linearly-behaving value (e.g. translation).
 * Velocity is expressed in units per millisecond.
 * lastUpdatedAt is NaN when the primitive has never been updated.
 */
export type LinearPrimitive = {
  value: number;
  velocity: number; // units/ms
  lastUpdatedAt: number; // NaN if never updated
};

export function createLinearPrimitive(value = 0): LinearPrimitive {
  return { value, velocity: 0, lastUpdatedAt: NaN };
}

function computeDtMs(lastUpdatedAt: number, timestamp: number): number {
  if (Number.isNaN(lastUpdatedAt)) return 16; // default for first update
  return Math.min(timestamp - lastUpdatedAt, 100); // cap to avoid huge jumps after suspension
}

/**
 * Apply a delta to a LinearPrimitive and update velocity.
 */
export function applyLinearDelta(
  prim: LinearPrimitive,
  delta: number,
  timestamp: number,
): LinearPrimitive {
  const dtMs = computeDtMs(prim.lastUpdatedAt, timestamp);
  const newValue = prim.value + delta;
  const velocity = dtMs > 0 ? delta / dtMs : 0;
  return { value: newValue, velocity, lastUpdatedAt: timestamp };
}

/**
 * Advance a LinearPrimitive by inertia (exponential decay of velocity).
 * decayFactor: fraction of velocity retained per ms (e.g. 0.99 = fast, 0.90 = slow)
 */
export function advanceLinearInertia(
  prim: LinearPrimitive,
  timestamp: number,
  decayFactor = 0.99,
): LinearPrimitive {
  const dtMs = computeDtMs(prim.lastUpdatedAt, timestamp);
  const retainedFactor = Math.pow(decayFactor, dtMs);
  const velocity = prim.velocity * retainedFactor;
  const value = prim.value + velocity * dtMs;
  return { value, velocity, lastUpdatedAt: timestamp };
}

/**
 * ExponentialPrimitive tracks a multiplicative value (e.g. scale).
 * Uses log-space internally for natural inertia behaviour.
 * logVelocity is expressed in log-units per millisecond.
 * lastUpdatedAt is NaN when the primitive has never been updated.
 */
export type ExponentialPrimitive = {
  value: number; // actual scale (always positive)
  logVelocity: number; // d(ln value)/dt in 1/ms
  lastUpdatedAt: number; // NaN if never updated
};

export function createExponentialPrimitive(value = 1): ExponentialPrimitive {
  return { value, logVelocity: 0, lastUpdatedAt: NaN };
}

/**
 * Apply a multiplicative factor to an ExponentialPrimitive and update velocity.
 */
export function applyExponentialFactor(
  prim: ExponentialPrimitive,
  factor: number,
  timestamp: number,
): ExponentialPrimitive {
  const dtMs = computeDtMs(prim.lastUpdatedAt, timestamp);
  const newValue = prim.value * factor;
  const logVelocity = dtMs > 0 ? Math.log(factor) / dtMs : 0;
  return { value: newValue, logVelocity, lastUpdatedAt: timestamp };
}

/**
 * Advance an ExponentialPrimitive by inertia.
 */
export function advanceExponentialInertia(
  prim: ExponentialPrimitive,
  timestamp: number,
  decayFactor = 0.98,
): ExponentialPrimitive {
  const dtMs = computeDtMs(prim.lastUpdatedAt, timestamp);
  const retainedFactor = Math.pow(decayFactor, dtMs);
  const logVelocity = prim.logVelocity * retainedFactor;
  const value = prim.value * Math.exp(logVelocity * dtMs);
  return { value, logVelocity, lastUpdatedAt: timestamp };
}

/**
 * Advance a LinearPrimitive toward a target using exponential spring.
 * Each millisecond, the gap between current value and target shrinks by (1 - decayFactor).
 * decayFactor: fraction of gap retained per ms (lower = faster convergence).
 */
export function advanceLinearSpring(
  prim: LinearPrimitive,
  target: number,
  timestamp: number,
  decayFactor = 0.99,
): LinearPrimitive {
  const dtMs = computeDtMs(prim.lastUpdatedAt, timestamp);
  const retainFactor = Math.pow(decayFactor, dtMs);
  const value = target + (prim.value - target) * retainFactor;
  const velocity = dtMs > 0 ? (value - prim.value) / dtMs : 0;
  return { value, velocity, lastUpdatedAt: timestamp };
}
