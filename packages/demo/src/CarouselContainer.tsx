import { useEffect, useRef, type ReactNode } from "react";
import {
  touchInterpreter,
  mouseDragInterpreter,
  createStore,
  createRenderer,
  createModel,
} from "@mimosa/core";

type Props = {
  children: ReactNode;
  itemCount: number;
  itemWidth: number;
  className?: string;
};

export function CarouselContainer({
  children,
  itemCount,
  itemWidth,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const snapX = (x: number) => {
      const index = Math.round(-x / itemWidth);
      const clamped = Math.max(0, Math.min(itemCount - 1, index));
      return -clamped * itemWidth;
    };

    const interpreters = [
      touchInterpreter()(container),
      mouseDragInterpreter()(container),
    ];
    const store = createStore(createModel({ x: snapX }))(interpreters);
    const renderer = createRenderer()(content, store);

    return () => {
      renderer.unmount();
      store.unmount();
      for (const interp of interpreters) interp.unmount();
    };
  }, [itemCount, itemWidth]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: "hidden", touchAction: "none", cursor: "grab" }}
    >
      <div
        ref={contentRef}
        style={{ display: "flex", width: itemCount * itemWidth }}
      >
        {children}
      </div>
    </div>
  );
}
