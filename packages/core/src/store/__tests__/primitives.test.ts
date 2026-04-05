import { describe, it, expect } from 'vitest';
import {
  createLinearPrimitive,
  applyLinearDelta,
  advanceLinearInertia,
  advanceLinearSpring,
  createExponentialPrimitive,
  applyExponentialFactor,
  advanceExponentialInertia,
} from '../primitives.js';

describe('LinearPrimitive', () => {
  it('applies delta and computes velocity', () => {
    const prim = createLinearPrimitive(0);
    // lastUpdatedAt is NaN, so dtMs defaults to 16ms regardless of timestamp value
    const next = applyLinearDelta(prim, 20, 1000);
    expect(next.value).toBe(20);
    expect(next.velocity).toBeCloseTo(20 / 16);
    expect(next.lastUpdatedAt).toBe(1000);
  });

  it('computes velocity from elapsed time on subsequent updates', () => {
    const prim = applyLinearDelta(createLinearPrimitive(0), 0, 1000); // initialize at t=1000
    const next = applyLinearDelta(prim, 20, 1016); // 16ms later
    expect(next.value).toBe(20);
    expect(next.velocity).toBeCloseTo(20 / 16);
  });

  it('decays velocity over time', () => {
    const prim = { value: 0, velocity: 10, lastUpdatedAt: 0 }; // 10 px/ms
    const next = advanceLinearInertia(prim, 16);
    expect(next.velocity).toBeLessThan(10);
    expect(next.value).toBeGreaterThan(0);
  });

  it('velocity decays to near zero over many frames', () => {
    let prim = { value: 0, velocity: 10, lastUpdatedAt: 0 };
    for (let i = 1; i <= 500; i++) {
      prim = advanceLinearInertia(prim, i * 16);
    }
    expect(Math.abs(prim.velocity)).toBeLessThan(0.001);
  });
});

describe('advanceLinearSpring', () => {
  it('moves value toward target', () => {
    const prim = { value: 0, velocity: 0, lastUpdatedAt: 0 };
    const next = advanceLinearSpring(prim, 100, 16);
    expect(next.value).toBeGreaterThan(0);
    expect(next.value).toBeLessThan(100);
  });

  it('converges to target over many frames', () => {
    let prim = { value: 0, velocity: 0, lastUpdatedAt: 0 };
    for (let i = 1; i <= 200; i++) {
      prim = advanceLinearSpring(prim, 100, i * 16);
    }
    expect(prim.value).toBeCloseTo(100, 1);
  });

  it('returns target immediately when already at target', () => {
    const prim = { value: 100, velocity: 0, lastUpdatedAt: 0 };
    const next = advanceLinearSpring(prim, 100, 16);
    expect(next.value).toBeCloseTo(100);
    expect(next.velocity).toBeCloseTo(0);
  });
});

describe('ExponentialPrimitive', () => {
  it('applies multiplicative factor', () => {
    const prim = createExponentialPrimitive(1);
    // lastUpdatedAt is NaN, so dtMs defaults to 16ms
    const next = applyExponentialFactor(prim, 2, 1000);
    expect(next.value).toBeCloseTo(2);
    expect(next.lastUpdatedAt).toBe(1000);
  });

  it('logVelocity decays to near zero over many frames', () => {
    let prim = applyExponentialFactor(createExponentialPrimitive(1), 1.5, 1000);
    for (let i = 1; i <= 500; i++) {
      prim = advanceExponentialInertia(prim, 1000 + i * 16);
    }
    expect(Math.abs(prim.logVelocity)).toBeLessThan(0.00001);
  });
});
