import { describe, it, expect, vi } from 'vitest';
import { createRenderer } from '../index.js';
import type { MountedStore, Callback, State } from '../../types.js';

function makeMockStore(): MountedStore & { emit: (s: State) => void } {
  const callbacks = new Set<Callback<State>>();
  return {
    emit(s: State) {
      for (const cb of callbacks) cb(s);
    },
    subscribe(cb: Callback<State>) {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    unmount: vi.fn(),
  };
}

describe('createRenderer', () => {
  it('applies CSS transform on state update', () => {
    const element = document.createElement('div');
    const store = makeMockStore();
    const renderer = createRenderer()(element, store);

    store.emit({ transformX: 10, transformY: 20, scale: 1.5 });

    expect(element.style.transform).toBe('translate(10px, 20px) scale(1.5)');
    expect(element.style.transformOrigin).toBe('0 0');

    renderer.unmount();
  });

  it('unsubscribes from store on unmount', () => {
    const element = document.createElement('div');
    const store = makeMockStore();
    const renderer = createRenderer()(element, store);
    renderer.unmount();

    store.emit({ transformX: 99, transformY: 99, scale: 2 });

    // Transform should not have been updated after unmount
    expect(element.style.transform).toBe('');
  });
});
