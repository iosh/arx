import { createApprovalFlowRegistry } from "../../approvals/index.js";
import { createUiHandlers } from "./handlers/index.js";
import { buildUiSnapshot } from "./snapshot.js";
import type { UiRuntimeDeps, UiServerRuntime } from "./types.js";

const buildUiContext = (deps: Pick<UiRuntimeDeps, "chainViews">) => {
  const chain = deps.chainViews.getSelectedChainView();
  return { namespace: chain.namespace, chainRef: chain.chainRef };
};

export const createUiServerRuntime = (deps: UiRuntimeDeps): UiServerRuntime => {
  const approvalFlowRegistry = createApprovalFlowRegistry();

  const buildSnapshot = () =>
    buildUiSnapshot({
      controllers: deps.controllers,
      chainViews: deps.chainViews,
      permissionViews: deps.permissionViews,
      session: deps.session,
      keyring: deps.keyring,
      attention: deps.attention,
      namespaceBindings: deps.namespaceBindings,
      approvalFlowRegistry,
    });

  const { rpcRegistry: _rpcRegistry, ...handlerDeps } = deps;
  void _rpcRegistry;

  return {
    buildSnapshot,
    getUiContext: () => buildUiContext(deps),
    handlers: createUiHandlers({
      ...handlerDeps,
      buildSnapshot,
      uiSessionId: crypto.randomUUID(),
    }),
  };
};
