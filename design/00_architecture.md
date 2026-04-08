# Architecture of the Web Pinch/Pan Library

## Conventions

All transformations in this library are expressed as a combination of transformX, transformY, and scale. The transform-origin for scale is set to the top-left corner of the target element. To make it appear as though scaling is centered on the pinch gesture's midpoint, the library computes appropriate transformX and transformY values based on the pinch origin (the actual scale transform is always applied relative to the top-left corner).

State transition logic in this library is written as reducers.

## Common Type Definitions

```typescript
type UnsubscribeFn = () => void;
type UnmountFn = () => void;
type Callback<T> = (value: T) => void;
```

**Motion** is the motion payload used internally by the Store. It represents the relative change from the previous state. For pan gestures, use `dScale: 1` and `originX/Y: 0`.

```typescript
type Motion = {
  dx: number;      // horizontal translation delta (px)
  dy: number;      // vertical translation delta (px)
  dScale: number;  // multiplicative scale factor (1.0 = no change, 1.1 = 10% zoom in)
  originX: number; // scale origin X, relative to the element's top-left corner (px)
  originY: number; // scale origin Y, relative to the element's top-left corner (px)
};
```

**InterpreterEvent** is the output of an Interpreter. It is a tagged union that covers both gesture movement and the moment the user releases the gesture.

```typescript
type InterpreterEvent =
  | ({ type: 'motion'; timestamp: number } & Motion) // user is actively gesturing
  | { type: 'release' };                             // user lifted all fingers / released the mouse button
```

The `timestamp` on motion events is taken from the originating DOM event (`e.timeStamp`) and is used by the Store to compute accurate time deltas for velocity tracking.

**State** is the output of the Store and represents the current transform applied to the target element. Velocity information is kept as internal Store state and is not exposed.

```typescript
type State = {
  transformX: number; // horizontal translation (px)
  transformY: number; // vertical translation (px)
  scale: number;      // scale factor (1.0 = original size)
};
```

## Module Composition

The library consists of four primary modules:

1. **Interpreter**: Responsible for detecting and processing gestures. Captures user input and identifies gestures such as pinch and pan.
2. **Model**: Contains the state transition logic (reducer) for transformations. Describes how the transform state evolves in response to gestures and animation ticks.
3. **Store**: A generic event loop that wires together Interpreters and a reducer. Drives the animation loop and notifies subscribers on each frame.
4. **Renderer**: Responsible for rendering the target element. Reads from the Store and applies transformations to the actual DOM element.

## Interpreter Module

The role of this module is to abstract user input events such as TouchEvent and MouseEvent, and interpret them as meaningful actions such as zoom or pan. The module provides a state machine that takes these events as input.

The Interpreter emits detected gesture information as **InterpreterEvent**. Motion events express transformations as relative changes from the previous state. A release event is emitted when the user lifts all fingers or releases the mouse button. Events are delivered to the outside world via a callback provided to the Interpreter.

Key interfaces and functions:

```typescript
type Interpreter = (element: Element) => MountedInterpreter;
type MountedInterpreter = {
  subscribe: (cb: Callback<InterpreterEvent>) => UnsubscribeFn;
  unmount: UnmountFn;
};

declare function touchInterpreter(): Interpreter;
declare function mouseDragInterpreter(): Interpreter;
declare function mouseWheelInterpreter(): Interpreter;
```

Implementation details:

- When called, an Interpreter begins listening to the target element's events via addEventListener. Listening stops when UnmountFn is called.
- **touchInterpreter**: A factory function for an interpreter that handles touch events. Tracks multiple touch points and identifies gestures such as pinch and pan.
- **mouseDragInterpreter**: A factory function for an interpreter that handles mouse drag events. Tracks mouse movement and identifies pan gestures.
- **mouseWheelInterpreter**: A factory function for an interpreter that handles mouse wheel events. Tracks wheel rotation and identifies zoom gestures.

### State Representation and Reducer Pattern

Each stateful interpreter models its internal state as a tagged union, where each variant represents a distinct and valid configuration:

- `touchInterpreter`: `no_touch | single_touch | multi_touch`
- `mouseDragInterpreter`: `idle | dragging`

With tagged unions, impossible states become inexpressible. For example, a `single_touch` state necessarily carries exactly one touch point, and a `multi_touch` state necessarily carries exactly two — the type system enforces these invariants with no runtime checks required. Additionally, the set of valid state transitions becomes self-documenting: `touchInterpreter` can transition `no_touch → single_touch` and `single_touch → multi_touch`, but not `no_touch → multi_touch` directly. A `touchmove` event received while in `no_touch` state cannot reach the code path that computes a pan motion, because that path pattern-matches on `single_touch`.

State transitions are implemented as a pure reducer:

```
reduce(state, action) => { state, event? }
```

where each `action` corresponds to a DOM event. Separating pure transition logic from side effects (event subscription, InterpreterEvent emission) yields two practical benefits:

1. **Testability**: The reducer can be tested as a plain function with no DOM setup — pass a state and an action, assert on the returned state and event.
2. **Traceability**: Every state change originates from a named action, making the flow of data easy to follow and debug.

