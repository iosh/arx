import { isArxError } from "@arx/errors";
import { getChainRefNamespace } from "../../../chains/caip.js";
import type { Namespace, RpcInvocationContext } from "../types.js";

export const createApprovalId = (_prefix: string) => {
  return globalThis.crypto.randomUUID();
};

export const isRpcError = (value: unknown): value is { code: number } =>
  Boolean(value && typeof value === "object" && "code" in (value as Record<string, unknown>));

export const isDomainError = isArxError;

/**
 * Extract namespace from RPC invocation context.
 * Priority: explicit namespace → chainRef prefix → undefined
 */
export const namespaceFromContext = (context?: RpcInvocationContext | null): Namespace | undefined => {
  if (!context) return undefined;
  if (context.namespace) {
    // Normalize "eip155:1" -> "eip155" so call sites don't need to care.
    const [candidate] = context.namespace.split(":");
    return (candidate || context.namespace) as Namespace;
  }
  if (context.chainRef) {
    try {
      return getChainRefNamespace(context.chainRef) as Namespace;
    } catch {
      return undefined;
    }
  }
  if (context.providerNamespace) {
    const [candidate] = context.providerNamespace.split(":");
    return (candidate || context.providerNamespace) as Namespace;
  }
  return undefined;
};

export const toParamsArray = (params: unknown): readonly unknown[] => {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
};
