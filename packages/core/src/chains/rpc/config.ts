import type { ChainRef } from "../../networks/chainRef.js";
import type { NonEmptyRpcEndpoints, RpcEndpoint } from "../../networks/types.js";
import { ChainRpcAccessConfigError } from "../errors.js";
import type { ChainRpcAccess } from "./types.js";

export const cloneNonEmptyRpcEndpoints = (endpoints: NonEmptyRpcEndpoints): NonEmptyRpcEndpoints => {
  return [endpoints[0], ...endpoints.slice(1)];
};

export const assertNonEmptyRpcEndpoints = (
  chainRef: ChainRef,
  endpoints: readonly RpcEndpoint[],
): NonEmptyRpcEndpoints => {
  const first = endpoints[0];
  if (!first) {
    throw new ChainRpcAccessConfigError({ chainRef, reason: "empty_endpoints" });
  }
  return [first, ...endpoints.slice(1)];
};

export const cloneChainRpcAccess = (access: ChainRpcAccess): ChainRpcAccess => structuredClone(access);

export const areRpcEndpointsEqual = (
  leftEndpoints: readonly RpcEndpoint[],
  rightEndpoints: readonly RpcEndpoint[],
): boolean => {
  if (leftEndpoints.length !== rightEndpoints.length) return false;
  for (let i = 0; i < leftEndpoints.length; i += 1) {
    const left = leftEndpoints[i];
    const right = rightEndpoints[i];
    if (!left || !right) return false;
    if (left !== right) return false;
  }
  return true;
};
