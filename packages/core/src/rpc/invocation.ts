import { ArxReasons, arxError } from "@arx/errors";
import { getChainRefNamespace, normalizeChainRef, parseChainRef } from "../chains/caip.js";
import type { ChainRef } from "../chains/ids.js";
import type { PermissionCapability, PermissionCapabilityResolver } from "../controllers/permission/types.js";
import type { HandlerControllers, MethodDefinition, Namespace, RpcInvocationContext } from "./handlers/types.js";
import type { RpcPassthroughPolicy } from "./RpcRegistry.js";

export type RpcPassthroughAllowance = {
  isPassthrough: boolean;
  allowWhenLocked: boolean;
};

export type ResolvedRpcInvocation = {
  namespace: Namespace;
  chainRef: ChainRef;
};

export type ResolvedRpcInvocationDetails = ResolvedRpcInvocation & {
  definition: MethodDefinition | undefined;
  passthrough: RpcPassthroughAllowance;
};

type RpcInvocationCatalog = {
  hasNamespace(namespace: Namespace): boolean;
  getMethodDefinition(namespace: Namespace, method: string): MethodDefinition | undefined;
  resolveNamespaceFromMethodPrefix(method: string): Namespace | null;
  getPassthroughPolicy(namespace: Namespace): RpcPassthroughPolicy | null;
};

const namespaceFromChainRef = (chainRef: string | null | undefined): Namespace | null => {
  if (!chainRef) {
    return null;
  }

  const [namespace] = chainRef.split(":");
  return namespace ? (namespace as Namespace) : null;
};

const deriveRegisteredNamespaceFromCandidate = (
  catalog: RpcInvocationCatalog,
  candidate: string | null | undefined,
): Namespace | null => {
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const [prefix] = trimmed.split(":");
  const normalized = (prefix || trimmed) as Namespace;
  return catalog.hasNamespace(normalized) ? normalized : null;
};

const deriveNamespacePrefixFromCandidate = (candidate: string | null | undefined): string | null => {
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const [prefix] = trimmed.split(":");
  return prefix || trimmed;
};

const deriveInvocationNamespace = (
  catalog: RpcInvocationCatalog,
  method: string,
  context?: RpcInvocationContext,
): Namespace | null => {
  if (context?.namespace) {
    const normalized = deriveRegisteredNamespaceFromCandidate(catalog, context.namespace);
    if (normalized) return normalized;
  }

  const fromChain = namespaceFromChainRef(context?.chainRef ?? null);
  if (fromChain && catalog.hasNamespace(fromChain)) {
    return fromChain;
  }

  const fromMethod = catalog.resolveNamespaceFromMethodPrefix(method);
  if (fromMethod && catalog.hasNamespace(fromMethod)) {
    return fromMethod;
  }

  if (context?.providerNamespace) {
    const normalized = deriveRegisteredNamespaceFromCandidate(catalog, context.providerNamespace);
    if (normalized) return normalized;
  }

  return null;
};

const resolveInvocationNamespace = (
  catalog: RpcInvocationCatalog,
  method: string,
  context?: RpcInvocationContext,
): Namespace => {
  const namespace = deriveInvocationNamespace(catalog, method, context);
  if (namespace) {
    return namespace;
  }

  throw arxError({
    reason: ArxReasons.RpcInvalidRequest,
    message: method ? `Missing namespace context for "${method}"` : "Missing namespace context",
    data: {
      ...(method ? { method } : {}),
      ...(context?.namespace ? { contextNamespace: context.namespace } : {}),
      ...(context?.chainRef ? { chainRef: context.chainRef } : {}),
      ...(context?.providerNamespace ? { providerNamespace: context.providerNamespace } : {}),
    },
  });
};

const parseOptionalInvocationChainRef = (
  method: string,
  namespace: Namespace,
  raw: unknown,
): { kind: "present"; value: ChainRef } | { kind: "absent" } => {
  if (raw === undefined || raw === null) {
    return { kind: "absent" };
  }

  if (typeof raw !== "string") {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: "Invalid chainRef identifier",
      data: { method, namespace, chainRef: raw },
    });
  }

  const trimmed = raw.trim();
  try {
    return { kind: "present", value: normalizeChainRef(trimmed as ChainRef) };
  } catch (error) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: "Invalid chainRef identifier",
      data: { method, namespace, chainRef: raw },
      cause: error,
    });
  }
};

