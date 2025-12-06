import {
  type ChainErrorFactory,
  createEvmProviderErrors,
  createEvmRpcErrors,
  type ProviderErrorFactory,
  type RpcErrorFactory,
} from "./factories.js";

export type {
  ChainErrorFactory,
  ProviderErrorFactory,
  ProviderErrorInstance,
  RpcErrorFactory,
  RpcErrorInstance,
} from "./factories.js";
export { keyringErrors } from "./keyring.js";
export { vaultErrors } from "./vault.js";

const DEFAULT_NAMESPACE = "eip155";

export const evmRpcErrors = createEvmRpcErrors();
export const evmProviderErrors = createEvmProviderErrors();

const DEFAULT_CHAIN_ERRORS: ChainErrorFactory = {
  rpc: evmRpcErrors,
  provider: evmProviderErrors,
};

/**
 * Chain error factory registry with fallback mechanism.
 *
 * Priority:
 * 1. Exact namespace match (e.g., "eip155")
 * 2. CAIP namespace prefix (e.g., "eip155:1" → "eip155")
 * 3. Default namespace fallback (EVM)
 *
 * Note: Namespace adapters should declare their errors directly.
 * This registry serves as a global fallback for backward compatibility.
 */
const factories = new Map<string, ChainErrorFactory>([[DEFAULT_NAMESPACE, DEFAULT_CHAIN_ERRORS]]);

const resolveFactory = (namespace?: string): ChainErrorFactory | undefined => {
  if (!namespace) {
    return factories.get(DEFAULT_NAMESPACE);
  }

  if (factories.has(namespace)) {
    return factories.get(namespace);
  }

  const [caipNamespace] = namespace.split(":");
  if (caipNamespace && factories.has(caipNamespace)) {
    return factories.get(caipNamespace);
  }

  return factories.get(DEFAULT_NAMESPACE);
};

export const registerChainErrorFactory = (namespace: string, factory: ChainErrorFactory): void => {
  factories.set(namespace, factory);
};

export const unregisterChainErrorFactory = (namespace: string): void => {
  if (namespace === DEFAULT_NAMESPACE) {
    factories.set(namespace, DEFAULT_CHAIN_ERRORS);
    return;
  }
  factories.delete(namespace);
};

export const getRpcErrors = (namespace?: string): RpcErrorFactory => {
  return resolveFactory(namespace)?.rpc ?? DEFAULT_CHAIN_ERRORS.rpc!;
};

export const getProviderErrors = (namespace?: string): ProviderErrorFactory => {
  return resolveFactory(namespace)?.provider ?? DEFAULT_CHAIN_ERRORS.provider!;
};

/**
 * Create error helpers for throwing structured errors in controllers.
 *
 * Usage in controllers:
 *   const errors = createErrorHelpers(getRpcErrors(namespace), getProviderErrors(namespace));
 *   errors.throwInvalidParams("Invalid address", { address });
 */
export const createErrorHelpers = (rpc: RpcErrorFactory, provider: ProviderErrorFactory) => ({
  throwInvalidRequest(message: string, data?: unknown): never {
    throw rpc.invalidRequest({ message, data });
  },
  throwInvalidParams(message: string, data?: unknown): never {
    throw rpc.invalidParams({ message, data });
  },
  throwMethodNotFound(message?: string, data?: unknown): never {
    throw rpc.methodNotFound(message ? { message, data } : undefined);
  },
  throwResourceNotFound(message?: string, data?: unknown): never {
    throw rpc.resourceNotFound(message ? { message, data } : undefined);
  },
  throwResourceUnavailable(message?: string, data?: unknown): never {
    throw rpc.resourceUnavailable(message ? { message, data } : undefined);
  },
  throwInternal(message: string, data?: unknown): never {
    throw rpc.internal({ message, data });
  },
  throwUnauthorized(message: string, data?: unknown): never {
    throw provider.unauthorized({ message, data });
  },
  throwUserRejected(message: string, data?: unknown): never {
    throw provider.userRejectedRequest({ message, data });
  },
});

/**
 * Shortcut for creating error helpers from namespace.
 *
 * Usage:
 *   const errors = createErrorHelpersForNamespace("eip155");
 *   errors.throwInvalidParams("Missing 'from' address");
 */
export const createErrorHelpersForNamespace = (namespace?: string) => {
  return createErrorHelpers(getRpcErrors(namespace), getProviderErrors(namespace));
};
