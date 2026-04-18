import type {
  Store,
  MountedStore,
  MountedInterpreter,
  Callback,
  UnsubscribeFn,
  Model,
} from "../types.js";

export function createStore<TPrivateState, TState>(
  model: Model<TState, TPrivateState>,
): Store<TState> {
  return (interpreters: MountedInterpreter[]): MountedStore<TState> => {
    const callbacks = new Set<Callback<TState>>();

    let state = model.reduce(undefined, { type: "tick", timestamp: 0 });
    let lastEmittedState: TPrivateState | undefined;

    let rafId: number | null = null;
    let mounted = true;

    function loop(timestamp: number) {
      if (!mounted) return;
      state = model.reduce(state, { type: "tick", timestamp });
      if (state === lastEmittedState) {
        rafId = null;
        return;
      }
      lastEmittedState = state;
      const publicState = model.publish(state);
      for (const cb of callbacks) cb(publicState);
      rafId = requestAnimationFrame(loop);
    }

    function resumeLoop() {
      if (rafId === null && mounted) {
        rafId = requestAnimationFrame(loop);
      }
    }

    // Subscribe to all interpreters
    const unsubscribers = interpreters.map((interp) =>
      interp.subscribe((event) => {
        state = model.reduce(state, event);
        resumeLoop();
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
