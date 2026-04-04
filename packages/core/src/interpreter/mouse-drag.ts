import type { Interpreter, MountedInterpreter, Callback, Motion, UnsubscribeFn } from '../types.js';

type MouseDragState =
  | { type: 'idle' }
  | { type: 'dragging'; prevX: number; prevY: number };

type MouseDragAction =
  | { type: 'mousedown'; x: number; y: number }
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'mouseup' };

type ReducerResult = { state: MouseDragState; motion?: Motion };

function reduce(state: MouseDragState, action: MouseDragAction): ReducerResult {
  switch (state.type) {
    case 'idle':
      switch (action.type) {
        case 'mousedown':
          return { state: { type: 'dragging', prevX: action.x, prevY: action.y } };
        case 'mousemove':
        case 'mouseup':
          return { state };
      }

    case 'dragging':
      switch (action.type) {
        case 'mousedown':
          return { state: { type: 'dragging', prevX: action.x, prevY: action.y } };
        case 'mousemove':
          return {
            state: { type: 'dragging', prevX: action.x, prevY: action.y },
            motion: {
              dx: action.x - state.prevX,
              dy: action.y - state.prevY,
              dScale: 1,
              originX: 0,
              originY: 0,
            },
          };
        case 'mouseup':
          return { state: { type: 'idle' } };
      }
  }
}

export function mouseDragInterpreter(): Interpreter {
  return (element: Element): MountedInterpreter => {
    const callbacks = new Set<Callback<Motion>>();
    let state: MouseDragState = { type: 'idle' };

    function dispatch(action: MouseDragAction) {
      const result = reduce(state, action);
      state = result.state;
      if (result.motion) {
        for (const cb of callbacks) cb(result.motion);
      }
    }

    function onMouseDown(e: MouseEvent) {
      dispatch({ type: 'mousedown', x: e.clientX, y: e.clientY });
    }

    function onMouseMove(e: MouseEvent) {
      dispatch({ type: 'mousemove', x: e.clientX, y: e.clientY });
    }

    function onMouseUp() {
      dispatch({ type: 'mouseup' });
    }

    element.addEventListener('mousedown', onMouseDown as EventListener);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return {
      subscribe(cb: Callback<Motion>): UnsubscribeFn {
        callbacks.add(cb);
        return () => callbacks.delete(cb);
      },
      unmount() {
        element.removeEventListener('mousedown', onMouseDown as EventListener);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        callbacks.clear();
      },
    };
  };
}
