import type { InterpreterEvent, StoreAction, Model } from "../types.js";
import {
  type LinearPrimitive,
  createLinearPrimitive,
  createExponentialPrimitive,
  applyLinearDelta,
  advanceLinearSpring,
} from "./primitives.js";
import {
  type TransformPrivateState,
  createTransformReduce,
  settleTransform,
} from "./transform.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CarouselConfig = {
  /** Width of each carousel item in pixels. */
  itemWidth: number;
  /** Height of each carousel item in pixels. */
  itemHeight: number;
  /** Ordered list of item identifiers. */
  itemIds: readonly string[];
};

export type CarouselPublicState = {
  /** Horizontal translation of the carousel strip (px). Negative = scrolled right. */
  carouselTranslateX: number;
  /** Per-item transform state keyed by item ID. */
  items: Record<
    string,
    { transformX: number; transformY: number; scale: number }
  >;
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Carousel-level phase. Tracks only the carousel strip's motion.
 * Item-level concerns live in TransformPrivateState, one per item.
 *
 *   settled  — strip is at rest.
 *   scrolling — user is dragging the strip.
 *   snapping  — strip is spring-snapping to the nearest item boundary.
 *   locked    — all motion is delegated to the active item (carousel entered
 *               from settled; exits on release back to settled).
 */
export type CarouselPrivateState =
  | {
      type: "settled";
      carousel: LinearPrimitive;
      items: Record<string, TransformPrivateState>;
    }
  | {
      type: "scrolling";
      carousel: LinearPrimitive;
      items: Record<string, TransformPrivateState>;
    }
  | {
      type: "snapping";
      carousel: LinearPrimitive;
      carouselTarget: number;
      items: Record<string, TransformPrivateState>;
    }
  | {
      type: "locked";
      carousel: LinearPrimitive;
      items: Record<string, TransformPrivateState>;
    };

type MotionEvent = Extract<InterpreterEvent, { type: "motion" }>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAROUSEL_SNAP_THRESHOLD = 0.5; // px

// ---------------------------------------------------------------------------
// Item bounds helper
// ---------------------------------------------------------------------------

/**
 * Returns the pan bounds for an item at the given scale.
 * When scale <= 1 the item fits within its container, so there is no room to pan.
 *
 * Derivation (transform-origin at top-left):
 *   content occupies [transformX, transformX + itemWidth * scale]
 *   to keep content filling the viewport:
 *     transformX <= 0
 *     transformX >= itemWidth * (1 - scale)
 */
function getItemBounds(
  scale: number,
  itemWidth: number,
  itemHeight: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  if (scale <= 1) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    minX: itemWidth * (1 - scale),
    maxX: 0,
    minY: itemHeight * (1 - scale),
    maxY: 0,
  };
}

// ---------------------------------------------------------------------------
// Routing helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether a motion event should lock the carousel to an item
 * or scroll the carousel strip.
 *
 * Locks when the target item is zoomed, in motion, or the gesture is a pinch.
 */
function resolveMotionTarget(
  action: MotionEvent,
  items: Record<string, TransformPrivateState>,
): { type: "locked"; itemId: string } | { type: "scrolling" } {
  if (action.itemId !== undefined) {
    const item = items[action.itemId];
    if (item) {
      const isZoomed = item.transform.scale.value !== 1;
      const isInMotion = item.type !== "settled";
      if (action.dScale !== 1 || isZoomed || isInMotion) {
        return { type: "locked", itemId: action.itemId };
      }
    }
  }
  return { type: "scrolling" };
}

