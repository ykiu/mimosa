import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "../index.js";
import type {
  MountedInterpreter,
  Callback,
  InterpreterEvent,
  StoreAction,
} from "../../types.js";

function makeMockInterpreter(): MountedInterpreter & {
  emit: (event: InterpreterEvent) => void;
} {
  const callbacks = new Set<Callback<InterpreterEvent>>();
  return {
    emit(event: InterpreterEvent) {
      for (const cb of callbacks) cb(event);
    },
    subscribe(cb: Callback<InterpreterEvent>) {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    unmount: vi.fn(),
  };
}

// Simple counter state for testing the store in isolation from the model
type CounterState = { motionCount: number };

function counterReduce(
  state: CounterState | undefined = { motionCount: 0 },
  action: StoreAction,
): CounterState {
  if (action.type === "motion") return { motionCount: state.motionCount + 1 };
  return state;
}

// Manual rAF control — lets tests trigger animation frames deterministically
// without depending on fake timer implementation details.
let rafQueue: FrameRequestCallback[] = [];

function flushRaf(timestamp = 16) {
  const pending = rafQueue.splice(0);
  for (const cb of pending) cb(timestamp);
}

beforeEach(() => {
  rafQueue = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createStore", () => {
  it("calls reducer with undefined state on initialization", () => {
    const interp = makeMockInterpreter();
    const firstArgs: Array<CounterState | undefined> = [];
    function spyReduce(
      state: CounterState | undefined,
      action: StoreAction,
    ): CounterState {
      firstArgs.push(state);
      return counterReduce(state, action);
    }
    createStore(spyReduce, (s) => s)([interp]);
    expect(firstArgs[0]).toBeUndefined();
  });

  it("notifies subscribers on each animation frame", () => {
    const interp = makeMockInterpreter();
    const store = createStore(counterReduce, (s) => s)([interp]);
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    flushRaf();
    expect(snapshots.length).toBe(1);

    flushRaf();
    expect(snapshots.length).toBe(2);

    store.unmount();
  });

  it("forwards interpreter events to the reducer before the next frame", () => {
    const interp = makeMockInterpreter();
    const store = createStore(counterReduce, (s) => s)([interp]);
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    interp.emit({ type: "motion", timestamp: 0, dx: 50, dy: 30, dScale: 1, originX: 0, originY: 0 });
    interp.emit({ type: "motion", timestamp: 8, dx: 10, dy: 0, dScale: 1, originX: 0, originY: 0 });

    flushRaf();

    expect(snapshots[0].motionCount).toBe(2);

    store.unmount();
  });

  it("applies toPublicState before notifying subscribers", () => {
    const interp = makeMockInterpreter();
    const store = createStore(
      counterReduce,
      (state) => ({ doubled: state.motionCount * 2 }),
    )([interp]);

    const snapshots: { doubled: number }[] = [];
    store.subscribe((s) => snapshots.push(s));

    interp.emit({ type: "motion", timestamp: 0, dx: 10, dy: 0, dScale: 1, originX: 0, originY: 0 });
    flushRaf();

    expect(snapshots[0].doubled).toBe(2);

    store.unmount();
  });

  it("stops notifying after unmount", () => {
    const interp = makeMockInterpreter();
    const store = createStore(counterReduce, (s) => s)([interp]);
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    store.unmount();
    interp.emit({ type: "motion", timestamp: 0, dx: 50, dy: 0, dScale: 1, originX: 0, originY: 0 });
    flushRaf();

    expect(snapshots).toHaveLength(0);
  });
});
