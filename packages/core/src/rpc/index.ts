import type { Caip2ChainId } from "../chains/ids.js";
import type { PermissionScope, PermissionScopeResolver } from "../controllers/index.js";
import { getRpcErrors, registerChainErrorFactory, unregisterChainErrorFactory } from "../errors/index.js";
import type { NamespaceAdapter } from "./handlers/namespaces/index.js";
import { createEip155Adapter, EIP155_NAMESPACE } from "./handlers/namespaces/index.js";
import type {
  HandlerControllers,
  MethodDefinition,
  Namespace,
  RpcInvocationContext,
  RpcRequest,
} from "./handlers/types.js";
import type { RpcClientRegistry, RpcTransportRequest } from "./RpcClientRegistry.js";

export type {
  Eip155FeeData,
  Eip155RpcCapabilities,
  Eip155RpcClient,
} from "./clients/eip155/eip155.js";
export { createEip155RpcClientFactory } from "./clients/eip155/eip155.js";
export { namespaceFromContext } from "./handlers/namespaces/utils.js";
export {
  type RpcClient,
  type RpcClientFactory,
  RpcClientRegistry,
  type RpcClientRegistryOptions,
  type RpcTransport,
  type RpcTransportRequest,
} from "./RpcClientRegistry.js";

type NamespaceDefinitions = Record<string, MethodDefinition>;

export const DEFAULT_NAMESPACE: Namespace = EIP155_NAMESPACE;

const namespaceDefinitions = new Map<Namespace, NamespaceDefinitions>();
const namespacePrefixes = new Map<string, Namespace>();

const namespaceAdapters = new Map<Namespace, NamespaceAdapter>();

type MethodExecutorDependencies = {
  rpcClientRegistry: RpcClientRegistry;
};

export const registerNamespaceAdapter = (adapter: NamespaceAdapter, options?: { replace?: boolean }): void => {
  registerNamespaceDefinitions(adapter.namespace, adapter.definitions, {
    replace: options?.replace ?? true,
    methodPrefixes: adapter.methodPrefixes ?? [],
  });
  const previous = namespaceAdapters.get(adapter.namespace);
  namespaceAdapters.set(adapter.namespace, adapter);

  if (adapter.errors) {
    registerChainErrorFactory(adapter.namespace, adapter.errors);
  } else if (previous?.errors && (options?.replace ?? true)) {
    unregisterChainErrorFactory(adapter.namespace);
  }
};

export const unregisterNamespaceAdapter = (namespace: Namespace): void => {
  const existing = namespaceAdapters.get(namespace);
  namespaceAdapters.delete(namespace);
  unregisterNamespaceDefinitions(namespace);
  if (existing?.errors) {
    unregisterChainErrorFactory(namespace);
  }
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
  (controllers: HandlerControllers, deps: MethodExecutorDependencies) =>
  async ({ origin, request, context }: { origin: string; request: RpcRequest; context?: RpcInvocationContext }) => {
    const namespace = selectNamespace(controllers, request.method, context);
    const definition = getDefinitionsForNamespace(namespace)?.[request.method];
    if (definition) {
      const handlerArgs =
        context === undefined
          ? { origin, request, controllers }
          : { origin, request, controllers, rpcContext: context };
      return definition.handler(handlerArgs);
    }

    const adapter = namespaceAdapters.get(namespace);
    const rpcErrors = context?.errors?.rpc ?? adapter?.errors?.rpc ?? getRpcErrors(namespace);
    const passthrough = adapter?.passthrough;
    if (!passthrough || !passthrough.allowedMethods.includes(request.method)) {
      throw rpcErrors.methodNotFound({
        message: `Method "${request.method}" is not implemented`,
        data: { namespace, method: request.method },
      });
    }

    const chainRef = context?.chainRef ?? controllers.network.getActiveChain().chainRef;
    const [chainNamespace] = chainRef.split(":");
    if (chainNamespace && chainNamespace !== namespace) {
      throw rpcErrors.invalidRequest({
        message: `Namespace mismatch for "${request.method}"`,
        data: { namespace, chainRef },
      });
    }

    try {
      const client = deps.rpcClientRegistry.getClient(namespace, chainRef);
      const rpcPayload: RpcTransportRequest = { method: request.method };
      if (request.params !== undefined) {
        rpcPayload.params = request.params;
      }
      return await client.request(rpcPayload);
    } catch (error) {
      // If it's already a properly formatted RPC error from the node
      if (error && typeof error === "object" && "code" in error) {
        const rpcError = error as { code: number; message?: string; data?: unknown };
        // Sanitize error.data to remove internal fields like stack, path
        if (rpcError.data && typeof rpcError.data === "object") {
          const sanitized = { ...rpcError.data } as Record<string, unknown>;
          delete sanitized.stack;
          delete sanitized.path;
          throw { ...rpcError, data: sanitized };
        }
        throw error;
      }
      throw rpcErrors.internal({
        message: `Failed to execute "${request.method}"`,
        data: { namespace, chainRef },
      });
    }
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
