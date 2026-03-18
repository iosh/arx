import { ArxReasons, arxError, isArxError } from "@arx/errors";
import { ZodError } from "zod";
import type { ChainRef } from "../chains/ids.js";
import { createLogger, extendLogger } from "../utils/logger.js";
import type {
  HandlerControllers,
  HandlerRuntimeServices,
  MethodDefinition,
  Namespace,
  RpcRequest,
} from "./handlers/types.js";
import { resolveRpcInvocationDetails } from "./invocation.js";
import type { RpcClientRegistry, RpcTransportRequest } from "./RpcClientRegistry.js";
import type { RpcPassthroughPolicy } from "./RpcRegistry.js";

type RpcExecutorCatalog = {
  hasNamespace(namespace: Namespace): boolean;
  getMethodDefinition(namespace: Namespace, method: string): MethodDefinition | undefined;
  resolveNamespaceFromMethodPrefix(method: string): Namespace | null;
  getPassthroughPolicy(namespace: Namespace): RpcPassthroughPolicy | null;
};

type CreateRpcMethodExecutorOptions = {
  registry: RpcExecutorCatalog;
  controllers: HandlerControllers;
  rpcClientRegistry: RpcClientRegistry;
  services: HandlerRuntimeServices;
};

const rpcLogger = createLogger("core:rpc");
const passthroughLogger = extendLogger(rpcLogger, "passthrough");

const isJsonRpcErrorLike = (value: unknown): value is { code: number; message?: unknown; data?: unknown } => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "number";
};

export const createRpcMethodExecutor = ({
  registry,
  controllers,
  rpcClientRegistry,
  services,
}: CreateRpcMethodExecutorOptions) => {
  const parseDefinitionParams = (
    definition: MethodDefinition,
    args: {
      namespace: Namespace;
      method: string;
      params: RpcRequest["params"];
      context?: Parameters<typeof resolveRpcInvocationDetails>[3];
    },
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
    chainRef: ChainRef;
    definition: MethodDefinition;
    context?: Parameters<typeof resolveRpcInvocationDetails>[3];
  }) => {
    const params = parseDefinitionParams(args.definition, {
      namespace: args.namespace,
      method: args.request.method,
      params: args.request.params,
      ...(args.context !== undefined ? { context: args.context } : {}),
    });

    const handlerArgs =
      args.context === undefined
        ? {
            origin: args.origin,
            request: args.request,
            params,
            controllers,
            services,
            invocation: { namespace: args.namespace, chainRef: args.chainRef },
          }
        : {
            origin: args.origin,
            request: args.request,
            params,
            controllers,
            services,
            invocation: { namespace: args.namespace, chainRef: args.chainRef },
            rpcContext: args.context,
          };

    return args.definition.handler(handlerArgs);
  };

  const assertPassthroughAllowed = (namespace: Namespace, method: string): void => {
    const passthrough = registry.getPassthroughPolicy(namespace);
    if (!passthrough || !passthrough.allowedMethods.has(method)) {
      throw arxError({
        reason: ArxReasons.RpcUnsupportedMethod,
        message: `Method "${method}" is not supported`,
        data: { namespace, method },
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
      const client = rpcClientRegistry.getClient(args.namespace, args.chainRef);
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

  return async (args: {
    origin: string;
    request: RpcRequest;
    context?: Parameters<typeof resolveRpcInvocationDetails>[3];
  }) => {
    const { namespace, chainRef, definition } = resolveRpcInvocationDetails(
      registry,
      controllers,
      args.request.method,
      args.context,
    );

    if (definition) {
      return executeLocal(
        args.context === undefined
          ? { origin: args.origin, request: args.request, namespace, chainRef, definition }
          : { origin: args.origin, request: args.request, namespace, chainRef, definition, context: args.context },
      );
    }

    assertPassthroughAllowed(namespace, args.request.method);

    return executePassthrough({
      origin: args.origin,
      request: args.request,
      namespace,
      chainRef,
    });
  };
};