const assertInvocationContextNamespaceConsistency = (method: string, context?: RpcInvocationContext) => {
  const contextNamespace = deriveNamespacePrefixFromCandidate(context?.namespace);
  const contextChainNamespace = typeof context?.chainRef === "string" ? context.chainRef.split(":")[0] : null;
  const providerNamespace = deriveNamespacePrefixFromCandidate(context?.providerNamespace);

  if (contextNamespace && contextChainNamespace && contextNamespace !== contextChainNamespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Namespace mismatch: namespace="${contextNamespace}" chainRef="${context?.chainRef}"`,
      data: { method, namespace: contextNamespace, chainRef: context?.chainRef ?? null },
    });
  }

  if (providerNamespace && contextNamespace && providerNamespace !== contextNamespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Namespace mismatch: providerNamespace="${providerNamespace}" namespace="${contextNamespace}"`,
      data: { method, providerNamespace, namespace: contextNamespace },
    });
  }

  if (providerNamespace && contextChainNamespace && providerNamespace !== contextChainNamespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Namespace mismatch: providerNamespace="${providerNamespace}" chainRef="${context?.chainRef}"`,
      data: { method, providerNamespace, chainRef: context?.chainRef ?? null },
    });
  }
};

const resolveInvocationChainRef = (args: {
  method: string;
  namespace: Namespace;
  contextChainRef: unknown;
  namespaceActiveChainRef: ChainRef | null;
}): ChainRef => {
  const parsed = parseOptionalInvocationChainRef(args.method, args.namespace, args.contextChainRef);
  if (parsed.kind === "present") {
    return parsed.value;
  }

  if (!args.namespaceActiveChainRef) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Missing chainRef for namespace "${args.namespace}"`,
      data: { method: args.method, namespace: args.namespace, namespaceActiveChainRef: null },
    });
  }

  return args.namespaceActiveChainRef;
};

const assertInvocationChainRefMatchesNamespace = (method: string, namespace: Namespace, chainRef: ChainRef) => {
  try {
    parseChainRef(chainRef);
  } catch (error) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: "Invalid chainRef identifier",
      data: { method, namespace, chainRef },
      cause: error,
    });
  }

  const chainNamespace = getChainRefNamespace(chainRef);
  if (chainNamespace !== namespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Namespace mismatch for "${method}"`,
      data: { method, namespace, chainRef },
    });
  }
};

const toPassthroughAllowance = (policy: RpcPassthroughPolicy | null, method: string): RpcPassthroughAllowance => {
  if (!policy) {
    return { isPassthrough: false, allowWhenLocked: false };
  }

  const isPassthrough = policy.allowedMethods.has(method);
  return {
    isPassthrough,
    allowWhenLocked: isPassthrough && policy.allowWhenLocked.has(method),
  };
};

export const resolveRpcInvocation = (
  catalog: RpcInvocationCatalog,
  controllers: HandlerControllers,
  method: string,
  context?: RpcInvocationContext,
): ResolvedRpcInvocation => {
  assertInvocationContextNamespaceConsistency(method, context);

  const namespace = resolveInvocationNamespace(catalog, method, context);
  const namespaceActiveChainRef = controllers.networkPreferences.getActiveChainRef(namespace);
  const chainRef = resolveInvocationChainRef({
    method,
    namespace,
    contextChainRef: context?.chainRef,
    namespaceActiveChainRef,
  });
  assertInvocationChainRefMatchesNamespace(method, namespace, chainRef);

  return { namespace, chainRef };
};

export const resolveRpcInvocationDetails = (
  catalog: RpcInvocationCatalog,
  controllers: HandlerControllers,
  method: string,
  context?: RpcInvocationContext,
): ResolvedRpcInvocationDetails => {
  const { namespace, chainRef } = resolveRpcInvocation(catalog, controllers, method, context);

  return {
    namespace,
    chainRef,
    definition: catalog.getMethodDefinition(namespace, method),
    passthrough: toPassthroughAllowance(catalog.getPassthroughPolicy(namespace), method),
  };
};

export const createRpcMethodNamespaceResolver = (catalog: RpcInvocationCatalog) => {
  return (method: string, context?: RpcInvocationContext): Namespace | null => {
    return deriveInvocationNamespace(catalog, method, context);
  };
};

export const createRpcContextNamespaceResolver = (catalog: RpcInvocationCatalog) => {
  return (context?: RpcInvocationContext): Namespace | null => {
    return deriveInvocationNamespace(catalog, "", context);
  };
};

export const createRpcPermissionCapabilityResolver = (
  catalog: RpcInvocationCatalog,
  namespaceResolver: (method: string, context?: RpcInvocationContext) => Namespace | null,
  overrides?: Partial<Record<string, PermissionCapability | null>>,
): PermissionCapabilityResolver => {
  return (method, context) => {
    if (overrides && Object.hasOwn(overrides, method)) {
      const value = overrides[method];
      return value === null ? undefined : value;
    }

    const namespace = namespaceResolver(method, context);
    if (!namespace) {
      return undefined;
    }

    return catalog.getMethodDefinition(namespace, method)?.capability;
  };
};
