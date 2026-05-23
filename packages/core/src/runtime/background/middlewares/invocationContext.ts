import { createAsyncMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import type { ChainRef } from "../../../chains/ids.js";
import type { MethodDefinition, Namespace } from "../../../rpc/handlers/types.js";
import { NO_RPC_EXECUTION_CONTEXT, type RpcExecutionContext, type RpcInvocationHint } from "../../../rpc/index.js";
import { UNKNOWN_ORIGIN } from "../constants.js";

export type ArxInvocation = {
  origin: string;
  method: string;
  params: JsonRpcParams | undefined;
  rpcHint: RpcInvocationHint | undefined;
  executionContext: RpcExecutionContext;

  namespace: Namespace;
  chainRef: ChainRef;

  definition: MethodDefinition | undefined;
  passthrough: { isPassthrough: boolean; allowWhenLocked: boolean };
};

type ReqLike = {
  method: string;
  params?: JsonRpcParams;
  origin?: string;
  arx?: RpcInvocationHint;
  arxExecution?: RpcExecutionContext;
  arxInvocation?: ArxInvocation;
};

export const requireArxInvocation = (request: { arxInvocation?: ArxInvocation }): ArxInvocation => {
  if (!request.arxInvocation) {
    throw new Error("Missing resolved RPC invocation");
  }

  return request.arxInvocation;
};

export const createInvocationContextMiddleware = (deps: {
  resolve(
    method: string,
    hint?: RpcInvocationHint,
  ): {
    namespace: Namespace;
    chainRef: ChainRef;
    definition: MethodDefinition | undefined;
    passthrough: { isPassthrough: boolean; allowWhenLocked: boolean };
  };
}) => {
  return createAsyncMiddleware<JsonRpcParams, Json>(async (req: ReqLike, _res, next) => {
    const rpcHint = req.arx;
    const executionContext = req.arxExecution ?? NO_RPC_EXECUTION_CONTEXT;
    const origin = req.origin ?? UNKNOWN_ORIGIN;

    const details = deps.resolve(req.method, rpcHint);

    req.arxInvocation = {
      origin,
      method: req.method,
      params: req.params,
      rpcHint,
      executionContext,
      ...details,
    };

    if (req.origin === undefined) {
      req.origin = origin;
    }

    await next();
  });
};
