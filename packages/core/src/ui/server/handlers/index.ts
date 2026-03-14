import { createApprovalFlowRegistry } from "../../../approvals/index.js";
import type { UiSnapshot } from "../../protocol/schemas.js";
import { buildUiSnapshot } from "../snapshot.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";
import { createAccountsHandlers } from "./accounts.js";
import { createApprovalsHandlers } from "./approvals.js";
import { createAttentionHandlers } from "./attention.js";
import { createBalancesHandlers } from "./balances.js";
import { createKeyringsHandlers } from "./keyrings.js";
import { createNetworksHandlers } from "./networks.js";
import { createOnboardingHandlers } from "./onboarding.js";
import { createSessionHandlers } from "./session.js";
import { createSnapshotHandlers } from "./snapshot.js";
import { createTransactionsHandlers } from "./transactions.js";

export const createUiHandlers = (deps: UiRuntimeDeps): UiHandlers => {
  const {
    controllers,
    chainActivation,
    chainViews,
    permissionViews,
    accountCodecs,
    session,
    keyring,
    attention,
    platform,
    uiOrigin,
    namespaceBindings,
  } = deps;
  const uiSessionId = crypto.randomUUID();
  const approvalFlowRegistry = createApprovalFlowRegistry();

  const buildSnapshot = (): UiSnapshot =>
    buildUiSnapshot({
      controllers,
      chainViews,
      permissionViews,
      session,
      keyring,
      attention,
      namespaceBindings,
      approvalFlowRegistry,
    });

  const toChainSnapshot = () => chainViews.getSelectedChainView();

  return {
    ...createSnapshotHandlers(buildSnapshot),
    ...createAttentionHandlers({ platform }),
    ...createBalancesHandlers({ chainViews, session, namespaceBindings }),
    ...createSessionHandlers({ session, keyring }),
    ...createOnboardingHandlers({ controllers, chainViews, accountCodecs, session, keyring, platform }),
    ...createAccountsHandlers({ controllers }, buildSnapshot),
    ...createNetworksHandlers({ chainActivation }, toChainSnapshot),
    ...createApprovalsHandlers({ controllers }),
    ...createKeyringsHandlers({ controllers, chainViews, accountCodecs, session, keyring }),
    ...createTransactionsHandlers({ controllers, chainViews, session, namespaceBindings, uiOrigin }, uiSessionId),
  } as const satisfies UiHandlers;
};
