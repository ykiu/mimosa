import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "../index.js";
import type {
  MountedInterpreter,
  Callback,
  InterpreterEvent,
  StoreAction,
  Model,
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

function counterModel<TPublicState>(
  publish: (s: CounterState) => TPublicState,
): Model<TPublicState, CounterState> {
  return { reduce: counterReduce, publish };
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
    createStore({ reduce: spyReduce, publish: (s) => s })([interp]);
    expect(firstArgs[0]).toBeUndefined();
  });

  it("notifies subscribers on the first frame with the initial state", () => {
    const interp = makeMockInterpreter();
    const store = createStore(counterModel((s) => s))([interp]);
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    flushRaf();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].motionCount).toBe(0);

    store.unmount();
  });

  it("pauses the loop when state reference is unchanged after a tick", () => {
    const interp = makeMockInterpreter();
    const store = createStore(counterModel((s) => s))([interp]);
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    flushRaf(); // initial state emitted, then loop pauses (tick returns same ref)
    expect(snapshots.length).toBe(1);

    flushRaf(); // loop is paused, no new frame scheduled
    expect(snapshots.length).toBe(1);

    store.unmount();
  });

  it("resumes the loop when an interpreter event changes state", () => {
    const interp = makeMockInterpreter();
    const store = createStore(counterModel((s) => s))([interp]);
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    flushRaf(); // initial state, then pauses
    expect(snapshots.length).toBe(1);

    interp.emit({
      type: "motion",
      timestamp: 0,
      dx: 10,
      dy: 0,
      dScale: 1,
      originX: 0,
      originY: 0,
    });
    flushRaf(); // loop resumed, new state emitted
    expect(snapshots.length).toBe(2);
    expect(snapshots[1].motionCount).toBe(1);

    flushRaf(); // state unchanged again, loop pauses
    expect(snapshots.length).toBe(2);

    store.unmount();
  });

  it("forwards interpreter events to the reducer before the next frame", () => {
    const interp = makeMockInterpreter();
    const store = createStore(counterModel((s) => s))([interp]);
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    interp.emit({
      type: "motion",
      timestamp: 0,
      dx: 50,
      dy: 30,
      dScale: 1,
      originX: 0,
      originY: 0,
    });
    interp.emit({
      type: "motion",
      timestamp: 8,
      dx: 10,
      dy: 0,
      dScale: 1,
      originX: 0,
      originY: 0,
    });

    flushRaf();

    expect(snapshots[0].motionCount).toBe(2);

    store.unmount();
  });

  it("applies publish before notifying subscribers", () => {
    const interp = makeMockInterpreter();
    const store = createStore(
      counterModel((state) => ({ doubled: state.motionCount * 2 })),
    )([interp]);

    const snapshots: { doubled: number }[] = [];
    store.subscribe((s) => snapshots.push(s));

    interp.emit({
      type: "motion",
      timestamp: 0,
      dx: 10,
      dy: 0,
      dScale: 1,
      originX: 0,
      originY: 0,
    });
    flushRaf();

    expect(snapshots[0].doubled).toBe(2);

    store.unmount();
  });

  it("stops notifying after unmount", () => {
    const interp = makeMockInterpreter();
    const store = createStore(counterModel((s) => s))([interp]);
    const snapshots: CounterState[] = [];
    store.subscribe((s) => snapshots.push(s));

    store.unmount();
    interp.emit({
      type: "motion",
      timestamp: 0,
      dx: 50,
      dy: 0,
      dScale: 1,
      originX: 0,
      originY: 0,
    });
    flushRaf();

    expect(snapshots).toHaveLength(0);
  });
});
