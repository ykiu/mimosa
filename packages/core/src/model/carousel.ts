import type { InterpreterEvent, StoreAction, Reducer } from "../types.js";
import {
  type LinearPrimitive,
  type ExponentialPrimitive,
  createLinearPrimitive,
  createExponentialPrimitive,
  applyLinearDelta,
  applyExponentialFactor,
  advanceLinearInertia,
  advanceExponentialInertia,
  advanceLinearSpring,
  advanceExponentialSpring,
} from "./primitives.js";

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

type ItemTransform = {
  x: LinearPrimitive;
  y: LinearPrimitive;
  scale: ExponentialPrimitive;
};

type ItemSnapTarget = { x: number; y: number; scale: number };

/**
 * Per-item phase. Independent of the carousel-level phase.
 *
 *   settled  — at rest.
 *   tracking — actively receiving gesture input (while carousel is locked).
 *   inertia  — coasting after release.
 *   snapping — spring-snapping back to a target (e.g. under-zoom recovery).
 */
export type ItemPrivateState =
  | { type: "settled"; transform: ItemTransform }
  | { type: "tracking"; transform: ItemTransform }
  | { type: "inertia"; transform: ItemTransform }
  | { type: "snapping"; transform: ItemTransform; target: ItemSnapTarget };

/**
 * Carousel-level phase. Tracks only the carousel strip's motion.
 * Item-level concerns live in ItemPrivateState, one per item.
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
      items: Record<string, ItemPrivateState>;
    }
  | {
      type: "scrolling";
      carousel: LinearPrimitive;
      items: Record<string, ItemPrivateState>;
    }
  | {
      type: "snapping";
      carousel: LinearPrimitive;
      carouselTarget: number;
      items: Record<string, ItemPrivateState>;
    }
  | {
      type: "locked";
      carousel: LinearPrimitive;
      items: Record<string, ItemPrivateState>;
    };

type MotionEvent = Extract<InterpreterEvent, { type: "motion" }>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAROUSEL_SNAP_THRESHOLD = 0.5; // px
const ITEM_SNAP_THRESHOLD = 0.5; // px
const ITEM_SCALE_SNAP_THRESHOLD = 0.001;
const VELOCITY_THRESHOLD = 0.01; // px/ms
const LOG_VELOCITY_THRESHOLD = 0.0001; // log-units/ms

// ---------------------------------------------------------------------------
// Item transform helpers
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

function applyMotionToItem(
  transform: ItemTransform,
  motion: MotionEvent,
  itemWidth: number,
  itemHeight: number,
): ItemTransform {
  const { dx, dy, dScale, originX, originY, timestamp } = motion;
  const tx = transform.x.value;
  const ty = transform.y.value;
  const newScale = transform.scale.value * dScale;

  const proposedTx = originX + (tx - originX) * dScale + dx;
  const proposedTy = originY + (ty - originY) * dScale + dy;

  const bounds = getItemBounds(newScale, itemWidth, itemHeight);
  const clampedTx = Math.max(bounds.minX, Math.min(bounds.maxX, proposedTx));
  const clampedTy = Math.max(bounds.minY, Math.min(bounds.maxY, proposedTy));

  return {
    x: applyLinearDelta(transform.x, clampedTx - tx, timestamp),
    y: applyLinearDelta(transform.y, clampedTy - ty, timestamp),
    scale: applyExponentialFactor(transform.scale, dScale, timestamp),
  };
}

function itemHasSignificantVelocity(transform: ItemTransform): boolean {
  return (
    Math.abs(transform.x.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(transform.y.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(transform.scale.logVelocity) > LOG_VELOCITY_THRESHOLD
  );
}

function advanceItemInertia(
  transform: ItemTransform,
  timestamp: number,
): ItemTransform {
  return {
    x: advanceLinearInertia(transform.x, timestamp),
    y: advanceLinearInertia(transform.y, timestamp),
    scale: advanceExponentialInertia(transform.scale, timestamp),
  };
}

function advanceItemSpring(
  transform: ItemTransform,
  target: ItemSnapTarget,
  timestamp: number,
): ItemTransform {
  return {
    x: advanceLinearSpring(transform.x, target.x, timestamp),
    y: advanceLinearSpring(transform.y, target.y, timestamp),
    scale: advanceExponentialSpring(transform.scale, target.scale, timestamp),
  };
}

function isItemSnapSettled(
  transform: ItemTransform,
  target: ItemSnapTarget,
): boolean {
  return (
    Math.abs(transform.x.value - target.x) < ITEM_SNAP_THRESHOLD &&
    Math.abs(transform.y.value - target.y) < ITEM_SNAP_THRESHOLD &&
    Math.abs(transform.scale.value - target.scale) < ITEM_SCALE_SNAP_THRESHOLD
  );
}

function settleItemTransform(transform: ItemTransform): ItemTransform {
  return {
    x: {
      value: transform.x.value,
      velocity: 0,
      lastUpdatedAt: transform.x.lastUpdatedAt,
    },
    y: {
      value: transform.y.value,
      velocity: 0,
      lastUpdatedAt: transform.y.lastUpdatedAt,
    },
    scale: {
      value: transform.scale.value,
      logVelocity: 0,
      lastUpdatedAt: transform.scale.lastUpdatedAt,
    },
  };
}

function snapItemToTarget(
  target: ItemSnapTarget,
  timestamp: number,
): ItemTransform {
  return {
    x: { value: target.x, velocity: 0, lastUpdatedAt: timestamp },
    y: { value: target.y, velocity: 0, lastUpdatedAt: timestamp },
    scale: { value: target.scale, logVelocity: 0, lastUpdatedAt: timestamp },
  };
}

// ---------------------------------------------------------------------------
// Item-level phase transitions
// ---------------------------------------------------------------------------

function releaseItem(
  item: Extract<ItemPrivateState, { type: "tracking" }>,
): ItemPrivateState {
  if (item.transform.scale.value < 1) {
    return {
      type: "snapping",
      transform: item.transform,
      target: { x: 0, y: 0, scale: 1 },
    };
  }
  if (itemHasSignificantVelocity(item.transform)) {
    return { type: "inertia", transform: item.transform };
  }
  return { type: "settled", transform: settleItemTransform(item.transform) };
}

function advanceItem(
  item: ItemPrivateState,
  timestamp: number,
): ItemPrivateState {
  switch (item.type) {
    case "settled":
    case "tracking":
      return item;
    case "inertia": {
      if (itemHasSignificantVelocity(item.transform)) {
        return {
          ...item,
          transform: advanceItemInertia(item.transform, timestamp),
        };
      }
      if (item.transform.scale.value < 1) {
        return {
          type: "snapping",
          transform: item.transform,
          target: { x: 0, y: 0, scale: 1 },
        };
      }
      return {
        type: "settled",
        transform: settleItemTransform(item.transform),
      };
    }
    case "snapping": {
      if (isItemSnapSettled(item.transform, item.target)) {
        return {
          type: "settled",
          transform: snapItemToTarget(item.target, timestamp),
        };
      }
      return {
        ...item,
        transform: advanceItemSpring(item.transform, item.target, timestamp),
      };
    }
  }
}

function advanceAllItems(
  items: Record<string, ItemPrivateState>,
  timestamp: number,
): Record<string, ItemPrivateState> {
  let changed = false;
  const result: Record<string, ItemPrivateState> = {};
  for (const [id, item] of Object.entries(items)) {
    const next = advanceItem(item, timestamp);
    result[id] = next;
    if (next !== item) changed = true;
  }
  return changed ? result : items;
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
  items: Record<string, ItemPrivateState>,
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
  items: Record<string, ItemPrivateState>,
): string | undefined {
  for (const [id, item] of Object.entries(items)) {
    if (item.type === "tracking") return id;
  }
  return undefined;
}

/**
 * Transitions items into the locked state: starts tracking targetItemId and
 * immediately settles any other items that are in motion (one active item at a time).
 */
