import type {
  Interpreter,
  MountedInterpreter,
  Callback,
  InterpreterEvent,
  UnsubscribeFn,
} from "../types.js";

type TouchPoint = { x: number; y: number };

type TouchState =
  | { type: "no_touch" }
  | { type: "single_touch"; point: TouchPoint }
  | { type: "multi_touch"; points: [TouchPoint, TouchPoint] };

type TouchAction =
  | { type: "touchstart"; points: TouchPoint[] }
  | {
      type: "touchmove";
      points: TouchPoint[];
      elementRect: DOMRect;
      timestamp: number;
    }
  | { type: "touchend"; points: TouchPoint[] }
  | { type: "touchcancel"; points: TouchPoint[] };

type ReducerResult = { state: TouchState; event?: InterpreterEvent };

function getDistance(a: TouchPoint, b: TouchPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getMidpoint(a: TouchPoint, b: TouchPoint): TouchPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function toPoint(touch: Touch): TouchPoint {
  return { x: touch.clientX, y: touch.clientY };
}

function stateFromPoints(points: TouchPoint[]): TouchState {
  if (points.length === 0) return { type: "no_touch" };
  if (points.length === 1) return { type: "single_touch", point: points[0] };
  return { type: "multi_touch", points: [points[0], points[1]] };
}

function reduce(state: TouchState, action: TouchAction): ReducerResult {
  switch (state.type) {
    case "no_touch":
      switch (action.type) {
        case "touchstart":
        case "touchend":
        case "touchcancel":
        case "touchmove":
          return { state: stateFromPoints(action.points) };
      }
      throw new Error("unreachable");

    case "single_touch":
      switch (action.type) {
        case "touchstart":
          return { state: stateFromPoints(action.points) };
        case "touchend":
        case "touchcancel": {
          const newState = stateFromPoints(action.points);
          return {
            state: newState,
            event:
              newState.type === "no_touch" ? { type: "release" } : undefined,
          };
        }
        case "touchmove": {
          if (action.points.length !== 1) {
            return { state: stateFromPoints(action.points) };
          }
          const curr = action.points[0];
          return {
            state: { type: "single_touch", point: curr },
            event: {
              type: "motion",
              timestamp: action.timestamp,
              dx: curr.x - state.point.x,
              dy: curr.y - state.point.y,
              dScale: 1,
              originX: 0,
              originY: 0,
            },
          };
        }
      }
      throw new Error("unreachable");

    case "multi_touch":
      switch (action.type) {
        case "touchstart":
          return { state: stateFromPoints(action.points) };
        case "touchend":
        case "touchcancel": {
          const newState = stateFromPoints(action.points);
          return {
            state: newState,
            event:
              newState.type === "no_touch" ? { type: "release" } : undefined,
          };
        }
        case "touchmove": {
          if (action.points.length < 2) {
            return { state: stateFromPoints(action.points) };
          }
          const [curr0, curr1] = action.points;
          const [prev0, prev1] = state.points;
          const currMid = getMidpoint(curr0, curr1);
          const prevMid = getMidpoint(prev0, prev1);
          const currDist = getDistance(curr0, curr1);
          const prevDist = getDistance(prev0, prev1);
          const dScale = prevDist === 0 ? 1 : currDist / prevDist;
          return {
            state: { type: "multi_touch", points: [curr0, curr1] },
            event: {
              type: "motion",
              timestamp: action.timestamp,
              dx: currMid.x - prevMid.x,
              dy: currMid.y - prevMid.y,
              dScale,
              originX: currMid.x - action.elementRect.left,
              originY: currMid.y - action.elementRect.top,
            },
          };
        }
      }
  }
}

export function touchInterpreter(): Interpreter {
  return (element: Element): MountedInterpreter => {
    const callbacks = new Set<Callback<InterpreterEvent>>();
    let state: TouchState = { type: "no_touch" };

    function dispatch(action: TouchAction) {
      const result = reduce(state, action);
      state = result.state;
      if (result.event) {
        for (const cb of callbacks) cb(result.event);
      }
    }

    function onTouchStart(e: TouchEvent) {
      dispatch({
        type: "touchstart",
        points: Array.from(e.touches).map(toPoint),
      });
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      dispatch({
        type: "touchmove",
        points: Array.from(e.touches).map(toPoint),
        elementRect: element.getBoundingClientRect(),
        timestamp: e.timeStamp,
      });
    }

    function onTouchEnd(e: TouchEvent) {
      dispatch({
        type: "touchend",
        points: Array.from(e.touches).map(toPoint),
      });
    }

    function onTouchCancel(e: TouchEvent) {
      dispatch({
        type: "touchcancel",
        points: Array.from(e.touches).map(toPoint),
      });
    }

    element.addEventListener("touchstart", onTouchStart as EventListener, {
      passive: true,
    });
    element.addEventListener("touchmove", onTouchMove as EventListener, {
      passive: false,
    });
    element.addEventListener("touchend", onTouchEnd as EventListener, {
      passive: true,
    });
    element.addEventListener("touchcancel", onTouchCancel as EventListener, {
      passive: true,
    });

    return {
      subscribe(cb: Callback<InterpreterEvent>): UnsubscribeFn {
        callbacks.add(cb);
        return () => callbacks.delete(cb);
      },
      unmount() {
        element.removeEventListener(
          "touchstart",
          onTouchStart as EventListener,
        );
        element.removeEventListener("touchmove", onTouchMove as EventListener);
        element.removeEventListener("touchend", onTouchEnd as EventListener);
        element.removeEventListener(
          "touchcancel",
          onTouchCancel as EventListener,
        );
        callbacks.clear();
      },
    };
  };
}
