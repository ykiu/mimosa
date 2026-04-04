import type { Interpreter, MountedInterpreter, Callback, Motion, UnsubscribeFn } from '../types.js';

type TouchPoint = { x: number; y: number };

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

export function touchInterpreter(): Interpreter {
  return (element: Element): MountedInterpreter => {
    const callbacks = new Set<Callback<Motion>>();

    // Previous touch state
    let prevPoints: TouchPoint[] = [];

    function emit(motion: Motion) {
      for (const cb of callbacks) cb(motion);
    }

    function getTouchPoints(e: TouchEvent): TouchPoint[] {
      return Array.from(e.touches).map(toPoint);
    }

    function onTouchStart(e: TouchEvent) {
      prevPoints = getTouchPoints(e);
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      const currPoints = getTouchPoints(e);

      if (currPoints.length === 0 || prevPoints.length === 0) {
        prevPoints = currPoints;
        return;
      }

      if (currPoints.length === 1 && prevPoints.length >= 1) {
        // Pan
        const curr = currPoints[0];
        const prev = prevPoints[0];
        emit({
          dx: curr.x - prev.x,
          dy: curr.y - prev.y,
          dScale: 1,
          originX: 0,
          originY: 0,
        });
      } else if (currPoints.length >= 2 && prevPoints.length >= 2) {
        // Pinch + pan
        const currMid = getMidpoint(currPoints[0], currPoints[1]);
        const prevMid = getMidpoint(prevPoints[0], prevPoints[1]);
        const currDist = getDistance(currPoints[0], currPoints[1]);
        const prevDist = getDistance(prevPoints[0], prevPoints[1]);

        const dScale = prevDist === 0 ? 1 : currDist / prevDist;
        const rect = element.getBoundingClientRect();
        const originX = currMid.x - rect.left;
        const originY = currMid.y - rect.top;

        emit({
          dx: currMid.x - prevMid.x,
          dy: currMid.y - prevMid.y,
          dScale,
          originX,
          originY,
        });
      }

      prevPoints = currPoints;
    }

    function onTouchEnd(e: TouchEvent) {
      prevPoints = getTouchPoints(e);
    }

    element.addEventListener('touchstart', onTouchStart as EventListener, { passive: true });
    element.addEventListener('touchmove', onTouchMove as EventListener, { passive: false });
    element.addEventListener('touchend', onTouchEnd as EventListener, { passive: true });
    element.addEventListener('touchcancel', onTouchEnd as EventListener, { passive: true });

    return {
      subscribe(cb: Callback<Motion>): UnsubscribeFn {
        callbacks.add(cb);
        return () => callbacks.delete(cb);
      },
      unmount() {
        element.removeEventListener('touchstart', onTouchStart as EventListener);
        element.removeEventListener('touchmove', onTouchMove as EventListener);
        element.removeEventListener('touchend', onTouchEnd as EventListener);
        element.removeEventListener('touchcancel', onTouchEnd as EventListener);
        callbacks.clear();
      },
    };
  };
}
