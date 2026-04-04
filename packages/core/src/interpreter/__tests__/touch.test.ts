import { describe, it, expect, vi, beforeEach } from 'vitest';
import { touchInterpreter } from '../touch.js';

function makeTouch(id: number, x: number, y: number): Touch {
  return {
    identifier: id,
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    screenX: x,
    screenY: y,
    target: document.body,
    radiusX: 1,
    radiusY: 1,
    rotationAngle: 0,
    force: 1,
    altitudeAngle: 0,
    azimuthAngle: 0,
    touchType: 'direct',
  } as unknown as Touch;
}

function makeTouchEvent(type: string, touches: Touch[]): TouchEvent {
  return new TouchEvent(type, {
    touches,
    changedTouches: touches,
    bubbles: true,
    cancelable: true,
  });
}

describe('touchInterpreter', () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement('div');
    // Give element a bounding rect
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    document.body.appendChild(element);
  });

  it('emits pan motion on single-touch drag', () => {
    const interpreter = touchInterpreter()(element);
    const motions: unknown[] = [];
    interpreter.subscribe((m) => motions.push(m));

    element.dispatchEvent(makeTouchEvent('touchstart', [makeTouch(0, 100, 100)]));
    element.dispatchEvent(makeTouchEvent('touchmove', [makeTouch(0, 110, 120)]));

    expect(motions).toHaveLength(1);
    expect(motions[0]).toMatchObject({ dx: 10, dy: 20, dScale: 1 });

    interpreter.unmount();
  });

  it('emits pinch motion on two-touch gesture', () => {
    const interpreter = touchInterpreter()(element);
    const motions: unknown[] = [];
    interpreter.subscribe((m) => motions.push(m));

    // Start with two fingers 100px apart
    element.dispatchEvent(
      makeTouchEvent('touchstart', [makeTouch(0, 50, 100), makeTouch(1, 150, 100)]),
    );
    // Move them 200px apart (zoom in 2x)
    element.dispatchEvent(
      makeTouchEvent('touchmove', [makeTouch(0, 0, 100), makeTouch(1, 200, 100)]),
    );

    expect(motions).toHaveLength(1);
    const m = motions[0] as { dScale: number };
    expect(m.dScale).toBeCloseTo(2, 5);

    interpreter.unmount();
  });

  it('stops emitting after unmount', () => {
    const interpreter = touchInterpreter()(element);
    const motions: unknown[] = [];
    interpreter.subscribe((m) => motions.push(m));
    interpreter.unmount();

    element.dispatchEvent(makeTouchEvent('touchstart', [makeTouch(0, 100, 100)]));
    element.dispatchEvent(makeTouchEvent('touchmove', [makeTouch(0, 110, 120)]));

    expect(motions).toHaveLength(0);
  });
});
