import { createApprovalFlowRegistry } from "../../approvals/index.js";
import { createUiHandlers } from "./handlers/index.js";
import { buildUiSnapshot } from "./snapshot.js";
import type { UiRuntimeDeps, UiServerRuntime } from "./types.js";

const buildUiContext = (deps: Pick<UiRuntimeDeps, "chains">) => {
  const chain = deps.chains.getSelectedChainView();
  return { namespace: chain.namespace, chainRef: chain.chainRef };
};

export const createUiServerRuntime = (deps: UiRuntimeDeps): UiServerRuntime => {
  const approvalFlowRegistry = createApprovalFlowRegistry();

  const buildSnapshot = () =>
    buildUiSnapshot({
      accounts: deps.accounts,
      approvals: deps.approvals,
      chains: deps.chains,
      permissions: deps.permissions,
      session: deps.session,
      keyrings: deps.keyrings,
      attention: deps.attention,
      namespaceBindings: deps.namespaceBindings,
      transactions: deps.transactions,
      approvalFlowRegistry,
    });

  return {
    buildSnapshot,
    getUiContext: () => buildUiContext(deps),
    handlers: createUiHandlers({
      accounts: deps.accounts,
      approvals: deps.approvals,
      permissions: deps.permissions,
      transactions: deps.transactions,
      chains: deps.chains,
      accountCodecs: deps.accountCodecs,
      session: deps.session,
      keyrings: deps.keyrings,
      namespaceBindings: deps.namespaceBindings,
      uiOrigin: deps.uiOrigin,
      platform: deps.platform,
      buildSnapshot,
      uiSessionId: crypto.randomUUID(),
    }),
  };
};
