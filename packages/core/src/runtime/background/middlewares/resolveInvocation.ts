import { createAsyncMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import type { ChainRef } from "../../../chains/ids.js";
import type { Namespace } from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import { UNKNOWN_ORIGIN } from "../constants.js";

export type ArxInvocation = {
  origin: string;
  method: string;
  params: JsonRpcParams | undefined;
  rpcContext: RpcInvocationContext | undefined;
  namespace: Namespace;
  chainRef: ChainRef;
};

type ReqLike = {
  method: string;
  params?: JsonRpcParams;
  origin?: string;
  arx?: RpcInvocationContext;
  arxInvocation?: ArxInvocation;
};

export const createResolveInvocationMiddleware = (deps: {
  resolveInvocation(method: string, ctx?: RpcInvocationContext): { namespace: Namespace; chainRef: ChainRef };
}) => {
  return createAsyncMiddleware<JsonRpcParams, Json>(async (req: ReqLike, _res, next) => {
    const rpcContext = req.arx;
    const origin = req.origin ?? UNKNOWN_ORIGIN;
    const { namespace, chainRef } = deps.resolveInvocation(req.method, rpcContext);

    req.arxInvocation = {
      origin,
      method: req.method,
      params: req.params,
      rpcContext,
      namespace,
      chainRef,
    };

    if (req.origin === undefined) {
      req.origin = origin;
    }

    await next();
  });
};
