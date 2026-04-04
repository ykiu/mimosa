import type { Interpreter, MountedInterpreter, Callback, Motion, UnsubscribeFn } from '../types.js';

export function mouseDragInterpreter(): Interpreter {
  return (element: Element): MountedInterpreter => {
    const callbacks = new Set<Callback<Motion>>();

    let dragging = false;
    let prevX = 0;
    let prevY = 0;

    function emit(motion: Motion) {
      for (const cb of callbacks) cb(motion);
    }

    function onMouseDown(e: MouseEvent) {
      dragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    }

    function onMouseMove(e: MouseEvent) {
      if (!dragging) return;
      emit({
        dx: e.clientX - prevX,
        dy: e.clientY - prevY,
        dScale: 1,
        originX: 0,
        originY: 0,
      });
      prevX = e.clientX;
      prevY = e.clientY;
    }

    function onMouseUp() {
      dragging = false;
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
