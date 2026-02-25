import { createAsyncMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import type { ChainRef } from "../../../chains/ids.js";
import type { MethodDefinition, Namespace } from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import { UNKNOWN_ORIGIN } from "../constants.js";

export type ArxInvocation = {
  origin: string;
  method: string;
  params: JsonRpcParams | undefined;
  rpcContext: RpcInvocationContext | undefined;

  namespace: Namespace;
  chainRef: ChainRef;

  definition: MethodDefinition | undefined;
  passthrough: { isPassthrough: boolean; allowWhenLocked: boolean };
};

type ReqLike = {
  method: string;
  params?: JsonRpcParams;
  origin?: string;
  arx?: RpcInvocationContext;
  arxInvocation?: ArxInvocation;
};

export const createInvocationContextMiddleware = (deps: {
  resolve(
    method: string,
    ctx?: RpcInvocationContext,
  ): {
    namespace: Namespace;
    chainRef: ChainRef;
    definition: MethodDefinition | undefined;
    passthrough: { isPassthrough: boolean; allowWhenLocked: boolean };
  };
}) => {
  return createAsyncMiddleware<JsonRpcParams, Json>(async (req: ReqLike, _res, next) => {
    const rpcContext = req.arx;
    const origin = req.origin ?? UNKNOWN_ORIGIN;

    const details = deps.resolve(req.method, rpcContext);

    req.arxInvocation = {
      origin,
      method: req.method,
      params: req.params,
      rpcContext,
      ...details,
    };

    if (req.origin === undefined) {
      req.origin = origin;
    }

    await next();
  });
};
