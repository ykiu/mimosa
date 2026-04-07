export type UnsubscribeFn = () => void;
export type UnmountFn = () => void;
export type Callback<T> = (value: T) => void;

export type InterpreterEvent =
  | {
      type: "motion";
      dx: number;
      dy: number;
      dScale: number;
      originX: number;
      originY: number;
      timestamp: number;
    }
  | { type: "release" };

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
