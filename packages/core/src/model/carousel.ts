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

/**
 * The phase is global: a single discriminant covers both the carousel strip and all items.
 * This keeps the state machine manageable — per-item phases would multiply the number of
 * possible state combinations exponentially.
 *
 * States:
 *   scrolling — carousel strip is being scrolled; items are not transformed.
 *   focused   — one specific item is receiving gesture input (pinch or pan while zoomed in).
 *   inertia   — the focused item is coasting after the gesture was released.
 *   snapping  — the carousel strip is spring-snapping to the nearest item boundary.
 *   settled   — everything is at rest.
 */
export type CarouselPrivateState =
  | {
      type: "scrolling";
      carousel: LinearPrimitive;
      items: Record<string, ItemTransform>;
    }
  | {
      type: "focused";
      /** The item currently receiving gesture input. */
      focusedItemId: string;
      carousel: LinearPrimitive;
      items: Record<string, ItemTransform>;
    }
  | {
      type: "inertia";
      /** The item coasting after the gesture was released. */
      focusedItemId: string;
      carousel: LinearPrimitive;
      items: Record<string, ItemTransform>;
    }
  | {
      type: "snapping";
      carousel: LinearPrimitive;
      carouselTarget: number;
      items: Record<string, ItemTransform>;
    }
  | {
      type: "settled";
      carousel: LinearPrimitive;
      items: Record<string, ItemTransform>;
    };

type MotionEvent = Extract<InterpreterEvent, { type: "motion" }>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SNAP_THRESHOLD = 0.5; // px
const VELOCITY_THRESHOLD = 0.01; // px/ms
const LOG_VELOCITY_THRESHOLD = 0.0001; // log-units/ms

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the pan bounds for an item at the given scale.
 * When scale <= 1 the item fits within its container, so there is no room to pan.
 * When scale > 1 the item extends beyond the container edges.
 *
 * Derivation (transform-origin at top-left):
 *   content occupies [transformX, transformX + itemWidth * scale]
 *   to keep content filling the viewport:
 *     transformX <= 0   (left edge at or before viewport left)
 *     transformX + itemWidth * scale >= itemWidth  →  transformX >= itemWidth * (1 - scale)
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

/**
 * Applies a motion event to an item's transform, clamping translation to the item's
 * pan bounds. Overflow beyond the bounds is discarded.
 */
function applyMotionToItem(
  item: ItemTransform,
  motion: MotionEvent,
  itemWidth: number,
  itemHeight: number,
): ItemTransform {
  const { dx, dy, dScale, originX, originY, timestamp } = motion;
  const tx = item.x.value;
  const ty = item.y.value;
  const newScale = item.scale.value * dScale;

  // Apply scale with origin (same formula as the single-item Model).
  const proposedTx = originX + (tx - originX) * dScale + dx;
  const proposedTy = originY + (ty - originY) * dScale + dy;

  const bounds = getItemBounds(newScale, itemWidth, itemHeight);
  const clampedTx = Math.max(bounds.minX, Math.min(bounds.maxX, proposedTx));
  const clampedTy = Math.max(bounds.minY, Math.min(bounds.maxY, proposedTy));

  return {
    x: applyLinearDelta(item.x, clampedTx - tx, timestamp),
    y: applyLinearDelta(item.y, clampedTy - ty, timestamp),
    scale: applyExponentialFactor(item.scale, dScale, timestamp),
  };
}

/**
 * Determines whether a motion event should enter the "focused" state (item transform)
 * or the "scrolling" state (carousel scroll).
 *
 * Enters "focused" when the gesture targets an item that is already zoomed in,
 * or when the gesture itself includes a scale change (pinch).
 */
function resolveMotionTarget(
  action: MotionEvent,
  items: Record<string, ItemTransform>,
): { type: "focused"; itemId: string } | { type: "scrolling" } {
  if (action.itemId !== undefined) {
    const item = items[action.itemId];
    if (item && (action.dScale !== 1 || item.scale.value > 1)) {
      return { type: "focused", itemId: action.itemId };
    }
  }
  return { type: "scrolling" };
}

function focusedItemHasSignificantVelocity(
  items: Record<string, ItemTransform>,
  focusedItemId: string,
): boolean {
  const item = items[focusedItemId];
  if (!item) return false;
  return (
    Math.abs(item.x.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(item.y.velocity) > VELOCITY_THRESHOLD ||
    Math.abs(item.scale.logVelocity) > LOG_VELOCITY_THRESHOLD
  );
}

function computeCarouselSnapTarget(
  x: number,
  itemWidth: number,
  itemCount: number,
): number {
  const nearest = Math.round(x / itemWidth) * itemWidth;
  // Clamp to valid range: [-(itemCount - 1) * itemWidth, 0]
  return Math.max(-(itemCount - 1) * itemWidth, Math.min(0, nearest));
}

function isCarouselSettled(carousel: LinearPrimitive, target: number): boolean {
  return Math.abs(carousel.value - target) < SNAP_THRESHOLD;
}

function advanceFocusedItemInertia(
  items: Record<string, ItemTransform>,
  focusedItemId: string,
  timestamp: number,
): Record<string, ItemTransform> {
  const item = items[focusedItemId];
  if (!item) return items;
  return {
    ...items,
    [focusedItemId]: {
      x: advanceLinearInertia(item.x, timestamp),
      y: advanceLinearInertia(item.y, timestamp),
      scale: advanceExponentialInertia(item.scale, timestamp),
    },
  };
}

function settleFocusedItem(
  items: Record<string, ItemTransform>,
  focusedItemId: string,
  timestamp: number,
): Record<string, ItemTransform> {
  const item = items[focusedItemId];
  if (!item) return items;
  return {
    ...items,
    [focusedItemId]: {
      x: { value: item.x.value, velocity: 0, lastUpdatedAt: timestamp },
      y: { value: item.y.value, velocity: 0, lastUpdatedAt: timestamp },
      scale: {
        value: item.scale.value,
        logVelocity: 0,
        lastUpdatedAt: timestamp,
      },
    },
  };
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
      transformX: item.x.value,
      transformY: item.y.value,
      scale: item.scale.value,
    };
  }
  return { carouselTranslateX: state.carousel.value, items };
}

