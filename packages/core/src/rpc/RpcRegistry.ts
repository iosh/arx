import type { ErrorEncodeContext, ErrorSurface, NamespaceProtocolAdapter, UiErrorPayload } from "@arx/errors";
import { type ArxError, ArxReasons, arxError, isArxError } from "@arx/errors";
import type { Json, JsonRpcParams } from "@metamask/utils";
import type { ChainRef } from "../chains/ids.js";
import type { PermissionScope, PermissionScopeResolver } from "../controllers/index.js";
import { createLogger, extendLogger } from "../utils/logger.js";
import type { NamespaceAdapter } from "./handlers/namespaces/index.js";
import type {
  HandlerControllers,
  MethodDefinition,
  Namespace,
  RpcInvocationContext,
  RpcRequest,
} from "./handlers/types.js";
import type { RpcClientRegistry, RpcTransportRequest } from "./RpcClientRegistry.js";

type NamespaceDefinitions = Record<string, MethodDefinition>;

export type ExecuteWithAdaptersContext = Omit<ErrorEncodeContext, "surface"> & {
  surface: ErrorSurface;
};

export type ExecuteWithAdaptersResult<T> = { ok: true; result: T } | { ok: false; error: unknown };

type MethodExecutorDependencies = {
  rpcClientRegistry: RpcClientRegistry;
};

const rpcLogger = createLogger("core:rpc");
const passthroughLogger = extendLogger(rpcLogger, "passthrough");

const isJsonRpcErrorLike = (value: unknown): value is { code: number; message?: unknown; data?: unknown } => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "number";
};

const toInternalArxError = (error: unknown, ctx: ExecuteWithAdaptersContext): ArxError => {
  const message =
    error instanceof Error && typeof error.message === "string" && error.message.length > 0
      ? error.message
      : "Internal error";

  return arxError({
    reason: ArxReasons.RpcInternal,
    message,
    data: {
      namespace: ctx.namespace,
      ...(ctx.chainRef ? { chainRef: ctx.chainRef } : {}),
      ...(ctx.method ? { method: ctx.method } : {}),
    },
    cause: error,
  });
};

const encodeUiInternalFallback = (error: ArxError): UiErrorPayload => ({
  reason: error.reason,
  message: error.message,
  ...(error.data !== undefined ? { data: error.data } : {}),
});

const encodeDappInternalFallback = (error: ArxError) => ({
  code: -32603,
  message: error.message || "Internal error",
  ...(error.data !== undefined ? { data: error.data } : {}),
});

export class RpcRegistry {
  static readonly DEFAULT_NAMESPACE: Namespace = "eip155";

  private readonly namespaceDefinitions = new Map<Namespace, NamespaceDefinitions>();
  private readonly namespacePrefixes = new Map<string, Namespace>();
  private readonly namespaceAdapters = new Map<Namespace, NamespaceAdapter>();
  private readonly protocolAdapters = new Map<string, NamespaceProtocolAdapter>();

  getRegisteredNamespaceAdapters(): NamespaceAdapter[] {
    return [...this.namespaceAdapters.values()];
  }

  registerNamespaceAdapter(adapter: NamespaceAdapter, options?: { replace?: boolean }): void {
    this.registerNamespaceDefinitions(adapter.namespace, adapter.definitions, {
      replace: options?.replace ?? true,
      methodPrefixes: adapter.methodPrefixes ?? [],
    });

    this.namespaceAdapters.set(adapter.namespace, adapter);
  }

  unregisterNamespaceAdapter(namespace: Namespace): void {
    this.namespaceAdapters.delete(namespace);
    this.unregisterNamespaceDefinitions(namespace);
  }

  registerNamespaceProtocolAdapter(namespace: string, adapter: NamespaceProtocolAdapter): void {
    if (!namespace) throw new Error('[rpc] registerNamespaceProtocolAdapter requires a non-empty "namespace"');
    this.protocolAdapters.set(namespace, adapter);
  }

