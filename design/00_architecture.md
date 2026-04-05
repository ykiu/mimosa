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

The library consists of three primary modules:

1. **Interpreter**: Responsible for detecting and processing gestures. Captures user input and identifies gestures such as pinch and pan.
2. **Store**: Manages the state of transformations (scale, translation, etc.) applied to the target element.
3. **Renderer**: Responsible for rendering the target element. Reads from the Store and applies transformations to the actual DOM element.

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

## Store Module

The Store module takes Motion from the Interpreter as input and manages the state of transformations applied to the target element. The Store holds the transform that should be applied to the target element. It also tracks the rate of change computed from the delta between the current and previous states, for use in inertia simulation. For example, if the transform is 40 px at one moment and 50 px 16 ms later, the rate of change is computed as 10 px / 16 ms.

The Store has a continuous update loop driven by requestAnimationFrame(). Motion events received from Interpreters are applied to the Store's state. The tick action advances inertia or spring animation when no motion is active.

The Store's update loop runs continuously and emits state to subscribers on every frame. As an optimization, pausing the loop when there are no significant changes is permitted, but this must be treated as an implementation detail of the Store module — other modules must not depend on this behavior.

The Store notifies state changes via callbacks.

```typescript
type Store = (interpreters: MountedInterpreter[]) => MountedStore;
type MountedStore = {
  subscribe: (cb: Callback<State>) => UnsubscribeFn;
  unmount: UnmountFn;
};

declare function createStore(): Store;
```

Mounting the `MountedInterpreter[]` passed to the Store (i.e., calling the Interpreters) is the responsibility of the caller.

Implementation details:

- `StoreState` is a tagged union with `type` as the discriminant. The four variants are: `tracking`, `inertia`, `snapping`, and `settled`.
- State transitions in the Store are written as a reducer created by `createReduce(snap?)`. This higher-order function captures the optional snap configuration and returns a `(state, action) => state` reducer. `StoreAction` is either an `InterpreterEvent` (emitted by Interpreters) or `{ type: 'tick'; timestamp: number }` (emitted each animation frame).
- The root reducer delegates tracking of the rate of change for transform and scale to sub-reducers called ValuePrimitives. There are two ValuePrimitive types: `LinearPrimitive` for translation and `ExponentialPrimitive` for scale. Both carry a `lastUpdatedAt: number` field (NaN when never updated). All primitive update functions accept a `timestamp` and compute `dtMs` internally. LinearPrimitive treats translation linearly; ExponentialPrimitive treats scale exponentially for a more natural pinch-to-zoom feel.
- Velocity information is held inside the ValuePrimitives as internal Store state and is not included in the public `State`.
- The Store supports an optional snap configuration (`SnapConfig`) that controls snapping behaviour. When configured, the Store transitions through the following internal phases: **tracking** (motions being applied) → **snapping** (exponential spring animation toward the nearest snap point) → **settled**. When a `release` event is received in the `tracking` or `inertia` state, the Store transitions to `snapping` immediately. If no `release` event is received (e.g. from mouse wheel gestures that have no explicit release), inertia runs as normal and snapping begins once velocity decays below threshold. Any new motion received while snapping resets the phase back to `tracking`.

```typescript
type SnapConfig = {
  x?: (value: number) => number; // returns the nearest snap target for the given x
  y?: (value: number) => number; // returns the nearest snap target for the given y
};

createStore({ snap?: SnapConfig }): Store
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
- The Store depends on the Interpreter. The Store takes Motion from the Interpreter as input and updates its state.
- The Interpreter does not depend on the Store or Renderer. The Interpreter focuses solely on processing user input and generating Motion.

## Testing Policy

Each module should be tested individually through unit tests. The Interpreter module requires tests to verify that correct InterpreterEvents are emitted from user input, including both motion events and release events. The Store module requires tests to verify that correct state updates occur when events are received, including immediate snapping on release. The Renderer module requires tests to verify that correct CSS transforms are applied based on the Store's state.
