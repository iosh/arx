import type { Caip2ChainId } from "../chains/ids.js";
import type { PermissionScope, PermissionScopeResolver } from "../controllers/index.js";
import type { NamespaceAdapter } from "./handlers/namespaces/index.js";
import { createEip155Adapter, EIP155_NAMESPACE } from "./handlers/namespaces/index.js";
import type {
  HandlerControllers,
  MethodDefinition,
  Namespace,
  RpcInvocationContext,
  RpcRequest,
} from "./handlers/types.js";

type NamespaceDefinitions = Record<string, MethodDefinition>;

export const DEFAULT_NAMESPACE: Namespace = EIP155_NAMESPACE;

const namespaceDefinitions = new Map<Namespace, NamespaceDefinitions>();
const namespacePrefixes = new Map<string, Namespace>();

const namespaceAdapters = new Map<Namespace, NamespaceAdapter>();

export const registerNamespaceAdapter = (adapter: NamespaceAdapter, options?: { replace?: boolean }): void => {
  registerNamespaceDefinitions(adapter.namespace, adapter.definitions, {
    replace: options?.replace ?? true,
    methodPrefixes: adapter.methodPrefixes ?? [],
  });
  namespaceAdapters.set(adapter.namespace, adapter);
};

export const unregisterNamespaceAdapter = (namespace: Namespace): void => {
  namespaceAdapters.delete(namespace);
  unregisterNamespaceDefinitions(namespace);
};

export const getRegisteredNamespaceAdapters = (): NamespaceAdapter[] => [...namespaceAdapters.values()];

const cloneDefinitions = (definitions: NamespaceDefinitions): NamespaceDefinitions => ({ ...definitions });

const getDefinitionsForNamespace = (namespace: Namespace): NamespaceDefinitions | undefined => {
  return namespaceDefinitions.get(namespace);
};

const recordPrefixesForNamespace = (namespace: Namespace, prefixes?: string[] | undefined) => {
  if (!prefixes || prefixes.length === 0) {
    return;
  }

  // Remove existing prefixes pointing to this namespace to avoid stale entries.
  for (const [prefix, currentNamespace] of namespacePrefixes) {
    if (currentNamespace === namespace) {
      namespacePrefixes.delete(prefix);
    }
  }

  for (const prefix of prefixes) {
    if (!prefix || namespacePrefixes.has(prefix)) {
      if (namespacePrefixes.has(prefix)) {
        console.warn(
          `[rpc] method prefix "${prefix}" already registered for namespace "${namespacePrefixes.get(prefix)}", skipping duplicate entry for "${namespace}"`,
        );
      }
      continue;
    }
    namespacePrefixes.set(prefix, namespace);
  }
};

/**
 * Registers method definitions for a namespace and (optionally) associates method
 * prefixes for fast namespace inference.
 *
 * - When `replace` is true (default) the namespace definitions are replaced.
 * - When `replace` is false the provided definitions are merged with existing ones.
 * - Method prefixes are matched in declaration order; the first match wins.
 *   Prefixes should therefore be unique to avoid ambiguity.
 */
export const registerNamespaceDefinitions = (
  namespace: Namespace,
  definitions: NamespaceDefinitions,
  options?: { replace?: boolean; methodPrefixes?: string[] },
): void => {
  const existing = namespaceDefinitions.get(namespace);
  const shouldReplace = options?.replace ?? true;
  const next = shouldReplace || !existing ? cloneDefinitions(definitions) : { ...existing, ...definitions };
  namespaceDefinitions.set(namespace, next);
  recordPrefixesForNamespace(namespace, options?.methodPrefixes);
};

export const unregisterNamespaceDefinitions = (namespace: Namespace): void => {
  namespaceDefinitions.delete(namespace);

  for (const [prefix, currentNamespace] of namespacePrefixes) {
    if (currentNamespace === namespace) {
      namespacePrefixes.delete(prefix);
    }
  }
};

export const getRegisteredNamespaces = (): Namespace[] => [...namespaceDefinitions.keys()];

const resolveNamespaceFromChainRef = (chainRef: string | null | undefined): Namespace | null => {
  if (!chainRef) {
    return null;
  }
  const [namespace] = chainRef.split(":");
  return namespace ? (namespace as Namespace) : null;
};

const resolveNamespaceFromMethod = (method: string): Namespace | null => {
  for (const [prefix, namespace] of namespacePrefixes) {
    if (method.startsWith(prefix)) {
      return namespace;
    }
  }
  return null;
};

const selectNamespace = (
  controllers: HandlerControllers,
  method: string,
  context?: RpcInvocationContext,
): Namespace => {
  if (context?.namespace && namespaceDefinitions.has(context.namespace)) {
    return context.namespace;
  }

  const fromChain = resolveNamespaceFromChainRef(context?.chainRef ?? null);
  if (fromChain && namespaceDefinitions.has(fromChain)) {
    return fromChain;
  }

  const fromMethod = resolveNamespaceFromMethod(method);
  if (fromMethod && namespaceDefinitions.has(fromMethod)) {
    return fromMethod;
  }

  const activeChain = controllers.network.getActiveChain();
  const [activeNamespace] = activeChain.chainRef.split(":");
  if (activeNamespace && namespaceDefinitions.has(activeNamespace)) {
    return activeNamespace as Namespace;
  }

  return DEFAULT_NAMESPACE;
};

export const createMethodDefinitionResolver = (controllers: HandlerControllers) => {
  return (method: string, context?: RpcInvocationContext) => {
    const namespace = selectNamespace(controllers, method, context);
    return getDefinitionsForNamespace(namespace)?.[method];
  };
};

export const createNamespaceResolver =
  (controllers: HandlerControllers) =>
  (context?: RpcInvocationContext): Namespace => {
    return selectNamespace(controllers, "rpc_method_unused", context);
  };

export const createPermissionScopeResolver = (
  namespaceResolver: (context?: RpcInvocationContext) => Namespace,
  overrides?: Partial<Record<string, PermissionScope | null>>,
): PermissionScopeResolver => {
  return (method, context) => {
    if (overrides && Object.hasOwn(overrides, method)) {
      const value = overrides[method];
      return value === null ? undefined : value;
    }
    const namespace = namespaceResolver(context);
    return getDefinitionsForNamespace(namespace)?.[method]?.scope;
  };
};

export const createMethodExecutor =
  (controllers: HandlerControllers) =>
  async ({ origin, request, context }: { origin: string; request: RpcRequest; context?: RpcInvocationContext }) => {
    const namespace = selectNamespace(controllers, request.method, context);
    const definition = getDefinitionsForNamespace(namespace)?.[request.method];
    if (!definition) {
      throw new Error(`Method "${request.method}" not implemented for namespace "${namespace}"`);
    }
    const handlerArgs =
      context === undefined ? { origin, request, controllers } : { origin, request, controllers, rpcContext: context };

    return definition.handler(handlerArgs);
  };

export type DomainChainService = {
  setDomainChain(origin: string, caip2: Caip2ChainId): Promise<void>;
  getDomainChain(origin: string): Promise<Caip2ChainId | null>;
};

export const createDomainChainService = (): DomainChainService => ({
  async setDomainChain() {
    throw new Error("Not implemented yet");
  },
  async getDomainChain() {
    throw new Error("Not implemented yet");
  },
});

const EIP155_ADAPTER = createEip155Adapter();
registerNamespaceAdapter(EIP155_ADAPTER);

export type { RpcInvocationContext };
