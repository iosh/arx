import { ArxReasons, arxError } from "@arx/errors";
import type { UiError, UiPortEnvelope } from "../protocol/envelopes.js";
import { parseUiMethodParams, parseUiMethodResult } from "../protocol/index.js";
import { EMPTY_UI_DISPATCH_EFFECTS, parseUiRequestMetadata, type UiDispatchEffects } from "./requestMetadata.js";
import type { UiRuntimeDeps, UiServerRuntime } from "./types.js";

export type UiDispatchOutput = {
  reply: UiPortEnvelope;
  effects: UiDispatchEffects;
};
type UiDispatcherDeps = Pick<UiRuntimeDeps, "errorEncoder"> & Pick<UiServerRuntime, "getUiContext" | "handlers">;

export const createUiDispatcher = (deps: UiDispatcherDeps) => {
  const { handlers, getUiContext, errorEncoder } = deps;

  const dispatch = async (raw: unknown): Promise<UiDispatchOutput | null> => {
    const requestMeta = parseUiRequestMetadata(raw);
    if (!requestMeta) return null;

    const ctx = getUiContext();
    const { request, method, effects } = requestMeta;

    if (!method) {
      const encoded = errorEncoder.encodeError(
        arxError({ reason: ArxReasons.RpcInvalidRequest, message: `Unknown UI method: ${request.method}` }),
        { namespace: ctx.namespace, chainRef: ctx.chainRef, method: request.method },
      );
      return {
        reply: { type: "ui:error", id: request.id, error: encoded as unknown as UiError, context: ctx },
        effects: EMPTY_UI_DISPATCH_EFFECTS,
      };
    }

    try {
      const params = parseUiMethodParams(method, request.params);

      const result = await (handlers[method] as (params: unknown) => unknown)(params);
      const parsed = parseUiMethodResult(method, result);
      return {
        reply: { type: "ui:response", id: request.id, result: parsed, context: ctx },
        effects,
      };
    } catch (error) {
      const encoded = errorEncoder.encodeError(error, { namespace: ctx.namespace, chainRef: ctx.chainRef, method });
      return {
        reply: { type: "ui:error", id: request.id, error: encoded as unknown as UiError, context: ctx },
        effects: EMPTY_UI_DISPATCH_EFFECTS,
      };
    }
  };

  return { dispatch };
};
