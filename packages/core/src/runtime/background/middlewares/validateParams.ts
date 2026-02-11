import { ArxReasons, arxError, isArxError } from "@arx/errors";
import { createAsyncMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import type { MethodDefinition } from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import type { ArxInvocation } from "./resolveInvocation.js";

type ReqLike = {
  method: string;
  params?: JsonRpcParams;
  arx?: RpcInvocationContext;
  arxInvocation?: ArxInvocation;
};

/**
 * Validate params before handler execution.
 *
 * This middleware is definition-driven: only methods that provide
 * `definition.validateParams` will be validated here.
 */
export const createValidateParamsMiddleware = (deps: {
  findMethodDefinition(method: string, context?: RpcInvocationContext): MethodDefinition | undefined;
}) => {
  return createAsyncMiddleware<JsonRpcParams, Json>(async (req: ReqLike, _res, next) => {
    const method = req.method;

    // Prefer pre-resolved invocation context if present.
    const invocation = req.arxInvocation;
    const rpcContext = invocation?.rpcContext ?? req.arx;

    const definition = deps.findMethodDefinition(method, rpcContext);
    if (!definition?.validateParams) {
      await next();
      return;
    }

    try {
      definition.validateParams(req.params, rpcContext);
    } catch (error) {
      // Ensure unknown throws become a proper RPC invalid params error.
      if (isArxError(error)) throw error;
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: error instanceof Error ? error.message : "Invalid params",
        data: { method },
        cause: error,
      });
    }

    await next();
  });
};
