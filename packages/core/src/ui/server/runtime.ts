import { createApprovalFlowRegistry } from "../../approvals/index.js";
import { createUiHandlers } from "./handlers/index.js";
import { buildUiSnapshot } from "./snapshot.js";
import type { UiRuntimeServerDeps, UiServerRuntime, UiServerRuntimeDeps } from "./types.js";

const buildUiContext = (deps: Pick<UiRuntimeServerDeps, "access">) => {
  const chain = deps.access.chains.getSelectedChainView();
  return { namespace: chain.namespace, chainRef: chain.chainRef };
};

export const createUiServerRuntime = (deps: UiServerRuntimeDeps): UiServerRuntime => {
  const approvalFlows = createApprovalFlowRegistry();

  const buildSnapshot = () =>
    buildUiSnapshot({
      accounts: deps.access.accounts,
      approvals: deps.access.approvals,
      chains: deps.access.chains,
      permissions: deps.access.permissions,
      session: deps.access.session,
      keyrings: deps.access.keyrings,
      attention: deps.access.attention,
      namespaceBindings: deps.access.namespaceBindings,
      transactions: deps.access.transactions,
      approvalFlows,
    });

  return {
    buildSnapshot,
    getUiContext: () => buildUiContext(deps),
    handlers: createUiHandlers({
      access: deps.access,
      platform: deps.platform,
      surface: deps.surface,
      buildSnapshot,
    }),
  };
};
