import { ArxReasons, arxError } from "@arx/errors";
import { createAsyncMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";

export const createRequireInitializedMiddleware = (deps: { getIsInitialized: () => boolean }) => {
  return createAsyncMiddleware<JsonRpcParams, Json>(async (_req, _res, next) => {
    if (!deps.getIsInitialized()) {
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: "Background runtime is not initialized (call lifecycle.initialize() first).",
      });
    }
    await next();
  });
};
