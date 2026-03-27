import { ArxReasons, arxError } from "@arx/errors";
import type { UiError, UiPortEnvelope } from "../protocol/envelopes.js";
import { parseUiMethodParams, parseUiMethodResult } from "../protocol/index.js";
import {
  EMPTY_UI_REQUEST_EXECUTION_PLAN,
  parseUiRequestMetadata,
  type UiRequestExecutionPlan,
} from "./requestMetadata.js";
import type { UiRuntimeBridgeAccess, UiServerRuntime } from "./types.js";

export type UiDispatchOutput = {
  reply: UiPortEnvelope;
  plan: UiRequestExecutionPlan;
};
type UiDispatcherDeps = Pick<UiRuntimeBridgeAccess, "encodeError"> & Pick<UiServerRuntime, "getUiContext" | "handlers">;

export const createUiDispatcher = (deps: UiDispatcherDeps) => {
  const { handlers, getUiContext, encodeError } = deps;

  const dispatch = async (raw: unknown): Promise<UiDispatchOutput | null> => {
    const requestMeta = parseUiRequestMetadata(raw);
    if (!requestMeta) return null;

    const ctx = getUiContext();
    const { request, method, plan } = requestMeta;

    if (!method) {
      const encoded = encodeError(
        arxError({ reason: ArxReasons.RpcInvalidRequest, message: `Unknown UI method: ${request.method}` }),
        { namespace: ctx.namespace, chainRef: ctx.chainRef, method: request.method },
      );
      return {
        reply: { type: "ui:error", id: request.id, error: encoded as unknown as UiError, context: ctx },
        plan: EMPTY_UI_REQUEST_EXECUTION_PLAN,
      };
    }

    try {
      const params = parseUiMethodParams(method, request.params);

      const result = await (handlers[method] as (params: unknown) => unknown)(params);
      const parsed = parseUiMethodResult(method, result);
      return {
        reply: { type: "ui:response", id: request.id, result: parsed, context: ctx },
        plan,
      };
    } catch (error) {
      const encoded = encodeError(error, { namespace: ctx.namespace, chainRef: ctx.chainRef, method });
      return {
        reply: { type: "ui:error", id: request.id, error: encoded as unknown as UiError, context: ctx },
        plan: EMPTY_UI_REQUEST_EXECUTION_PLAN,
      };
    }
  };

  return { dispatch };
};
