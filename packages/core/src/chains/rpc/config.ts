import type { RpcEndpoint } from "../definition.js";
import { ChainRpcAccessConfigError } from "../errors.js";
import type { ChainRef } from "../ids.js";
import type { ChainRpcAccess, NonEmptyRpcEndpoints } from "./types.js";

export const cloneNonEmptyRpcEndpoints = (endpoints: NonEmptyRpcEndpoints): NonEmptyRpcEndpoints => {
  return structuredClone(endpoints) as NonEmptyRpcEndpoints;
};

export const assertNonEmptyRpcEndpoints = (
  chainRef: ChainRef,
  endpoints: readonly RpcEndpoint[],
): NonEmptyRpcEndpoints => {
  const cloned = structuredClone(endpoints) as RpcEndpoint[];
  const first = cloned[0];
  if (!first) {
    throw new ChainRpcAccessConfigError({ chainRef, reason: "empty_endpoints" });
  }
  return [first, ...cloned.slice(1)];
};

export const cloneChainRpcAccess = (access: ChainRpcAccess): ChainRpcAccess => structuredClone(access);

const areHeadersEqual = (
  leftHeaders: Record<string, string> | undefined,
  rightHeaders: Record<string, string> | undefined,
): boolean => {
  const left = leftHeaders ?? {};
  const right = rightHeaders ?? {};
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
};

const areRpcEndpointEqual = (left: RpcEndpoint, right: RpcEndpoint): boolean =>
  left.url === right.url &&
  left.type === right.type &&
  left.weight === right.weight &&
  areHeadersEqual(left.headers, right.headers);

export const areRpcEndpointsEqual = (
  leftEndpoints: readonly RpcEndpoint[],
  rightEndpoints: readonly RpcEndpoint[],
): boolean => {
  if (leftEndpoints.length !== rightEndpoints.length) return false;
  for (let i = 0; i < leftEndpoints.length; i += 1) {
    const left = leftEndpoints[i];
    const right = rightEndpoints[i];
    if (!left || !right) return false;
    if (!areRpcEndpointEqual(left, right)) return false;
  }
  return true;
};
