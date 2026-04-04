import type { Renderer, MountedRenderer, MountedStore } from '../types.js';

export function createRenderer(): Renderer {
  return (element: Element, store: MountedStore): MountedRenderer => {
    const el = element as HTMLElement;

    const unsubscribe = store.subscribe(({ transformX, transformY, scale }) => {
      el.style.transform = `translate(${transformX}px, ${transformY}px) scale(${scale})`;
      el.style.transformOrigin = '0 0';
    });

    return {
      unmount() {
        unsubscribe();
      },
    };
  };
}
