import { ArxReasons, arxError, isArxError } from "@arx/errors";
import type { Caip2ChainId } from "../chains/ids.js";
import type { PermissionScope, PermissionScopeResolver } from "../controllers/index.js";

import { createLogger, extendLogger } from "../utils/logger.js";
import { createEip155ProtocolAdapter } from "./eip155ProtocolAdapter.js";
import type { NamespaceAdapter } from "./handlers/namespaces/index.js";
import { createEip155Adapter, EIP155_NAMESPACE } from "./handlers/namespaces/index.js";
import type {
  HandlerControllers,
  MethodDefinition,
  Namespace,
  RpcInvocationContext,
  RpcRequest,
} from "./handlers/types.js";
import { registerNamespaceProtocolAdapter } from "./protocolAdapterRegistry.js";
import type { RpcClientRegistry, RpcTransportRequest } from "./RpcClientRegistry.js";

export type {
  Eip155FeeData,
  Eip155RpcCapabilities,
  Eip155RpcClient,
} from "./clients/eip155/eip155.js";
export { createEip155RpcClientFactory } from "./clients/eip155/eip155.js";
export { encodeErrorWithAdapters, executeWithAdapters } from "./executeWithAdapters.js";
export { namespaceFromContext } from "./handlers/namespaces/utils.js";
export * from "./permissions.js";
export { getNamespaceProtocolAdapter, registerNamespaceProtocolAdapter } from "./protocolAdapterRegistry.js";
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

const rpcLogger = createLogger("core:rpc");
const passthroughLogger = extendLogger(rpcLogger, "passthrough");

type MethodExecutorDependencies = {
  rpcClientRegistry: RpcClientRegistry;
};

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

export const createMethodNamespaceResolver = (controllers: HandlerControllers) => {
  return (method: string, context?: RpcInvocationContext): Namespace => {
    return selectNamespace(controllers, method, context);
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
    const passthrough = adapter?.passthrough;
    if (!passthrough || !passthrough.allowedMethods.includes(request.method)) {
      throw arxError({
        reason: ArxReasons.RpcMethodNotFound,
        message: `Method "${request.method}" is not implemented`,
        data: { namespace, method: request.method },
      });
    }

    const chainRef = context?.chainRef ?? controllers.network.getActiveChain().chainRef;
    const [chainNamespace] = chainRef.split(":");
    if (chainNamespace && chainNamespace !== namespace) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: `Namespace mismatch for "${request.method}"`,
        data: { namespace, chainRef },
      });
    }

    const logMeta = {
      namespace,
      chainRef,
      method: request.method,
      origin: origin ?? "unknown://",
    };

    try {
      const client = deps.rpcClientRegistry.getClient(namespace, chainRef);
      const rpcPayload: RpcTransportRequest = { method: request.method };
      if (request.params !== undefined) {
        rpcPayload.params = request.params;
      }
      passthroughLogger("request", { ...logMeta, params: request.params ?? [] });
      const result = await client.request(rpcPayload);
      passthroughLogger("response", { ...logMeta });
      return result;
    } catch (error) {
      const errorSummary =
        error && typeof error === "object" && "code" in error
          ? {
              code: (error as { code?: number | string }).code,
              message: (error as { message?: string }).message ?? "RPC error",
            }
          : { message: (error as Error)?.message ?? String(error) };
      passthroughLogger("error", { ...logMeta, error: errorSummary });
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
      if (isArxError(error)) throw error;
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: `Failed to execute "${request.method}"`,
        data: { namespace, chainRef },
        cause: error,
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

const EIP155_PROTOCOL_ADAPTER = createEip155ProtocolAdapter();
registerNamespaceProtocolAdapter(EIP155_NAMESPACE, EIP155_PROTOCOL_ADAPTER);

export type { RpcInvocationContext };
