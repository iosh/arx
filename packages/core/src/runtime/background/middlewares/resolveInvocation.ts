import { createAsyncMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import { UNKNOWN_ORIGIN } from "../constants.js";

export type ArxInvocation = {
  origin: string;
  method: string;
  params: JsonRpcParams | undefined;
  rpcContext: RpcInvocationContext | undefined;
  namespace: string;
  chainRef: string;
};

type ReqLike = {
  method: string;
  params?: JsonRpcParams;
  origin?: string;
  arx?: RpcInvocationContext;
  arxInvocation?: ArxInvocation;
};

export const createResolveInvocationMiddleware = (deps: {
  deriveNamespace(method: string, ctx?: RpcInvocationContext): string;
  getActiveChainRef(): string;
}) => {
  /**
   * Normalize a JSON-RPC request into a single invocation context (SSOT).
   *
   * Downstream middleware should prefer `req.arxInvocation` to avoid
   * recomputing origin/namespace/chainRef in multiple places.
   */
  return createAsyncMiddleware<JsonRpcParams, Json>(async (req: ReqLike, _res, next) => {
    const rpcContext = req.arx;
    const origin = req.origin ?? UNKNOWN_ORIGIN;
    const namespace = deps.deriveNamespace(req.method, rpcContext);
    const chainRef = (rpcContext?.chainRef ?? deps.getActiveChainRef()) as string;

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
