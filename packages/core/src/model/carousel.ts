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

/**
 * The phase is global: a single discriminant covers both the carousel strip and all items.
 * This keeps the state machine manageable — per-item phases would multiply the number of
 * possible state combinations exponentially.
 */
export type CarouselPrivateState =
  | {
      type: "tracking";
      carousel: LinearPrimitive;
      items: Record<string, ItemTransform>;
    }
  | {
      type: "inertia";
      carousel: LinearPrimitive;
      items: Record<string, ItemTransform>;
    }
  | {
      type: "snapping";
      carousel: LinearPrimitive;
      carouselTarget: number;
      items: Record<string, ItemTransform>;
      /** Each item snaps back to its neutral position (x=0, y=0, scale=1). */
      itemTargets: Record<string, { x: number; y: number; scale: number }>;
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
const SCALE_SNAP_THRESHOLD = 0.01; // relative (1%)
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
 * pan bounds. Any horizontal translation that exceeds the bounds is returned as
 * `overflowDx` so the caller can redirect it to the carousel strip.
 */
function applyMotionToItem(
  item: ItemTransform,
  motion: MotionEvent,
  itemWidth: number,
  itemHeight: number,
): { item: ItemTransform; overflowDx: number } {
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
  const overflowDx = proposedTx - clampedTx;

  return {
    item: {
      x: applyLinearDelta(item.x, clampedTx - tx, timestamp),
      y: applyLinearDelta(item.y, clampedTy - ty, timestamp),
      scale: applyExponentialFactor(item.scale, dScale, timestamp),
    },
    overflowDx,
  };
}

/**
 * Applies a carousel-level motion event (no itemId) to the carousel strip.
 * Only the horizontal component (dx) is applied; dScale is ignored for the strip.
 */
function applyMotionToCarousel(
  carousel: LinearPrimitive,
  motion: MotionEvent,
): LinearPrimitive {
  return applyLinearDelta(carousel, motion.dx, motion.timestamp);
}

function hasSignificantVelocity(
  carousel: LinearPrimitive,
  items: Record<string, ItemTransform>,
): boolean {
  if (Math.abs(carousel.velocity) > VELOCITY_THRESHOLD) return true;
  for (const item of Object.values(items)) {
    if (
      Math.abs(item.x.velocity) > VELOCITY_THRESHOLD ||
      Math.abs(item.y.velocity) > VELOCITY_THRESHOLD ||
      Math.abs(item.scale.logVelocity) > LOG_VELOCITY_THRESHOLD
    ) {
      return true;
    }
  }
  return false;
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

function makeItemTargets(
  itemIds: readonly string[],
): Record<string, { x: number; y: number; scale: number }> {
  const targets: Record<string, { x: number; y: number; scale: number }> = {};
  for (const id of itemIds) {
    targets[id] = { x: 0, y: 0, scale: 1 };
  }
  return targets;
}

function isCarouselSettled(carousel: LinearPrimitive, target: number): boolean {
  return Math.abs(carousel.value - target) < SNAP_THRESHOLD;
}

function areItemsSettled(
  items: Record<string, ItemTransform>,
  targets: Record<string, { x: number; y: number; scale: number }>,
): boolean {
  for (const [id, item] of Object.entries(items)) {
    const target = targets[id];
    if (!target) continue;
    if (
      Math.abs(item.x.value - target.x) >= SNAP_THRESHOLD ||
      Math.abs(item.y.value - target.y) >= SNAP_THRESHOLD ||
      Math.abs(item.scale.value - target.scale) >= SCALE_SNAP_THRESHOLD
    ) {
      return false;
    }
  }
  return true;
}

function advanceInertia(
  carousel: LinearPrimitive,
  items: Record<string, ItemTransform>,
  timestamp: number,
): { carousel: LinearPrimitive; items: Record<string, ItemTransform> } {
  const newItems: Record<string, ItemTransform> = {};
  for (const [id, item] of Object.entries(items)) {
    newItems[id] = {
      x: advanceLinearInertia(item.x, timestamp),
      y: advanceLinearInertia(item.y, timestamp),
      scale: advanceExponentialInertia(item.scale, timestamp),
    };
  }
  return {
    carousel: advanceLinearInertia(carousel, timestamp),
    items: newItems,
  };
}

function advanceSpring(
  carousel: LinearPrimitive,
  carouselTarget: number,
  items: Record<string, ItemTransform>,
  itemTargets: Record<string, { x: number; y: number; scale: number }>,
  timestamp: number,
): { carousel: LinearPrimitive; items: Record<string, ItemTransform> } {
  const newItems: Record<string, ItemTransform> = {};
  for (const [id, item] of Object.entries(items)) {
    const target = itemTargets[id] ?? { x: 0, y: 0, scale: 1 };
    newItems[id] = {
      x: advanceLinearSpring(item.x, target.x, timestamp),
      y: advanceLinearSpring(item.y, target.y, timestamp),
      scale: advanceExponentialSpring(item.scale, target.scale, timestamp),
    };
  }
  return {
    carousel: advanceLinearSpring(carousel, carouselTarget, timestamp),
    items: newItems,
  };
}

/** Snap carousel and all items exactly to their target values. */
function settleToTargets(
  carouselTarget: number,
  items: Record<string, ItemTransform>,
  itemTargets: Record<string, { x: number; y: number; scale: number }>,
  timestamp: number,
): { carousel: LinearPrimitive; items: Record<string, ItemTransform> } {
  const settledItems: Record<string, ItemTransform> = {};
  for (const [id] of Object.entries(items)) {
    const target = itemTargets[id] ?? { x: 0, y: 0, scale: 1 };
    settledItems[id] = {
      x: { value: target.x, velocity: 0, lastUpdatedAt: timestamp },
      y: { value: target.y, velocity: 0, lastUpdatedAt: timestamp },
      scale: { value: target.scale, logVelocity: 0, lastUpdatedAt: timestamp },
    };
  }
  return {
    carousel: { value: carouselTarget, velocity: 0, lastUpdatedAt: timestamp },
    items: settledItems,
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

  /**
   * Handles a motion event for any phase that transitions to / stays in tracking.
   * Returns the updated carousel and items, dispatching item-level motions with
   * overflow pan redirected to the carousel strip.
   * Returns null when the event carries an unknown itemId — the caller should
   * treat this as a no-op and return the current state unchanged.
   */
  function applyMotion(
    carousel: LinearPrimitive,
    items: Record<string, ItemTransform>,
    action: MotionEvent,
  ): {
    carousel: LinearPrimitive;
    items: Record<string, ItemTransform>;
  } | null {
    if (action.itemId !== undefined) {
      const item = items[action.itemId];
      // Unknown item ID — signal no-op to the caller.
      if (!item) return null;

      const { item: newItem, overflowDx } = applyMotionToItem(
        item,
        action,
        itemWidth,
        itemHeight,
      );
      const newCarousel =
        overflowDx !== 0
          ? applyLinearDelta(carousel, overflowDx, action.timestamp)
          : carousel;
      return {
        carousel: newCarousel,
        items: { ...items, [action.itemId]: newItem },
      };
    }
    return {
      carousel: applyMotionToCarousel(carousel, action),
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
      case "tracking": {
        switch (action.type) {
          case "motion": {
            const result = applyMotion(state.carousel, state.items, action);
            if (!result) return state;
            return { ...state, carousel: result.carousel, items: result.items };
          }
          case "release": {
            const carouselTarget = computeCarouselSnapTarget(
              state.carousel.value,
              itemWidth,
              itemIds.length,
            );
            return {
              ...state,
              type: "snapping",
              carouselTarget,
              itemTargets: makeItemTargets(itemIds),
            };
          }
          case "tick":
            return state;
        }
        throw new Error("unreachable");
      }
      case "inertia": {
        switch (action.type) {
          case "motion": {
            const result = applyMotion(state.carousel, state.items, action);
            if (!result) return state;
            return {
              ...state,
              type: "tracking",
              carousel: result.carousel,
              items: result.items,
            };
          }
          case "release": {
            const carouselTarget = computeCarouselSnapTarget(
              state.carousel.value,
              itemWidth,
              itemIds.length,
            );
            return {
              ...state,
              type: "snapping",
              carouselTarget,
              itemTargets: makeItemTargets(itemIds),
            };
          }
          case "tick": {
            if (hasSignificantVelocity(state.carousel, state.items)) {
              const { carousel, items } = advanceInertia(
                state.carousel,
                state.items,
                action.timestamp,
              );
              return { ...state, carousel, items };
            }
            const carouselTarget = computeCarouselSnapTarget(
              state.carousel.value,
              itemWidth,
              itemIds.length,
            );
            const itemTargets = makeItemTargets(itemIds);
            if (
              isCarouselSettled(state.carousel, carouselTarget) &&
              areItemsSettled(state.items, itemTargets)
            ) {
              const { carousel, items } = settleToTargets(
                carouselTarget,
                state.items,
                itemTargets,
                action.timestamp,
              );
              return { type: "settled", carousel, items };
            }
            return { ...state, type: "snapping", carouselTarget, itemTargets };
          }
        }
        throw new Error("unreachable");
      }
      case "snapping": {
        switch (action.type) {
          case "motion": {
            const result = applyMotion(state.carousel, state.items, action);
            if (!result) return state;
            return {
              type: "tracking",
              carousel: result.carousel,
              items: result.items,
            };
          }
          case "release":
            return state;
          case "tick": {
            const { carouselTarget, itemTargets } = state;
            if (
              isCarouselSettled(state.carousel, carouselTarget) &&
              areItemsSettled(state.items, itemTargets)
            ) {
              const { carousel, items } = settleToTargets(
                carouselTarget,
                state.items,
                itemTargets,
                action.timestamp,
              );
              return { type: "settled", carousel, items };
            }
            const { carousel, items } = advanceSpring(
              state.carousel,
              carouselTarget,
              state.items,
              itemTargets,
              action.timestamp,
            );
            return { ...state, carousel, items };
          }
        }
        throw new Error("unreachable");
      }
      case "settled": {
        switch (action.type) {
          case "motion": {
            const result = applyMotion(state.carousel, state.items, action);
            if (!result) return state;
            return {
              type: "tracking",
              carousel: result.carousel,
              items: result.items,
            };
          }
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
