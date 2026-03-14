import type { UiHandlerDeps, UiHandlers } from "../types.js";
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

export const createUiHandlers = (deps: UiHandlerDeps): UiHandlers => {
  const {
    controllers,
    chainActivation,
    chainViews,
    accountCodecs,
    session,
    keyring,
    namespaceBindings,
    platform,
    uiOrigin,
    buildSnapshot,
    uiSessionId,
  } = deps;

  const toChainSnapshot = () => chainViews.getSelectedChainView();

  return {
    ...createSnapshotHandlers(buildSnapshot),
    ...createAttentionHandlers({ platform }),
    ...createBalancesHandlers({ chainViews, session, namespaceBindings }),
    ...createSessionHandlers({ session, keyring }),
    ...createOnboardingHandlers({ controllers, chainViews, accountCodecs, session, keyring, platform }),
    ...createAccountsHandlers({ controllers }),
    ...createNetworksHandlers({ chainActivation }, toChainSnapshot),
    ...createApprovalsHandlers({ controllers }),
    ...createKeyringsHandlers({ controllers, chainViews, accountCodecs, session, keyring }),
    ...createTransactionsHandlers({ controllers, chainViews, session, namespaceBindings, uiOrigin }, uiSessionId),
  } as const satisfies UiHandlers;
};
