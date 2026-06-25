import type { WalletUi, WalletUiDispatchInput } from "../../engine/types.js";
import { RpcUnsupportedMethodError } from "../../rpc/errors.js";
import type { UiMethodName } from "../protocol/index.js";
import { parseUiMethodParams } from "../protocol/index.js";
import { createUiDispatcher } from "./dispatcher.js";
import { createUiServerRuntime } from "./runtime.js";
import type { UiHandlerFn, UiRuntimeAccess, UiRuntimeDeps, UiSurfaceIdentity } from "./types.js";

type CreateUiRuntimeAccessOptions = UiRuntimeDeps;

const UI_SURFACE_PORT_ID = "ui";

const requireUiHandler = <M extends UiMethodName>(
  handlers: ReturnType<typeof createUiServerRuntime>["handlers"],
  method: M,
): UiHandlerFn<M> => {
  const handler = handlers[method];
  if (!handler) {
    throw new RpcUnsupportedMethodError({
      message: `Unsupported UI method: ${method}`,
    });
  }

  return handler as UiHandlerFn<M>;
};

const createUiSurfaceIdentity = (uiOrigin: string, createId: () => string): UiSurfaceIdentity => ({
  transport: "ui" as const,
  portId: UI_SURFACE_PORT_ID,
  origin: uiOrigin,
  surfaceId: createId(),
});

const createUiRuntimeCore = ({ server }: CreateUiRuntimeAccessOptions) => {
  const surface = createUiSurfaceIdentity(server.uiOrigin, server.createId ?? (() => globalThis.crypto.randomUUID()));
  const uiRuntime = createUiServerRuntime({
    wallet: server.wallet,
    platform: server.platform,
    surface,
    ...(server.extensions ? { extensions: server.extensions } : {}),
  });

  const dispatch = (async <M extends UiMethodName>(input: WalletUiDispatchInput<M>) => {
    const handler = requireUiHandler(uiRuntime.handlers, input.method);
    const params = parseUiMethodParams(input.method, input.params);
    const result = await handler(params);
    return result;
  }) satisfies WalletUi["dispatch"];

  return {
    uiRuntime,
    dispatch,
  };
};

export const createUiContract = (options: CreateUiRuntimeAccessOptions): WalletUi => {
  const { dispatch } = createUiRuntimeCore(options);

  return {
    dispatch,
  };
};

export const createUiRuntimeAccess = (options: CreateUiRuntimeAccessOptions) => {
  const { uiRuntime } = createUiRuntimeCore(options);

  const dispatcher = createUiDispatcher({
    handlers: uiRuntime.handlers,
    getUiContext: uiRuntime.getUiContext,
  });

  const dispatchRequest: UiRuntimeAccess["dispatchRequest"] = async (raw) => {
    const dispatched = await dispatcher.dispatch(raw);
    if (!dispatched) return null;

    return {
      reply: dispatched.reply,
      kind: dispatched.plan.kind,
    };
  };

  return {
    dispatchRequest,
  };
};
