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

**Motion** is the output of an Interpreter and represents the relative change from the previous state. For pan gestures, use `dScale: 1` and `originX/Y: 0`.

```typescript
type Motion = {
  dx: number;      // horizontal translation delta (px)
  dy: number;      // vertical translation delta (px)
  dScale: number;  // multiplicative scale factor (1.0 = no change, 1.1 = 10% zoom in)
  originX: number; // scale origin X, relative to the element's top-left corner (px)
  originY: number; // scale origin Y, relative to the element's top-left corner (px)
};
```

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

The Interpreter emits detected gesture information as **Motion**. Motion expresses transformations as relative changes from the previous state. Specific state transitions in the state machine trigger Motion generation. Motion is delivered to the outside world via a callback provided to the Interpreter.

Key interfaces and functions:

```typescript
type Interpreter = (element: Element) => MountedInterpreter;
type MountedInterpreter = {
  subscribe: (cb: Callback<Motion>) => UnsubscribeFn;
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

## Store Module

The Store module takes Motion from the Interpreter as input and manages the state of transformations applied to the target element. The Store holds the transform that should be applied to the target element. It also tracks the rate of change computed from the delta between the current and previous states, for use in inertia simulation. For example, if the transform is 40 px at one moment and 50 px 16 ms later, the rate of change is computed as 10 px / 16 ms.

The Store has a continuous update loop driven by requestAnimationFrame(). It queues Motion received between loop iterations and processes them on the next iteration. If no Motion has been received since the last loop, the Store updates the transform for inertia simulation by exponentially decaying the rate of change.

The Store's update loop runs continuously and does not stop under normal circumstances. As an optimization, pausing the loop when there are no significant changes is permitted, but this must be treated as an implementation detail of the Store module — other modules must not depend on this behavior.

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

- State transitions in the Store are written as reducers. The root reducer delegates tracking of the rate of change for transform and scale to sub-reducers called ValuePrimitives. There are two ValuePrimitive types: LinearPrimitive for translation and ExponentialPrimitive for scale. LinearPrimitive treats translation linearly, because the relationship between user input (e.g., drag distance) and translation is linear. ExponentialPrimitive treats scale exponentially, because scale is multiplicative in nature and an exponential representation provides a more natural feel during zoom in/out.
- Velocity information (velocityX, velocityY, scaleVelocity) is held as internal Store state and is not included in State.

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

Each module should be tested individually through unit tests. The Interpreter module requires tests to verify that correct Motion is generated from user input. The Store module requires tests to verify that correct state updates occur when Motion is received. The Renderer module requires tests to verify that correct CSS transforms are applied based on the Store's state.
