import { useEffect, useRef, type ReactNode } from "react";
import {
  touchInterpreter,
  mouseDragInterpreter,
  createStore,
  createCarouselModel,
  type MountedInterpreter,
  type InterpreterEvent,
  mouseWheelInterpreter,
} from "@mimosa/core";

type ScalableCarouselItem = {
  id: string;
  children: ReactNode;
};

type Props = {
  items: ScalableCarouselItem[];
  itemWidth: number;
  itemHeight: number;
  className?: string;
};

function withItemId(
  interp: MountedInterpreter,
  itemId: string,
): MountedInterpreter {
  return {
    subscribe(cb) {
      return interp.subscribe((event: InterpreterEvent) =>
        cb({ ...event, itemId }),
      );
    },
    unmount: () => interp.unmount(),
  };
}

export function ScalableCarouselContainer({
  items,
  itemWidth,
  itemHeight,
  className,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const itemContentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const itemViewportRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    const allInterpreters: MountedInterpreter[] = [];
    for (const item of items) {
      const viewport = itemViewportRefs.current.get(item.id);
      if (!viewport) continue;
      allInterpreters.push(
        withItemId(touchInterpreter()(viewport), item.id),
        withItemId(mouseDragInterpreter()(viewport), item.id),
        withItemId(mouseWheelInterpreter()(viewport), item.id),
      );
    }

    const store = createStore(
      createCarouselModel({
        itemWidth,
        itemHeight,
        itemIds: items.map((i) => i.id),
      }),
    )(allInterpreters);

    const unsubscribe = store.subscribe((state) => {
      strip.style.transform = `translateX(${state.carouselTranslateX}px)`;
      for (const [id, itemState] of Object.entries(state.items)) {
        const el = itemContentRefs.current.get(id);
        if (el) {
          el.style.transform = `translate(${itemState.transformX}px, ${itemState.transformY}px) scale(${itemState.scale})`;
          el.style.transformOrigin = "0 0";
        }
      }
    });

    return () => {
      unsubscribe();
      store.unmount();
      for (const interp of allInterpreters) interp.unmount();
    };
  }, [items, itemWidth, itemHeight]);

  return (
    <div
      className={className}
      style={{ overflow: "hidden", touchAction: "none" }}
    >
      <div ref={stripRef} style={{ display: "flex" }}>
        {items.map((item) => (
          <div
            key={item.id}
            ref={(el) => {
              if (el) itemViewportRefs.current.set(item.id, el);
            }}
            style={{
              width: itemWidth,
              height: itemHeight,
              flexShrink: 0,
              overflow: "hidden",
              cursor: "grab",
            }}
          >
            <div
              ref={(el) => {
                if (el) itemContentRefs.current.set(item.id, el);
              }}
              style={{ width: "100%", height: "100%" }}
            >
              {item.children}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
