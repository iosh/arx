import type { UiMethodName } from "../protocol/index.js";
import { createUiCommonHandlers } from "./handlers/index.js";
import type { UiMethodHandlerMap, UiRuntimeServerDeps, UiServerRuntime, UiServerRuntimeDeps } from "./types.js";

const UI_COMMON_HANDLER_OWNER_ID = "core.uiCommon";

const registerUiHandlers = (
  handlers: UiMethodHandlerMap,
  owners: Map<UiMethodName, string>,
  nextHandlers: UiMethodHandlerMap,
  ownerId: string,
) => {
  for (const method of Object.keys(nextHandlers) as UiMethodName[]) {
    const handler = nextHandlers[method];
    if (!handler) continue;

    const existingOwnerId = owners.get(method);
    if (existingOwnerId) {
      throw new Error(
        `UI method "${method}" is already registered by "${existingOwnerId}" and cannot be registered again by "${ownerId}"`,
      );
    }

    owners.set(method, ownerId);
    Reflect.set(handlers, method, handler);
  }
};

const buildUiContext = (deps: Pick<UiRuntimeServerDeps, "wallet">) => {
  const chain = deps.wallet.snapshot.get().chain;
  return { namespace: chain.namespace, chainRef: chain.chainRef };
};

export const createUiServerRuntime = (deps: UiServerRuntimeDeps): UiServerRuntime => {
  const buildSnapshot = () => deps.wallet.snapshot.get();

  const handlerDeps = {
    access: deps.access,
    wallet: deps.wallet,
    platform: deps.platform,
    surface: deps.surface,
  } as const;

  const handlers: UiMethodHandlerMap = {};
  const handlerOwners = new Map<UiMethodName, string>();

  registerUiHandlers(handlers, handlerOwners, createUiCommonHandlers(handlerDeps), UI_COMMON_HANDLER_OWNER_ID);

  for (const extension of deps.extensions ?? []) {
    registerUiHandlers(handlers, handlerOwners, extension.createHandlers(handlerDeps), extension.id);
  }

  return {
    buildSnapshot,
    getUiContext: () => buildUiContext(deps),
    handlers,
  };
};
