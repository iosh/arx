import { RpcInvalidRequestError, RpcUnsupportedMethodError } from "../../rpc/errors.js";
import type { UiError, UiPortEnvelope } from "../protocol/envelopes.js";
import { parseUiMethodParams, parseUiMethodResult, type UiMethodName } from "../protocol/index.js";
import { encodeUiError } from "./errorEncoding.js";
import {
  EMPTY_UI_REQUEST_EXECUTION_PLAN,
  parseUiRequestMetadata,
  type UiRequestExecutionPlan,
} from "./requestMetadata.js";
import type { UiHandlerFn, UiServerRuntime } from "./types.js";

export type UiDispatchOutput = {
  reply: UiPortEnvelope;
  plan: UiRequestExecutionPlan;
};
type UiDispatcherDeps = Pick<UiServerRuntime, "getUiContext" | "handlers">;

const requireUiHandler = <M extends UiMethodName>(handlers: UiServerRuntime["handlers"], method: M): UiHandlerFn<M> => {
  const handler = handlers[method];
  if (!handler) {
    throw new RpcUnsupportedMethodError({
      message: `Unsupported UI method: ${method}`,
    });
  }

  return handler as UiHandlerFn<M>;
};

export const createUiDispatcher = (deps: UiDispatcherDeps) => {
  const { handlers, getUiContext } = deps;

  const dispatch = async (raw: unknown): Promise<UiDispatchOutput | null> => {
    const requestMeta = parseUiRequestMetadata(raw);
    if (!requestMeta) return null;

    const ctx = getUiContext();
    const { request, method, plan } = requestMeta;

    if (!method) {
      const encoded = encodeUiError(new RpcInvalidRequestError({ message: `Unknown UI method: ${request.method}` }));
      return {
        reply: { type: "ui:error", id: request.id, error: encoded as unknown as UiError, context: ctx },
        plan: EMPTY_UI_REQUEST_EXECUTION_PLAN,
      };
    }

    try {
      const handler = requireUiHandler(handlers, method);
      const params = parseUiMethodParams(method, request.params);
      const result = await handler(params);
      const parsed = parseUiMethodResult(method, result);
      return {
        reply: { type: "ui:response", id: request.id, result: parsed, context: ctx },
        plan,
      };
    } catch (error) {
      const encoded = encodeUiError(error);
      return {
        reply: { type: "ui:error", id: request.id, error: encoded as unknown as UiError, context: ctx },
        plan: EMPTY_UI_REQUEST_EXECUTION_PLAN,
      };
    }
  };

  return { dispatch };
};
