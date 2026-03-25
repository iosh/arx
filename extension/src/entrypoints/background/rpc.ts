import { parseChainRef } from "@arx/core";
import type { PortContext, ProviderBridgeRpcContext } from "./types";

export type ExtendedRpcContext = ProviderBridgeRpcContext;

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
  const baseContext: ProviderBridgeRpcContext = {
    ...(portContext.providerNamespace ? { providerNamespace: portContext.providerNamespace } : {}),
    ...(resolvedChainRef ? { chainRef: resolvedChainRef } : {}),
  };
  return baseContext;
};

export const deriveRpcContextNamespace = (
  rpcContext: ProviderBridgeRpcContext | null | undefined,
  fallback: string | null = null,
): string | null => {
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