Side effects are confined to the thin `dispatch()` wrapper inside each interpreter factory, which calls `reduce`, updates the stored state, and emits the InterpreterEvent if one was returned.

## Model Module

The Model module contains the pure state transition logic for transformations. It defines a reducer that describes how the transform state changes in response to gestures and animation ticks. Separating this logic from the Store makes it independently testable and replaceable.

```typescript
declare function createReduce(snap?: SnapConfig): Reducer<TransformPrivateState>;
declare function toPublicState(state: TransformPrivateState): State;
```

Implementation details:

- `TransformPrivateState` is a tagged union with `type` as the discriminant. The four variants are: `tracking`, `inertia`, `snapping`, and `settled`.
- `StoreAction` is either an `InterpreterEvent` (emitted by Interpreters) or `{ type: 'tick'; timestamp: number }` (emitted each animation frame).
- The reducer delegates tracking of the rate of change for transform and scale to sub-reducers called ValuePrimitives. There are two ValuePrimitive types: `LinearPrimitive` for translation and `ExponentialPrimitive` for scale. Both carry a `lastUpdatedAt: number` field (NaN when never updated). All primitive update functions accept a `timestamp` and compute `dtMs` internally. LinearPrimitive treats translation linearly; ExponentialPrimitive treats scale exponentially for a more natural pinch-to-zoom feel.
- Velocity information is held inside the ValuePrimitives as internal state and is not included in the public `State`.
- The Model supports an optional snap configuration (`SnapConfig`) that controls snapping behaviour. When configured, the Model transitions through the following internal phases: **tracking** (motions being applied) → **snapping** (exponential spring animation toward the nearest snap point) → **settled**. When a `release` event is received in the `tracking` or `inertia` state, the Model transitions to `snapping` immediately. If no `release` event is received (e.g. from mouse wheel gestures that have no explicit release), inertia runs as normal and snapping begins once velocity decays below threshold. Any new motion received while snapping resets the phase back to `tracking`.

```typescript
type SnapConfig = {
  x?: (value: number) => number; // returns the nearest snap target for the given x
  y?: (value: number) => number; // returns the nearest snap target for the given y
};
```

## Store Module

The Store module is a generic animation loop. It subscribes to Interpreter events, applies them to a reducer, and emits the resulting public state to subscribers on every animation frame.

The Store has a continuous update loop driven by `requestAnimationFrame()`. Motion events received from Interpreters are applied to the reducer. The tick action is dispatched on each frame to advance inertia or spring animations.

The Store's update loop emits state to subscribers on every frame where the state changes. The loop pauses automatically when the reducer returns the same object reference as the previous state (indicating the state has settled), and resumes when an Interpreter emits a new event. This pause/resume behavior is an implementation detail of the Store — other modules must not depend on it.

To support this optimization, Reducers must follow a **reference equality contract**: when an action causes no state change, return the same object reference rather than a new object with identical values.

```typescript
type Store<TState> = (interpreters: MountedInterpreter[]) => MountedStore<TState>;
type MountedStore<TState> = {
  subscribe: (cb: Callback<TState>) => UnsubscribeFn;
  unmount: UnmountFn;
};

declare function createStore<TPrivateState, TState>(
  reduce: Reducer<TPrivateState>,
  toPublicState: (state: TPrivateState) => TState,
): Store<TState>;
```

Mounting the `MountedInterpreter[]` passed to the Store (i.e., calling the Interpreters) is the responsibility of the caller.

To create a transform store with the default Model:

```typescript
const store = createStore(createReduce(snapConfig), toPublicState);
```

## Renderer Module

The Renderer module receives transform information from the Store and applies it to the actual DOM element. This includes logic for scaling and translating the element using CSS transforms.

The Renderer subscribes to the Store and updates the target element's CSS transform whenever State changes. The Renderer holds no internal state and is responsible only for side effects (DOM updates).

```typescript
type Renderer = (element: Element, store: MountedStore) => MountedRenderer;
type MountedRenderer = {
  unmount: UnmountFn;
};

declare function createRenderer(): Renderer;
```

## Module Dependencies

- The Renderer depends on the Store. The Renderer subscribes to the Store's state and applies transformations to the target element.
- The Store depends on the Interpreter and the Model (via the reducer passed to it). The Store wires them together into an animation loop.
- The Model does not depend on the Store, Interpreter, or Renderer. It is a pure function from state and action to state.
- The Interpreter does not depend on the Store, Model, or Renderer. The Interpreter focuses solely on processing user input and generating Motion.

## Testing Policy

Each module should be tested individually through unit tests. The Interpreter module requires tests to verify that correct InterpreterEvents are emitted from user input, including both motion events and release events. The Model module requires tests to verify that the reducer produces correct state transitions for every combination of state and action. The Store module requires tests to verify the animation loop mechanics: that interpreter events are forwarded to the reducer, that subscribers receive the output of `toPublicState` on each frame, and that the loop stops after unmount. The Renderer module requires tests to verify that correct CSS transforms are applied based on the Store's state.
