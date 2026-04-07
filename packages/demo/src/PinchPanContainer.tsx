import { useEffect, useRef, type ReactNode } from "react";
import {
  touchInterpreter,
  mouseDragInterpreter,
  mouseWheelInterpreter,
  createStore,
  createRenderer,
  createReduce,
  toPublicState,
} from "@mimosa/core";

type Props = {
  children: ReactNode;
  className?: string;
};

export function PinchPanContainer({ children, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const interpreters = [
      touchInterpreter()(container),
      mouseDragInterpreter()(container),
      mouseWheelInterpreter()(container),
    ];

    const store = createStore(createReduce(), toPublicState)(interpreters);
    const renderer = createRenderer()(content, store);

    return () => {
      renderer.unmount();
      store.unmount();
      for (const interp of interpreters) interp.unmount();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: "hidden", touchAction: "none", cursor: "grab" }}
    >
      <div ref={contentRef} style={{ display: "inline-block" }}>
        {children}
      </div>
    </div>
  );
}
