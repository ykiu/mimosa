import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mouseDragInterpreter } from '../mouse-drag.js';

function mouseEvent(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
}

describe('mouseDragInterpreter', () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    document.body.removeChild(element);
  });

  it('emits pan motion while dragging', () => {
    const interpreter = mouseDragInterpreter()(element);
    const motions: unknown[] = [];
    interpreter.subscribe((m) => motions.push(m));

    element.dispatchEvent(mouseEvent('mousedown', 100, 100));
    window.dispatchEvent(mouseEvent('mousemove', 115, 130));

    expect(motions).toHaveLength(1);
    expect(motions[0]).toMatchObject({ dx: 15, dy: 30, dScale: 1 });

    interpreter.unmount();
  });

  it('does not emit before mousedown', () => {
    const interpreter = mouseDragInterpreter()(element);
    const motions: unknown[] = [];
    interpreter.subscribe((m) => motions.push(m));

    window.dispatchEvent(mouseEvent('mousemove', 115, 130));

    expect(motions).toHaveLength(0);

    interpreter.unmount();
  });

  it('stops emitting after mouseup', () => {
    const interpreter = mouseDragInterpreter()(element);
    const motions: unknown[] = [];
    interpreter.subscribe((m) => motions.push(m));

    element.dispatchEvent(mouseEvent('mousedown', 100, 100));
    window.dispatchEvent(mouseEvent('mouseup', 100, 100));
    window.dispatchEvent(mouseEvent('mousemove', 150, 150));

    expect(motions).toHaveLength(0);

    interpreter.unmount();
  });
});
