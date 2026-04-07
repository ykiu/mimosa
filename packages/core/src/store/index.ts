import type {
  Store,
  MountedStore,
  MountedInterpreter,
  Callback,
  UnsubscribeFn,
  Reducer,
} from "../types.js";

export function createStore<TState, TPrivateState>(
  reduce: Reducer<TPrivateState>,
  toPublicState: (privateState: TPrivateState) => TState,
): Store<TState> {
  return (interpreters: MountedInterpreter[]): MountedStore<TState> => {
    const callbacks = new Set<Callback<TState>>();

    let state = reduce(undefined, { type: "tick", timestamp: 0 });

    let rafId: number | null = null;
    let mounted = true;

    function loop(timestamp: number) {
      if (!mounted) return;
      state = reduce(state, { type: "tick", timestamp });
      const publicState = toPublicState(state);
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
      subscribe(cb: Callback<TState>): UnsubscribeFn {
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
