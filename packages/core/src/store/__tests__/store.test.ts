import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore } from '../index.js';
import type { MountedInterpreter, Callback, Motion } from '../../types.js';

function makeMockInterpreter(): MountedInterpreter & { emit: (m: Motion) => void } {
  const callbacks = new Set<Callback<Motion>>();
  return {
    emit(m: Motion) {
      for (const cb of callbacks) cb(m);
    },
    subscribe(cb: Callback<Motion>) {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    unmount: vi.fn(),
  };
}

describe('createStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('notifies subscribers on next rAF after motion', async () => {
    const interp = makeMockInterpreter();
    const store = createStore()([interp]);
    const states: unknown[] = [];
    store.subscribe((s) => states.push(s));

    interp.emit({ dx: 50, dy: 30, dScale: 1, originX: 0, originY: 0 });

    // Advance one animation frame (16ms)
    await vi.advanceTimersByTimeAsync(16);

    expect(states.length).toBeGreaterThan(0);
    const last = states[states.length - 1] as { transformX: number; transformY: number };
    expect(last.transformX).toBeCloseTo(50);
    expect(last.transformY).toBeCloseTo(30);

    store.unmount();
  });

  it('adjusts translation for scale origin', async () => {
    const interp = makeMockInterpreter();
    const store = createStore()([interp]);
    const states: unknown[] = [];
    store.subscribe((s) => states.push(s));

    // Zoom in 2x at origin (100, 100) with current transform at (0, 0)
    // newTx = 100 + (0 - 100) * 2 + 0 = 100 - 200 = -100
    // newTy = 100 + (0 - 100) * 2 + 0 = -100
    interp.emit({ dx: 0, dy: 0, dScale: 2, originX: 100, originY: 100 });

    await vi.advanceTimersByTimeAsync(16);

    const last = states[states.length - 1] as {
      transformX: number;
      transformY: number;
      scale: number;
    };
    expect(last.scale).toBeCloseTo(2);
    expect(last.transformX).toBeCloseTo(-100);
    expect(last.transformY).toBeCloseTo(-100);

    store.unmount();
  });

  it('stops notifying after unmount', async () => {
    const interp = makeMockInterpreter();
    const store = createStore()([interp]);
    const states: unknown[] = [];
    store.subscribe((s) => states.push(s));

    store.unmount();
    interp.emit({ dx: 50, dy: 0, dScale: 1, originX: 0, originY: 0 });
    await vi.advanceTimersByTimeAsync(16);

    expect(states).toHaveLength(0);
  });
});