function lockItems(
  items: Record<string, ItemPrivateState>,
  targetItemId: string,
  action: MotionEvent,
  itemWidth: number,
  itemHeight: number,
): Record<string, ItemPrivateState> {
  const result: Record<string, ItemPrivateState> = {};
  for (const [id, item] of Object.entries(items)) {
    if (id === targetItemId) {
      result[id] = {
        type: "tracking",
        transform: applyMotionToItem(
          item.transform,
          action,
          itemWidth,
          itemHeight,
        ),
      };
    } else if (item.type !== "settled") {
      result[id] = {
        type: "settled",
        transform: settleItemTransform(item.transform),
      };
    } else {
      result[id] = item;
    }
  }
  return result;
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

export function toCarouselPublicState(
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

export function createCarouselReduce(
  config: CarouselConfig,
): Reducer<CarouselPrivateState> {
  const { itemWidth, itemHeight, itemIds } = config;

  function makeInitialItems(): Record<string, ItemPrivateState> {
    const items: Record<string, ItemPrivateState> = {};
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
                items: lockItems(
                  state.items,
                  target.itemId,
                  action,
                  itemWidth,
                  itemHeight,
                ),
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
            const item = state.items[trackingId] as Extract<
              ItemPrivateState,
              { type: "tracking" }
            >;
            return {
              ...state,
              items: {
                ...state.items,
                [trackingId]: {
                  type: "tracking",
                  transform: applyMotionToItem(
                    item.transform,
                    action,
                    itemWidth,
                    itemHeight,
                  ),
                },
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
            const item = state.items[trackingId] as Extract<
              ItemPrivateState,
              { type: "tracking" }
            >;
            return {
              type: "settled",
              carousel: state.carousel,
              items: { ...state.items, [trackingId]: releaseItem(item) },
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
