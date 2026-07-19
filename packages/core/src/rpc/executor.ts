import { ZodError } from "zod";
import type { ChainJsonRpcClient, ChainJsonRpcRequest } from "../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcResponseError } from "../chainJsonRpc/errors.js";
import { isArxBaseError } from "../errors.js";
import type { ChainRef } from "../networks/chainRef.js";
import { RpcInternalError, RpcInvalidParamsError, RpcUnsupportedMethodError } from "./errors.js";
import type {
  MethodDefinition,
  Namespace,
  RpcExecutionContext,
  RpcHandlerDeps,
  RpcInvocationHint,
  RpcRequest,
} from "./handlers/types.js";
import type { ResolvedRpcInvocationDetails } from "./invocation.js";
import { resolveRpcInvocationDetails } from "./invocation.js";
import { isJsonRpcErrorLike, type JsonRpcErrorLike } from "./jsonRpcError.js";
import { type RpcRouting, rpcPassthroughPolicyForNamespace } from "./routing.js";

type CreateRpcMethodExecutorOptions = {
  routing: RpcRouting;
  deps: RpcHandlerDeps;
  chainJsonRpc: ChainJsonRpcClient;
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

export const createRpcMethodExecutor = ({ routing, deps, chainJsonRpc }: CreateRpcMethodExecutorOptions) => {
  const parseDefinitionParams = (
    definition: MethodDefinition,
    args: {
      namespace: Namespace;
      chainRef: ChainRef;
      method: string;
      params: RpcRequest["params"];
    },
  ): unknown => {
    try {
      if (definition.parseParams) {
        return definition.parseParams(args.params, { namespace: args.namespace, chainRef: args.chainRef });
      }

      const paramsSchema = definition.paramsSchema;
      if (!paramsSchema) return args.params;

      return paramsSchema.parse(args.params);
    } catch (error) {
      if (isArxBaseError(error)) throw error;

      if (error instanceof ZodError) {
        throw new RpcInvalidParamsError({
          message: "Invalid params",
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
      invocation: { namespace: args.namespace, chainRef: args.chainRef },
      executionContext: args.executionContext,
    };

    return args.definition.handler(handlerArgs);
  };

  const assertPassthroughAllowed = (namespace: Namespace, method: string): void => {
    const passthrough = rpcPassthroughPolicyForNamespace(routing, namespace);
    if (!passthrough?.allowedMethods.has(method)) {
      throw new RpcUnsupportedMethodError({
        message: `Method "${method}" is not supported`,
      });
    }
  };

  const sanitizeNodeRpcError = (error: unknown) => {
    if (error instanceof ChainJsonRpcResponseError) {
      return {
        code: error.rpcCode,
        message: error.message,
        ...(error.rpcData !== undefined ? { data: error.rpcData } : {}),
      };
    }
    if (!isJsonRpcErrorLike(error)) return null;
    const rpcError: JsonRpcErrorLike = error;

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

  const executePassthrough = async (args: { request: RpcRequest; namespace: Namespace; chainRef: ChainRef }) => {
    try {
      const rpcPayload: ChainJsonRpcRequest = {
        chainRef: args.chainRef,
        method: args.request.method,
        replay: "never",
      };
      if (args.request.params !== undefined) {
        rpcPayload.params = args.request.params;
      }
      const result = await chainJsonRpc.request(rpcPayload);
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
      args.invocation ?? resolveRpcInvocationDetails(routing, deps, args.request.method, args.hint);

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
      request: args.request,
      namespace,
      chainRef,
    });
  };
};
