import { getChainRefNamespace, normalizeChainRef, parseChainRef } from "../chains/caip.js";
import type { ChainRef } from "../chains/ids.js";
import { RpcInvalidRequestError } from "./errors.js";
import type { MethodDefinition, Namespace, RpcHandlerDeps, RpcInvocationHint } from "./handlers/types.js";
import {
  findRpcMethodDefinition,
  hasRpcNamespace,
  type RpcPassthroughPolicy,
  type RpcRouting,
  resolveRpcNamespaceFromMethod,
  rpcPassthroughPolicyForNamespace,
} from "./routing.js";

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

const namespaceFromChainRefHint = (chainRef: ChainRef | undefined): Namespace | null => {
  if (chainRef === undefined) return null;
  try {
    return getChainRefNamespace(chainRef);
  } catch {
    return null;
  }
};

const deriveInvocationNamespace = (routing: RpcRouting, method: string, hint?: RpcInvocationHint): Namespace | null => {
  if (hint?.namespace !== undefined) {
    return hasRpcNamespace(routing, hint.namespace) ? hint.namespace : null;
  }

  const fromChain = namespaceFromChainRefHint(hint?.chainRef);
  if (fromChain && hasRpcNamespace(routing, fromChain)) {
    return fromChain;
  }

  const fromMethod = resolveRpcNamespaceFromMethod(routing, method);
  if (fromMethod && hasRpcNamespace(routing, fromMethod)) {
    return fromMethod;
  }

  return null;
};

const resolveInvocationNamespace = (routing: RpcRouting, method: string, hint?: RpcInvocationHint): Namespace => {
  const namespace = deriveInvocationNamespace(routing, method, hint);
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
  } catch (_error) {
    throw new RpcInvalidRequestError({
      message: "Invalid chainRef identifier",
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
    } catch (_error) {
      throw new RpcInvalidRequestError({
        message: "Invalid chainRef identifier",
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
  } catch (_error) {
    throw new RpcInvalidRequestError({
      message: "Invalid chainRef identifier",
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
  routing: RpcRouting,
  handlerDeps: RpcHandlerDeps,
  method: string,
  hint?: RpcInvocationHint,
): ResolvedRpcInvocation => {
  assertInvocationHintConsistency(hint);

  const namespace = resolveInvocationNamespace(routing, method, hint);
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
  routing: RpcRouting,
  handlerDeps: RpcHandlerDeps,
  method: string,
  hint?: RpcInvocationHint,
): ResolvedRpcInvocationDetails => {
  const { namespace, chainRef } = resolveRpcInvocation(routing, handlerDeps, method, hint);

  return {
    namespace,
    chainRef,
    definition: findRpcMethodDefinition(routing, namespace, method),
    passthrough: toPassthroughAllowance(rpcPassthroughPolicyForNamespace(routing, namespace), method),
  };
};

export const createRpcMethodNamespaceResolver = (routing: RpcRouting) => {
  return (method: string, hint?: RpcInvocationHint): Namespace | null => {
    return deriveInvocationNamespace(routing, method, hint);
  };
};

export const createRpcHintNamespaceResolver = (routing: RpcRouting) => {
  return (hint?: RpcInvocationHint): Namespace | null => {
    return deriveInvocationNamespace(routing, "", hint);
  };
};
