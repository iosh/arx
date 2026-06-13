import { getChainRefNamespace, normalizeChainRef, parseChainRef } from "../chains/caip.js";
import type { ChainRef } from "../chains/ids.js";
import { RpcInvalidRequestError } from "./errors.js";
import type { MethodDefinition, Namespace, RpcHandlerDeps, RpcInvocationHint } from "./handlers/types.js";
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

const deriveInvocationNamespace = (
  catalog: RpcInvocationCatalog,
  method: string,
  hint?: RpcInvocationHint,
): Namespace | null => {
  if (hint?.namespace !== undefined) {
    return catalog.hasNamespace(hint.namespace) ? hint.namespace : null;
  }

  const fromChain = hint?.chainRef !== undefined ? getChainRefNamespace(hint.chainRef) : null;
  if (fromChain && catalog.hasNamespace(fromChain)) {
    return fromChain;
  }

  const fromMethod = catalog.resolveNamespaceFromMethodPrefix(method);
  if (fromMethod && catalog.hasNamespace(fromMethod)) {
    return fromMethod;
  }

  return null;
};

const resolveInvocationNamespace = (
  catalog: RpcInvocationCatalog,
  method: string,
  hint?: RpcInvocationHint,
): Namespace => {
  const namespace = deriveInvocationNamespace(catalog, method, hint);
  if (namespace) {
    return namespace;
  }

  throw new RpcInvalidRequestError({
    message: method ? `Missing namespace context for "${method}"` : "Missing namespace context",
  });
};

const parseOptionalInvocationChainRef = (raw: unknown): { kind: "present"; value: ChainRef } | { kind: "absent" } => {
  if (raw === undefined) {
    return { kind: "absent" };
  }

  if (typeof raw !== "string") {
    throw new RpcInvalidRequestError({
      message: "Invalid chainRef identifier",
    });
  }

  const trimmed = raw.trim();
  try {
    return { kind: "present", value: normalizeChainRef(trimmed as ChainRef) };
  } catch (error) {
    throw new RpcInvalidRequestError({
      message: "Invalid chainRef identifier",
      cause: error,
    });
  }
};

const assertInvocationHintConsistency = (hint?: RpcInvocationHint) => {
  const contextNamespace = hint?.namespace;
  const contextChainRef = hint?.chainRef;
  let contextChainNamespace: string | null = null;
  if (contextChainRef !== undefined) {
    try {
      contextChainNamespace = getChainRefNamespace(contextChainRef);
    } catch (error) {
      throw new RpcInvalidRequestError({
        message: "Invalid chainRef identifier",
        cause: error,
      });
    }
  }

  if (contextNamespace && contextChainNamespace && contextNamespace !== contextChainNamespace) {
    throw new RpcInvalidRequestError({
      message: `Namespace mismatch: namespace="${contextNamespace}" chainRef="${contextChainRef ?? ""}"`,
    });
  }
};

const resolveInvocationChainRef = (args: {
  method: string;
  namespace: Namespace;
  contextChainRef: unknown;
  namespaceActiveChainRef: ChainRef | null;
}): ChainRef => {
  const parsed = parseOptionalInvocationChainRef(args.contextChainRef);
  if (parsed.kind === "present") {
    return parsed.value;
  }

  if (!args.namespaceActiveChainRef) {
    throw new RpcInvalidRequestError({
      message: `Missing chainRef for namespace "${args.namespace}"`,
    });
  }

  return args.namespaceActiveChainRef;
};

const assertInvocationChainRefMatchesNamespace = (method: string, namespace: Namespace, chainRef: ChainRef) => {
  try {
    parseChainRef(chainRef);
  } catch (error) {
    throw new RpcInvalidRequestError({
      message: "Invalid chainRef identifier",
      cause: error,
    });
  }

  const chainNamespace = getChainRefNamespace(chainRef);
  if (chainNamespace !== namespace) {
    throw new RpcInvalidRequestError({
      message: `Namespace mismatch for "${method}"`,
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
  handlerDeps: RpcHandlerDeps,
  method: string,
  hint?: RpcInvocationHint,
): ResolvedRpcInvocation => {
  assertInvocationHintConsistency(hint);

  const namespace = resolveInvocationNamespace(catalog, method, hint);
  const namespaceActiveChainRef = handlerDeps.walletChainSelection.getSelectedChainRef(namespace);
  const chainRef = resolveInvocationChainRef({
    method,
    namespace,
    contextChainRef: hint?.chainRef,
    namespaceActiveChainRef,
  });
  assertInvocationChainRefMatchesNamespace(method, namespace, chainRef);

  return { namespace, chainRef };
};

export const resolveRpcInvocationDetails = (
  catalog: RpcInvocationCatalog,
  handlerDeps: RpcHandlerDeps,
  method: string,
  hint?: RpcInvocationHint,
): ResolvedRpcInvocationDetails => {
  const { namespace, chainRef } = resolveRpcInvocation(catalog, handlerDeps, method, hint);

  return {
    namespace,
    chainRef,
    definition: catalog.getMethodDefinition(namespace, method),
    passthrough: toPassthroughAllowance(catalog.getPassthroughPolicy(namespace), method),
  };
};

export const createRpcMethodNamespaceResolver = (catalog: RpcInvocationCatalog) => {
  return (method: string, hint?: RpcInvocationHint): Namespace | null => {
    return deriveInvocationNamespace(catalog, method, hint);
  };
};

export const createRpcHintNamespaceResolver = (catalog: RpcInvocationCatalog) => {
  return (hint?: RpcInvocationHint): Namespace | null => {
    return deriveInvocationNamespace(catalog, "", hint);
  };
};