function findTrackingItemId(
  items: Record<string, TransformPrivateState>,
): string | undefined {
  for (const [id, item] of Object.entries(items)) {
    if (item.type === "tracking") return id;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Carousel-level helpers
// ---------------------------------------------------------------------------

function computeCarouselSnapTarget(
  x: number,
  itemWidth: number,
  itemCount: number,
): number {
  const nearest = Math.round(x / itemWidth) * itemWidth;
  return Math.max(-(itemCount - 1) * itemWidth, Math.min(0, nearest));
}

function isCarouselSettled(carousel: LinearPrimitive, target: number): boolean {
  return Math.abs(carousel.value - target) < CAROUSEL_SNAP_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function toCarouselPublicState(
  state: CarouselPrivateState,
): CarouselPublicState {
  const items: Record<
    string,
    { transformX: number; transformY: number; scale: number }
  > = {};
  for (const [id, item] of Object.entries(state.items)) {
    items[id] = {
      transformX: item.transform.x.value,
      transformY: item.transform.y.value,
      scale: item.transform.scale.value,
    };
  }
  return { carouselTranslateX: state.carousel.value, items };
}

export function createCarouselModel(
  config: CarouselConfig,
): Model<CarouselPublicState, CarouselPrivateState, StoreAction> {
  const reduce = createCarouselReduce(config);
  return { reduce, publish: toCarouselPublicState };
}

function createCarouselReduce(config: CarouselConfig) {
  const { itemWidth, itemHeight, itemIds } = config;

  const itemReduce = createTransformReduce({
    bounds: (scale) => getItemBounds(scale, itemWidth, itemHeight),
    snapTarget: (t) => (t.scale.value < 1 ? { x: 0, y: 0, scale: 1 } : null),
  });

  function makeInitialItems(): Record<string, TransformPrivateState> {
    const items: Record<string, TransformPrivateState> = {};
    for (const id of itemIds) {
      items[id] = {
        type: "settled",
        transform: {
          x: createLinearPrimitive(0),
          y: createLinearPrimitive(0),
          scale: createExponentialPrimitive(1),
        },
      };
    }
    return items;
  }

  /**
   * Transitions items into the locked state: starts tracking targetItemId and
   * immediately settles any other items that are in motion (one active item at a time).
   */
  function lockItems(
    items: Record<string, TransformPrivateState>,
    targetItemId: string,
    action: MotionEvent,
  ): Record<string, TransformPrivateState> {
    const result: Record<string, TransformPrivateState> = {};
    for (const [id, item] of Object.entries(items)) {
      if (id === targetItemId) {
        result[id] = itemReduce(item, action);
      } else if (item.type !== "settled") {
        result[id] = {
          type: "settled",
          transform: settleTransform(item.transform),
        };
      } else {
        result[id] = item;
      }
    }
    return result;
  }

  function advanceAllItems(
    items: Record<string, TransformPrivateState>,
    timestamp: number,
  ): Record<string, TransformPrivateState> {
    let changed = false;
    const result: Record<string, TransformPrivateState> = {};
    for (const [id, item] of Object.entries(items)) {
      const next = itemReduce(item, { type: "tick", timestamp });
      result[id] = next;
      if (next !== item) changed = true;
    }
    return changed ? result : items;
  }

  return function reduce(
    state: CarouselPrivateState | undefined = {
      type: "settled",
      carousel: createLinearPrimitive(0),
      items: makeInitialItems(),
    },
    action: StoreAction,
  ): CarouselPrivateState {
    switch (state.type) {
      case "settled": {
        switch (action.type) {
          case "motion": {
            const target = resolveMotionTarget(action, state.items);
            if (target.type === "locked") {
              return {
                type: "locked",
                carousel: state.carousel,
                items: lockItems(state.items, target.itemId, action),
              };
            }
            return {
              type: "scrolling",
              carousel: applyLinearDelta(
                state.carousel,
                action.dx,
                action.timestamp,
              ),
              items: state.items,
            };
          }
          case "release":
            return state;
          case "tick": {
            const items = advanceAllItems(state.items, action.timestamp);
            return items === state.items ? state : { ...state, items };
          }
        }
        throw new Error("unreachable");
      }

      case "scrolling": {
        switch (action.type) {
          case "motion":
            return {
              ...state,
              carousel: applyLinearDelta(
                state.carousel,
                action.dx,
                action.timestamp,
              ),
            };
          case "release": {
            const carouselTarget = computeCarouselSnapTarget(
              state.carousel.value,
              itemWidth,
              itemIds.length,
            );
            return {
              type: "snapping",
              carousel: state.carousel,
              carouselTarget,
              items: state.items,
            };
          }
          case "tick": {
            const items = advanceAllItems(state.items, action.timestamp);
            return items === state.items ? state : { ...state, items };
          }
        }
        throw new Error("unreachable");
      }

      case "snapping": {
        switch (action.type) {
          case "motion": {
            // Allow the user to interrupt a snap by scrolling (no itemId), but
            // ignore item-targeted motions since locked can only be entered from settled.
            if (action.itemId !== undefined) return state;
            return {
              type: "scrolling",
              carousel: applyLinearDelta(
                state.carousel,
                action.dx,
                action.timestamp,
              ),
              items: state.items,
            };
          }
          case "release":
            return state;
          case "tick": {
            const { carouselTarget } = state;
            const items = advanceAllItems(state.items, action.timestamp);
            if (isCarouselSettled(state.carousel, carouselTarget)) {
              return {
                type: "settled",
                carousel: {
                  value: carouselTarget,
                  velocity: 0,
                  lastUpdatedAt: action.timestamp,
                },
                items,
              };
            }
            return {
              ...state,
              carousel: advanceLinearSpring(
                state.carousel,
                carouselTarget,
                action.timestamp,
              ),
              items,
            };
          }
        }
        throw new Error("unreachable");
      }

      case "locked": {
        switch (action.type) {
          case "motion": {
            const trackingId = findTrackingItemId(state.items);
            if (trackingId === undefined || action.itemId !== trackingId)
              return state;
            return {
              ...state,
              items: {
                ...state.items,
                [trackingId]: itemReduce(state.items[trackingId], action),
              },
            };
          }
          case "release": {
            const trackingId = findTrackingItemId(state.items);
            if (trackingId === undefined) {
              return {
                type: "settled",
                carousel: state.carousel,
                items: state.items,
              };
            }
            return {
              type: "settled",
              carousel: state.carousel,
              items: {
                ...state.items,
                [trackingId]: itemReduce(state.items[trackingId], action),
              },
            };
          }
          case "tick": {
            const items = advanceAllItems(state.items, action.timestamp);
            return items === state.items ? state : { ...state, items };
          }
        }
        throw new Error("unreachable");
      }
    }
  };
}
