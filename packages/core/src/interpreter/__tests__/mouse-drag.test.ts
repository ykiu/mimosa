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
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));

    element.dispatchEvent(mouseEvent('mousedown', 100, 100));
    window.dispatchEvent(mouseEvent('mousemove', 115, 130));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'motion', dx: 15, dy: 30, dScale: 1 });

    interpreter.unmount();
  });

  it('does not emit before mousedown', () => {
    const interpreter = mouseDragInterpreter()(element);
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));

    window.dispatchEvent(mouseEvent('mousemove', 115, 130));

    expect(events).toHaveLength(0);

    interpreter.unmount();
  });

  it('emits release event on mouseup', () => {
    const interpreter = mouseDragInterpreter()(element);
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));

    element.dispatchEvent(mouseEvent('mousedown', 100, 100));
    window.dispatchEvent(mouseEvent('mousemove', 115, 130));
    window.dispatchEvent(mouseEvent('mouseup', 115, 130));

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: 'release' });

    interpreter.unmount();
  });

  it('stops emitting after mouseup', () => {
    const interpreter = mouseDragInterpreter()(element);
    const events: unknown[] = [];
    interpreter.subscribe((e) => events.push(e));

    element.dispatchEvent(mouseEvent('mousedown', 100, 100));
    window.dispatchEvent(mouseEvent('mouseup', 100, 100));
    window.dispatchEvent(mouseEvent('mousemove', 150, 150));

    // Only the release event should be emitted, not a motion from the subsequent mousemove
    const motionEvents = events.filter((e) => (e as { type: string }).type === 'motion');
    expect(motionEvents).toHaveLength(0);

    interpreter.unmount();
  });
});
