import { JsonRpcEngine, type JsonRpcMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";

export type EngineOptions = {
  middlewares?: JsonRpcMiddleware<JsonRpcParams, Json>[];
};

export const initEngine = (options?: EngineOptions) => {
  const engine = new JsonRpcEngine();
  (options?.middlewares ?? []).forEach((middleware) => {
    engine.push(middleware);
  });
  return engine;
};
