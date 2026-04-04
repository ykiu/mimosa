export type UnsubscribeFn = () => void;
export type UnmountFn = () => void;
export type Callback<T> = (value: T) => void;

export type Motion = {
  dx: number;
  dy: number;
  dScale: number;
  originX: number;
  originY: number;
};

export type InterpreterEvent = ({ type: 'motion' } & Motion) | { type: 'release' };

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

export type MountedStore = {
  subscribe: (cb: Callback<State>) => UnsubscribeFn;
  unmount: UnmountFn;
};

export type Store = (interpreters: MountedInterpreter[]) => MountedStore;

export type MountedRenderer = {
  unmount: UnmountFn;
};

export type Renderer = (element: Element, store: MountedStore) => MountedRenderer;

export type SnapConfig = {
  x?: (value: number) => number;
  y?: (value: number) => number;
};
