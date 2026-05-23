import type { RpcExecutionContext, RpcInvocationHint } from "../../../rpc/index.js";
import type { ArxInvocation } from "./invocationContext.js";

/**
 * Common request fields injected into json-rpc-engine requests by our pipeline.
 * Keeping this type centralized avoids ad-hoc casts and `unknown` in middlewares.
 */
export type ArxMiddlewareRequest = {
  origin?: string;
  arx?: RpcInvocationHint;
  arxExecution?: RpcExecutionContext;
  arxInvocation?: ArxInvocation;
};
