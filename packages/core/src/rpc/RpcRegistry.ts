import type { ErrorEncodeContext, ErrorSurface, NamespaceProtocolAdapter, UiErrorPayload } from "@arx/errors";
import { type ArxError, ArxReasons, arxError, isArxError } from "@arx/errors";
import { ZodError } from "zod";
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

type PassthroughPolicy = {
  allowedMethods: ReadonlySet<string>;
  allowWhenLocked: ReadonlySet<string>;
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
  private readonly passthroughByNamespace = new Map<Namespace, PassthroughPolicy>();
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

    if (adapter.passthrough) {
      const allowedMethods = new Set(adapter.passthrough.allowedMethods);
      const allowWhenLocked = new Set(adapter.passthrough.allowWhenLocked ?? []);

      for (const method of allowWhenLocked) {
        if (!allowedMethods.has(method)) {
          throw arxError({
            reason: ArxReasons.RpcInternal,
            message: `[rpc] invalid passthrough config for namespace "${adapter.namespace}": allowWhenLocked contains "${method}" but it is not listed in allowedMethods`,
            data: { namespace: adapter.namespace, method },
          });
        }
      }

      this.passthroughByNamespace.set(adapter.namespace, { allowedMethods, allowWhenLocked });
    } else {
      this.passthroughByNamespace.delete(adapter.namespace);
    }
  }

  unregisterNamespaceAdapter(namespace: Namespace): void {
    this.namespaceAdapters.delete(namespace);
    this.passthroughByNamespace.delete(namespace);
    this.unregisterNamespaceDefinitions(namespace);
  }

  registerNamespaceProtocolAdapter(namespace: string, adapter: NamespaceProtocolAdapter): void {
    if (!namespace) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: '[rpc] registerNamespaceProtocolAdapter requires a non-empty "namespace"',
      });
    }
    this.protocolAdapters.set(namespace, adapter);
  }

  getNamespaceProtocolAdapter(namespace: string): NamespaceProtocolAdapter {
    if (!namespace) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: '[rpc] getNamespaceProtocolAdapter requires a non-empty "namespace"',
      });
    }

    const direct = this.protocolAdapters.get(namespace);
    if (direct) return direct;

    const [prefix] = namespace.split(":");
    if (prefix) {
      const byPrefix = this.protocolAdapters.get(prefix);
      if (byPrefix) return byPrefix;
    }

    throw arxError({
      reason: ArxReasons.RpcInternal,
      message: `[rpc] protocol adapter not registered for namespace "${namespace}"`,
      data: { namespace },
    });
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
      if (!prefix) continue;

      const existing = this.namespacePrefixes.get(prefix);
      if (existing && existing !== namespace) {
        throw arxError({
          reason: ArxReasons.RpcInternal,
          message: `[rpc] method prefix "${prefix}" already registered for namespace "${existing}"`,
          data: { prefix, existingNamespace: existing, namespace },
        });
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

  getPassthroughAllowance(
    controllers: HandlerControllers,
    method: string,
    context?: RpcInvocationContext,
  ): { isPassthrough: boolean; allowWhenLocked: boolean } {
    const namespace = this.selectNamespace(controllers, method, context);
    const passthrough = this.passthroughByNamespace.get(namespace);
    if (!passthrough) {
      return { isPassthrough: false, allowWhenLocked: false };
    }
    const isPassthrough = passthrough.allowedMethods.has(method);
    return {
      isPassthrough,
      allowWhenLocked: isPassthrough && passthrough.allowWhenLocked.has(method),
    };
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
    if (context?.namespace) {
      // Normalize "eip155:1" -> "eip155" (defensive: context is still evolving).
      const [candidate] = context.namespace.split(":");
      const normalized = (candidate || context.namespace) as Namespace;
      if (this.namespaceDefinitions.has(normalized)) {
        return normalized;
      }
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
    const resolveNamespace = (method: string, context?: RpcInvocationContext): Namespace =>
      this.selectNamespace(controllers, method, context);

    const resolveDefinition = (namespace: Namespace, method: string): MethodDefinition | undefined =>
      this.getDefinitionsForNamespace(namespace)?.[method];

    const parseDefinitionParams = (
      definition: MethodDefinition,
      args: { namespace: Namespace; method: string; params: RpcRequest["params"]; context?: RpcInvocationContext },
    ): unknown => {
      if (!definition.parseParams && !definition.paramsSchema) return args.params;

      try {
        if (definition.parseParams) {
          return definition.parseParams(args.params, args.context);
        }
        if (!definition.paramsSchema) {
          return args.params;
        }
        return definition.paramsSchema.parse(args.params);
      } catch (error) {
        if (isArxError(error)) throw error;

        // Only treat known validation failures as "invalid params".
        // Unknown exceptions likely indicate a bug and should surface as internal errors.
        if (error instanceof ZodError) {
          throw arxError({
            reason: ArxReasons.RpcInvalidParams,
            message: "Invalid params",
            data: { namespace: args.namespace, method: args.method },
            cause: error,
          });
        }

        throw arxError({
          reason: ArxReasons.RpcInternal,
          message: `Failed to parse params for "${args.method}"`,
          data: {
            namespace: args.namespace,
            method: args.method,
            errorName: error instanceof Error ? error.name : typeof error,
          },
          cause: error,
        });
      }
    };

    const executeLocal = async (args: {
      origin: string;
      request: RpcRequest;
      namespace: Namespace;
      definition: MethodDefinition;
      context?: RpcInvocationContext;
    }) => {
      const params = parseDefinitionParams(args.definition, {
        namespace: args.namespace,
        method: args.request.method,
        params: args.request.params,
        ...(args.context !== undefined ? { context: args.context } : {}),
      });

      const handlerArgs =
        args.context === undefined
          ? { origin: args.origin, request: args.request, params, controllers }
          : { origin: args.origin, request: args.request, params, controllers, rpcContext: args.context };
      return args.definition.handler(handlerArgs);
    };

    const assertPassthroughAllowed = (namespace: Namespace, method: string): void => {
      const passthrough = this.passthroughByNamespace.get(namespace);
      if (!passthrough || !passthrough.allowedMethods.has(method)) {
        throw arxError({
          reason: ArxReasons.RpcMethodNotFound,
          message: `Method "${method}" is not implemented`,
          data: { namespace, method },
        });
      }
    };

    const resolveChainRef = (context?: RpcInvocationContext): ChainRef => {
      return (context?.chainRef ?? controllers.network.getActiveChain().chainRef) as ChainRef;
    };

    const assertNamespaceMatchesChainRef = (namespace: Namespace, chainRef: ChainRef, method: string) => {
      const [chainNamespace] = chainRef.split(":");
      if (chainNamespace && chainNamespace !== namespace) {
        throw arxError({
          reason: ArxReasons.RpcInvalidRequest,
          message: `Namespace mismatch for "${method}"`,
          data: { namespace, chainRef },
        });
      }
    };

    const sanitizeNodeRpcError = (error: unknown) => {
      if (!isJsonRpcErrorLike(error)) return null;
      const rpcError = error as { code: number; message?: unknown; data?: unknown };

      const message =
        typeof rpcError.message === "string" && rpcError.message.length > 0 ? rpcError.message : "Unknown error";

      if (!rpcError.data || typeof rpcError.data !== "object") {
        return {
          code: rpcError.code,
          message,
          ...(rpcError.data !== undefined ? { data: rpcError.data } : {}),
        };
      }

      // Sanitize error.data to remove internal fields like stack, path.
      const sanitized = { ...(rpcError.data as Record<string, unknown>) };
      delete sanitized.stack;
      delete sanitized.path;
      return { code: rpcError.code, message, data: sanitized };
    };

    const executePassthrough = async (args: {
      origin: string;
      request: RpcRequest;
      namespace: Namespace;
      chainRef: ChainRef;
    }) => {
      const logMeta = {
        namespace: args.namespace,
        chainRef: args.chainRef,
        method: args.request.method,
        origin: args.origin ?? "unknown://",
      };

      try {
        const client = deps.rpcClientRegistry.getClient(args.namespace, args.chainRef);
        const rpcPayload: RpcTransportRequest = { method: args.request.method };
        if (args.request.params !== undefined) {
          rpcPayload.params = args.request.params;
        }
        passthroughLogger("request", { ...logMeta, params: args.request.params ?? [] });
        const result = await client.request(rpcPayload);
        passthroughLogger("response", { ...logMeta });
        return result;
      } catch (error) {
        const errorSummary = isJsonRpcErrorLike(error)
          ? {
              code: (error as { code?: number | string }).code,
              message: (error as { message?: string }).message ?? "RPC error",
            }
          : { message: (error as Error)?.message ?? String(error) };
        passthroughLogger("error", { ...logMeta, error: errorSummary });

        const sanitized = sanitizeNodeRpcError(error);
        if (sanitized) throw sanitized;
        if (isArxError(error)) throw error;

        throw arxError({
          reason: ArxReasons.RpcInternal,
          message: `Failed to execute "${args.request.method}"`,
          data: { namespace: args.namespace, chainRef: args.chainRef },
          cause: error,
        });
      }
    };

    return async (args: { origin: string; request: RpcRequest; context?: RpcInvocationContext }) => {
      const namespace = resolveNamespace(args.request.method, args.context);

      const definition = resolveDefinition(namespace, args.request.method);
      if (definition) {
        return executeLocal(
          args.context === undefined
            ? { origin: args.origin, request: args.request, namespace, definition }
            : { origin: args.origin, request: args.request, namespace, definition, context: args.context },
        );
      }

      assertPassthroughAllowed(namespace, args.request.method);

      const chainRef = resolveChainRef(args.context);
      assertNamespaceMatchesChainRef(namespace, chainRef, args.request.method);

      return executePassthrough({
        origin: args.origin,
        request: args.request,
        namespace,
        chainRef,
      });
    };
  }
}