  getNamespaceProtocolAdapter(namespace: string): NamespaceProtocolAdapter {
    if (!namespace) throw new Error('[rpc] getNamespaceProtocolAdapter requires a non-empty "namespace"');

    if (this.protocolAdapters.has(namespace)) return this.protocolAdapters.get(namespace)!;

    const [prefix] = namespace.split(":");
    if (prefix && this.protocolAdapters.has(prefix)) return this.protocolAdapters.get(prefix)!;

    throw new Error(`[rpc] protocol adapter not registered for namespace "${namespace}"`);
  }

  encodeErrorWithAdapters(error: unknown, ctx: ExecuteWithAdaptersContext): unknown {
    if (ctx.surface === "dapp") {
      if (isJsonRpcErrorLike(error)) {
        const message = typeof error.message === "string" && error.message.length > 0 ? error.message : "Unknown error";
        return {
          code: error.code,
          message,
          ...(error.data !== undefined ? { data: error.data } : {}),
        };
      }
    }

    const domain = isArxError(error) ? error : toInternalArxError(error, ctx);

    try {
      const adapter = this.getNamespaceProtocolAdapter(ctx.namespace);
      if (ctx.surface === "ui") {
        return adapter.encodeUiError(domain, ctx);
      }
      return adapter.encodeDappError(domain, ctx);
    } catch (adapterError) {
      const fallback = toInternalArxError(adapterError, ctx);
      return ctx.surface === "ui" ? encodeUiInternalFallback(fallback) : encodeDappInternalFallback(fallback);
    }
  }

  async executeWithAdapters<T>(
    ctx: ExecuteWithAdaptersContext,
    handler: () => Promise<T>,
  ): Promise<ExecuteWithAdaptersResult<T>> {
    try {
      return { ok: true, result: await handler() };
    } catch (error) {
      return { ok: false, error: this.encodeErrorWithAdapters(error, ctx) };
    }
  }

  private cloneDefinitions(definitions: NamespaceDefinitions): NamespaceDefinitions {
    return { ...definitions };
  }

  private getDefinitionsForNamespace(namespace: Namespace): NamespaceDefinitions | undefined {
    return this.namespaceDefinitions.get(namespace);
  }

  private recordPrefixesForNamespace(namespace: Namespace, prefixes?: string[] | undefined) {
    if (!prefixes || prefixes.length === 0) {
      return;
    }

    // Remove existing prefixes pointing to this namespace to avoid stale entries.
    for (const [prefix, currentNamespace] of this.namespacePrefixes) {
      if (currentNamespace === namespace) {
        this.namespacePrefixes.delete(prefix);
      }
    }

    for (const prefix of prefixes) {
      if (!prefix || this.namespacePrefixes.has(prefix)) {
        if (this.namespacePrefixes.has(prefix)) {
          console.warn(
            `[rpc] method prefix "${prefix}" already registered for namespace "${this.namespacePrefixes.get(prefix)}", skipping duplicate entry for "${namespace}"`,
          );
        }
        continue;
      }
      this.namespacePrefixes.set(prefix, namespace);
    }
  }

  /**
   * Registers method definitions for a namespace and (optionally) associates method
   * prefixes for fast namespace inference.
   *
   * - When `replace` is true (default) the namespace definitions are replaced.
   * - When `replace` is false the provided definitions are merged with existing ones.
   * - Method prefixes are matched in declaration order; the first match wins.
   *   Prefixes should therefore be unique to avoid ambiguity.
   */
  registerNamespaceDefinitions(
    namespace: Namespace,
    definitions: NamespaceDefinitions,
    options?: { replace?: boolean; methodPrefixes?: string[] },
  ): void {
    const existing = this.namespaceDefinitions.get(namespace);
    const shouldReplace = options?.replace ?? true;
    const next = shouldReplace || !existing ? this.cloneDefinitions(definitions) : { ...existing, ...definitions };
    this.namespaceDefinitions.set(namespace, next);
    this.recordPrefixesForNamespace(namespace, options?.methodPrefixes);
  }

