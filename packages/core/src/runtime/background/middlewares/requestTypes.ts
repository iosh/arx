import type { RpcInvocationContext } from "../../../rpc/index.js";
import type { ArxInvocation } from "./resolveInvocation.js";

/**
 * Common request fields injected into json-rpc-engine requests by our pipeline.
 * Keeping this type centralized avoids ad-hoc casts and `unknown` in middlewares.
 */
export type ArxMiddlewareRequest = {
  origin?: string;
  arx?: RpcInvocationContext;
  arxInvocation?: ArxInvocation;
};
