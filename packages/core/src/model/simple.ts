import type { State, StoreAction, Model } from "../types.js";
import {
  type TransformPrivateState,
  type TransformConfig,
  createTransformReduce,
} from "./transform.js";

export type { TransformPrivateState, TransformConfig };

function toPublicState({ transform }: TransformPrivateState): State {
  return {
    transformX: transform.x.value,
    transformY: transform.y.value,
    scale: transform.scale.value,
  };
}

export function createModel(
  config?: TransformConfig,
): Model<State, TransformPrivateState, StoreAction> {
  return { reduce: createTransformReduce(config), publish: toPublicState };
}
