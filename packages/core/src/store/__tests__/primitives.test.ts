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
    const next = applyLinearDelta(prim, 20, 16);
    expect(next.value).toBe(20);
    expect(next.velocity).toBeCloseTo(20 / 16);
  });

  it('decays velocity over time', () => {
    const prim = { value: 0, velocity: 10 }; // 10 px/ms
    const next = advanceLinearInertia(prim, 16);
    expect(next.velocity).toBeLessThan(10);
    expect(next.value).toBeGreaterThan(0);
  });

  it('velocity decays to near zero over many frames', () => {
    let prim = { value: 0, velocity: 10 };
    for (let i = 0; i < 500; i++) {
      prim = advanceLinearInertia(prim, 16);
    }
    expect(Math.abs(prim.velocity)).toBeLessThan(0.001);
  });
});

describe('advanceLinearSpring', () => {
  it('moves value toward target', () => {
    const prim = { value: 0, velocity: 0 };
    const next = advanceLinearSpring(prim, 100, 16);
    expect(next.value).toBeGreaterThan(0);
    expect(next.value).toBeLessThan(100);
  });

  it('converges to target over many frames', () => {
    let prim = { value: 0, velocity: 0 };
    for (let i = 0; i < 200; i++) {
      prim = advanceLinearSpring(prim, 100, 16);
    }
    expect(prim.value).toBeCloseTo(100, 1);
  });

  it('returns target immediately when already at target', () => {
    const prim = { value: 100, velocity: 0 };
    const next = advanceLinearSpring(prim, 100, 16);
    expect(next.value).toBeCloseTo(100);
    expect(next.velocity).toBeCloseTo(0);
  });
});

describe('ExponentialPrimitive', () => {
  it('applies multiplicative factor', () => {
    const prim = createExponentialPrimitive(1);
    const next = applyExponentialFactor(prim, 2, 16);
    expect(next.value).toBeCloseTo(2);
  });

  it('logVelocity decays to near zero over many frames', () => {
    let prim = applyExponentialFactor(createExponentialPrimitive(1), 1.5, 16);
    for (let i = 0; i < 500; i++) {
      prim = advanceExponentialInertia(prim, 16);
    }
    expect(Math.abs(prim.logVelocity)).toBeLessThan(0.00001);
  });
});
