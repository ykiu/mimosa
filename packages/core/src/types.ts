export type UnsubscribeFn = () => void;
export type UnmountFn = () => void;
export type Callback<T> = (value: T) => void;

export type InterpreterEvent =
  | {
      type: "motion";
      /** Identifies the item being interacted with. Absent for container-level gestures. */
      itemId?: string;
      dx: number;
      dy: number;
      dScale: number;
      originX: number;
      originY: number;
      timestamp: number;
    }
  | {
      type: "release";
      /** Identifies the item being released. Absent for container-level gestures. */
      itemId?: string;
    };

// TODO: Move to a new module
export type State = {
  transformX: number;
  transformY: number;
  scale: number;
};

export type MountedInterpreter = {
  subscribe: (cb: Callback<InterpreterEvent>) => UnsubscribeFn;
  unmount: UnmountFn;
};

export type Interpreter = (element: Element) => MountedInterpreter;

export type MountedStore<TState> = {
  subscribe: (cb: Callback<TState>) => UnsubscribeFn;
  unmount: UnmountFn;
};

export type Store<TState> = (
  interpreters: MountedInterpreter[],
) => MountedStore<TState>;

export type StoreAction =
  | InterpreterEvent
  | { type: "tick"; timestamp: number };

/**
 * A pure function that computes the next private state from the current state and an action.
 *
 * **Reference equality contract**: when the state is unchanged, return the same object reference.
 * The Store uses reference equality (`===`) to detect when the state has settled and pauses the
 * animation loop accordingly. Returning a new object with identical values defeats this optimization.
 */
export type Reducer<TPrivateState> = (
  state: TPrivateState | undefined,
  action: StoreAction,
) => TPrivateState;

export type MountedRenderer = {
  unmount: UnmountFn;
};

export type Renderer<TState> = (
  element: Element,
  store: MountedStore<TState>,
) => MountedRenderer;

export type SnapConfig = {
  x?: (value: number) => number;
  y?: (value: number) => number;
};
