import { ZodError } from "zod";
import type { ChainRef } from "../chains/ids.js";
import { isArxBaseError } from "../error.js";
import type { ChainRpcClientPool, RpcTransportRequest } from "./ChainRpcClientPool.js";
import { RpcInternalError, RpcInvalidParamsError, RpcUnsupportedMethodError } from "./errors.js";
import type {
  HandlerRuntimeServices,
  MethodDefinition,
  Namespace,
  RpcExecutionContext,
  RpcHandlerDeps,
  RpcInvocationHint,
  RpcRequest,
} from "./handlers/types.js";
import type { ResolvedRpcInvocationDetails } from "./invocation.js";
import { resolveRpcInvocationDetails } from "./invocation.js";
import type { RpcPassthroughPolicy } from "./RpcRegistry.js";

type RpcExecutorCatalog = {
  hasNamespace(namespace: Namespace): boolean;
  getMethodDefinition(namespace: Namespace, method: string): MethodDefinition | undefined;
  resolveNamespaceFromMethodPrefix(method: string): Namespace | null;
  getPassthroughPolicy(namespace: Namespace): RpcPassthroughPolicy | null;
};

type CreateRpcMethodExecutorOptions = {
  registry: RpcExecutorCatalog;
  deps: RpcHandlerDeps;
  chainRpcClientPool: ChainRpcClientPool;
  services: HandlerRuntimeServices;
};

type RpcExecutorBaseArgs = {
  origin: string;
  request: RpcRequest;
  executionContext: RpcExecutionContext;
};

type RpcExecutorWithInvocation = RpcExecutorBaseArgs & {
  invocation: ResolvedRpcInvocationDetails;
  hint?: never;
};

type RpcExecutorWithHint = RpcExecutorBaseArgs & {
  hint?: RpcInvocationHint;
  invocation?: never;
};

type RpcExecutorArgs = RpcExecutorWithInvocation | RpcExecutorWithHint;

const isJsonRpcErrorLike = (value: unknown): value is { code: number; message?: unknown; data?: unknown } => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "number";
};

export const createRpcMethodExecutor = ({
  registry,
  deps,
  chainRpcClientPool,
  services,
}: CreateRpcMethodExecutorOptions) => {
  const parseDefinitionParams = (
    definition: MethodDefinition,
    args: {
      namespace: Namespace;
      chainRef: ChainRef;
      method: string;
      params: RpcRequest["params"];
    },
  ): unknown => {
    if (!definition.parseParams && !definition.paramsSchema) return args.params;

    try {
      if (definition.parseParams) {
        return definition.parseParams(args.params, { namespace: args.namespace, chainRef: args.chainRef });
      }
      if (!definition.paramsSchema) {
        return args.params;
      }
      return definition.paramsSchema.parse(args.params);
    } catch (error) {
      if (isArxBaseError(error)) throw error;

      if (error instanceof ZodError) {
        throw new RpcInvalidParamsError({
          message: "Invalid params",
          cause: error,
        });
      }

      throw new RpcInternalError({
        message: `Failed to parse params for "${args.method}"`,
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
    executionContext: RpcExecutionContext;
  }) => {
    const params = parseDefinitionParams(args.definition, {
      namespace: args.namespace,
      chainRef: args.chainRef,
      method: args.request.method,
      params: args.request.params,
    });

    const handlerArgs = {
      origin: args.origin,
      request: args.request,
      params,
      deps,
      services,
      invocation: { namespace: args.namespace, chainRef: args.chainRef },
      executionContext: args.executionContext,
    };

    return args.definition.handler(handlerArgs);
  };

  const assertPassthroughAllowed = (namespace: Namespace, method: string): void => {
    const passthrough = registry.getPassthroughPolicy(namespace);
    if (!passthrough?.allowedMethods.has(method)) {
      throw new RpcUnsupportedMethodError({
        message: `Method "${method}" is not supported`,
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
    try {
      const client = chainRpcClientPool.getClient(args.namespace, args.chainRef);
      const rpcPayload: RpcTransportRequest = {
        method: args.request.method,
        retry: { transportFailure: true },
      };
      if (args.request.params !== undefined) {
        rpcPayload.params = args.request.params;
      }
      const result = await client.request(rpcPayload);
      return result;
    } catch (error) {
      const sanitized = sanitizeNodeRpcError(error);
      if (sanitized) throw sanitized;
      if (isArxBaseError(error)) throw error;

      throw new RpcInternalError({
        message: `Failed to execute "${args.request.method}"`,
        cause: error,
      });
    }
  };

  return async (args: RpcExecutorArgs) => {
    const { namespace, chainRef, definition } =
      args.invocation ?? resolveRpcInvocationDetails(registry, deps, args.request.method, args.hint);

    if (definition) {
      return executeLocal({
        origin: args.origin,
        request: args.request,
        namespace,
        chainRef,
        definition,
        executionContext: args.executionContext,
      });
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
