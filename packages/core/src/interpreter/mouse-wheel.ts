import type {
  Interpreter,
  MountedInterpreter,
  Callback,
  InterpreterEvent,
  UnsubscribeFn,
} from "../types.js";

// Pixels per wheel "line" unit (for deltaMode LINE)
const LINE_HEIGHT = 16;
// Pixels per wheel "page" unit (for deltaMode PAGE)
const PAGE_HEIGHT = 600;

// Scale factor per pixel of wheel delta
const SCALE_PER_PIXEL = 0.002;

export function mouseWheelInterpreter(): Interpreter {
  return (element: Element): MountedInterpreter => {
    const callbacks = new Set<Callback<InterpreterEvent>>();

    function emit(event: InterpreterEvent) {
      for (const cb of callbacks) cb(event);
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();

      let deltaY = e.deltaY;
      if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        deltaY *= LINE_HEIGHT;
      } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        deltaY *= PAGE_HEIGHT;
      }

      const dScale = Math.exp(-deltaY * SCALE_PER_PIXEL);
      const rect = element.getBoundingClientRect();
      const originX = e.clientX - rect.left;
      const originY = e.clientY - rect.top;

      emit({
        type: "motion",
        timestamp: e.timeStamp,
        dx: 0,
        dy: 0,
        dScale,
        originX,
        originY,
      });
    }

    element.addEventListener("wheel", onWheel as EventListener, {
      passive: false,
    });

    return {
      subscribe(cb: Callback<InterpreterEvent>): UnsubscribeFn {
        callbacks.add(cb);
        return () => callbacks.delete(cb);
      },
      unmount() {
        element.removeEventListener("wheel", onWheel as EventListener);
        callbacks.clear();
      },
    };
  };
}