  unregisterNamespaceDefinitions(namespace: Namespace): void {
    this.namespaceDefinitions.delete(namespace);

    for (const [prefix, currentNamespace] of this.namespacePrefixes) {
      if (currentNamespace === namespace) {
        this.namespacePrefixes.delete(prefix);
      }
    }
  }

  getRegisteredNamespaces(): Namespace[] {
    return [...this.namespaceDefinitions.keys()];
  }

  private namespaceFromChainRef(chainRef: string | null | undefined): Namespace | null {
    if (!chainRef) {
      return null;
    }
    const [namespace] = chainRef.split(":");
    return namespace ? (namespace as Namespace) : null;
  }

  private deriveNamespaceFromMethod(method: string): Namespace | null {
    for (const [prefix, namespace] of this.namespacePrefixes) {
      if (method.startsWith(prefix)) {
        return namespace;
      }
    }
    return null;
  }

  private selectNamespace(controllers: HandlerControllers, method: string, context?: RpcInvocationContext): Namespace {
    if (context?.namespace && this.namespaceDefinitions.has(context.namespace)) {
      return context.namespace;
    }

    const fromChain = this.namespaceFromChainRef(context?.chainRef ?? null);
    if (fromChain && this.namespaceDefinitions.has(fromChain)) {
      return fromChain;
    }

    const fromMethod = this.deriveNamespaceFromMethod(method);
    if (fromMethod && this.namespaceDefinitions.has(fromMethod)) {
      return fromMethod;
    }

    const activeChain = controllers.network.getActiveChain();
    const [activeNamespace] = activeChain.chainRef.split(":");
    if (activeNamespace && this.namespaceDefinitions.has(activeNamespace as Namespace)) {
      return activeNamespace as Namespace;
    }

    return RpcRegistry.DEFAULT_NAMESPACE;
  }

  createMethodDefinitionResolver(controllers: HandlerControllers) {
    return (method: string, context?: RpcInvocationContext) => {
      const namespace = this.selectNamespace(controllers, method, context);
      return this.getDefinitionsForNamespace(namespace)?.[method];
    };
  }

  createMethodNamespaceResolver(controllers: HandlerControllers) {
    return (method: string, context?: RpcInvocationContext): Namespace => {
      return this.selectNamespace(controllers, method, context);
    };
  }

  createNamespaceResolver(controllers: HandlerControllers) {
    return (context?: RpcInvocationContext): Namespace => {
      return this.selectNamespace(controllers, "", context);
    };
  }

  createPermissionScopeResolver(
    namespaceResolver: (context?: RpcInvocationContext) => Namespace,
    overrides?: Partial<Record<string, PermissionScope | null>>,
  ): PermissionScopeResolver {
    return (method, context) => {
      if (overrides && Object.hasOwn(overrides, method)) {
        const value = overrides[method];
        return value === null ? undefined : value;
      }
      const namespace = namespaceResolver(context);
      return this.getDefinitionsForNamespace(namespace)?.[method]?.scope;
    };
  }

  createMethodExecutor(controllers: HandlerControllers, deps: MethodExecutorDependencies) {
    return async ({
      origin,
      request,
      context,
    }: {
      origin: string;
      request: RpcRequest;
      context?: RpcInvocationContext;
    }) => {
      const namespace = this.selectNamespace(controllers, request.method, context);
      const definition = this.getDefinitionsForNamespace(namespace)?.[request.method];
      if (definition) {
        const handlerArgs =
          context === undefined
            ? { origin, request, controllers }
            : { origin, request, controllers, rpcContext: context };
        return definition.handler(handlerArgs);
      }

      const adapter = this.namespaceAdapters.get(namespace);
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
  }
}

export type DomainChainService = {
  setDomainChain(origin: string, chainRef: ChainRef): Promise<void>;
  getDomainChain(origin: string): Promise<ChainRef | null>;
};

export const createDomainChainService = (): DomainChainService => ({
  async setDomainChain() {
    throw new Error("Not implemented yet");
  },
  async getDomainChain() {
    throw new Error("Not implemented yet");
  },
});
