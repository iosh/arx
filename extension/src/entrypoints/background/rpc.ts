import { parseChainRef } from "@arx/core";
import type { RpcInvocationContext } from "@arx/core/rpc";
import type { TransportMeta } from "@arx/provider/types";
import type { PortContext } from "./types";

export type ExtendedRpcContext = RpcInvocationContext & {
  meta: TransportMeta | null;
};

const normalizeNamespaceCandidate = (candidate: string | null | undefined): string | null => {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (trimmed.length === 0) return null;
  const [prefix] = trimmed.split(":");
  return prefix || trimmed;
};

const namespaceFromChainRefCandidate = (candidate: string | null | undefined): string | null => {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (trimmed.length === 0) return null;

  try {
    return parseChainRef(trimmed as never).namespace;
  } catch {
    return null;
  }
};

export const buildRpcContext = (
  portContext: PortContext | undefined,
  chainRef: string | null,
): ExtendedRpcContext | undefined => {
  if (!portContext) return undefined;
  const resolvedChainRef = chainRef ?? portContext.chainRef ?? null;
  const baseContext: RpcInvocationContext = {
    ...(portContext.providerNamespace ? { providerNamespace: portContext.providerNamespace } : {}),
    ...(resolvedChainRef ? { chainRef: resolvedChainRef } : {}),
  };
  return {
    ...baseContext,
    meta: portContext.meta,
  };
};

export const deriveRpcContextNamespace = (
  rpcContext: RpcInvocationContext | null | undefined,
  fallback: string | null = null,
): string | null => {
  const explicit = normalizeNamespaceCandidate(rpcContext?.namespace);
  if (explicit) {
    return explicit;
  }

  const fromChainRef = namespaceFromChainRefCandidate(rpcContext?.chainRef);
  if (fromChainRef) {
    return fromChainRef;
  }

  const providerBound = normalizeNamespaceCandidate(rpcContext?.providerNamespace);
  if (providerBound) {
    return providerBound;
  }

  return fallback;
};