export function createCarouselReduce(
  config: CarouselConfig,
): Reducer<CarouselPrivateState> {
  const { itemWidth, itemHeight, itemIds } = config;

  function makeInitialItems(): Record<string, ItemTransform> {
    const items: Record<string, ItemTransform> = {};
    for (const id of itemIds) {
      items[id] = {
        x: createLinearPrimitive(0),
        y: createLinearPrimitive(0),
        scale: createExponentialPrimitive(1),
      };
    }
    return items;
  }

  function applyScrollingMotion(
    carousel: LinearPrimitive,
    action: MotionEvent,
  ): LinearPrimitive {
    return applyLinearDelta(carousel, action.dx, action.timestamp);
  }

  /**
   * Applies a motion event to the focused item only. Returns null when the event
   * does not target the focused item (caller should treat this as a no-op).
   */
  function applyFocusedMotion(
    items: Record<string, ItemTransform>,
    focusedItemId: string,
    action: MotionEvent,
  ): Record<string, ItemTransform> | null {
    if (action.itemId !== focusedItemId) return null;
    const item = items[focusedItemId];
    if (!item) return null;
    return {
      ...items,
      [focusedItemId]: applyMotionToItem(item, action, itemWidth, itemHeight),
    };
  }

  /**
   * Handles a motion event from any state that can freely transition to either
   * "scrolling" or "focused". Applies the motion and returns the resulting state.
   */
  function applyMotionFromAnyState(
    carousel: LinearPrimitive,
    items: Record<string, ItemTransform>,
    action: MotionEvent,
  ): CarouselPrivateState {
    const target = resolveMotionTarget(action, items);
    if (target.type === "focused") {
      const newItems = applyFocusedMotion(items, target.itemId, action);
      if (newItems) {
        return {
          type: "focused",
          focusedItemId: target.itemId,
          carousel,
          items: newItems,
        };
      }
    }
    return {
      type: "scrolling",
      carousel: applyScrollingMotion(carousel, action),
      items,
    };
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
      case "scrolling": {
        switch (action.type) {
          case "motion": {
            const target = resolveMotionTarget(action, state.items);
            if (target.type === "focused") {
              const newItems = applyFocusedMotion(
                state.items,
                target.itemId,
                action,
              );
              if (newItems) {
                return {
                  type: "focused",
                  focusedItemId: target.itemId,
                  carousel: state.carousel,
                  items: newItems,
                };
              }
            }
            return {
              ...state,
              carousel: applyScrollingMotion(state.carousel, action),
            };
          }
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
          case "tick":
            return state;
        }
        throw new Error("unreachable");
      }
      case "focused": {
        switch (action.type) {
          case "motion": {
            // Only handle motion targeting the focused item; ignore everything else.
            const newItems = applyFocusedMotion(
              state.items,
              state.focusedItemId,
              action,
            );
            if (!newItems) return state;
            return { ...state, items: newItems };
          }
          case "release":
            return {
              type: "inertia",
              focusedItemId: state.focusedItemId,
              carousel: state.carousel,
              items: state.items,
            };
          case "tick":
            return state;
        }
        throw new Error("unreachable");
      }
      case "inertia": {
        switch (action.type) {
          case "motion":
            return applyMotionFromAnyState(state.carousel, state.items, action);
          case "release":
            return state;
          case "tick": {
            if (
              focusedItemHasSignificantVelocity(
                state.items,
                state.focusedItemId,
              )
            ) {
              return {
                ...state,
                items: advanceFocusedItemInertia(
                  state.items,
                  state.focusedItemId,
                  action.timestamp,
                ),
              };
            }
            return {
              type: "settled",
              carousel: state.carousel,
              items: settleFocusedItem(
                state.items,
                state.focusedItemId,
                action.timestamp,
              ),
            };
          }
        }
        throw new Error("unreachable");
      }
      case "snapping": {
        switch (action.type) {
          case "motion":
            return applyMotionFromAnyState(state.carousel, state.items, action);
          case "release":
            return state;
          case "tick": {
            const { carouselTarget } = state;
            if (isCarouselSettled(state.carousel, carouselTarget)) {
              return {
                type: "settled",
                carousel: {
                  value: carouselTarget,
                  velocity: 0,
                  lastUpdatedAt: action.timestamp,
                },
                items: state.items,
              };
            }
            return {
              ...state,
              carousel: advanceLinearSpring(
                state.carousel,
                carouselTarget,
                action.timestamp,
              ),
            };
          }
        }
        throw new Error("unreachable");
      }
      case "settled": {
        switch (action.type) {
          case "motion":
            return applyMotionFromAnyState(state.carousel, state.items, action);
          case "release":
            return state;
          case "tick":
            return state;
        }
        throw new Error("unreachable");
      }
    }
  };
}
