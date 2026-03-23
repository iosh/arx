import type { UiHandlerDeps, UiHandlers } from "../types.js";
import { createAccountsHandlers } from "./accounts.js";
import { createApprovalsHandlers } from "./approvals.js";
import { createBalancesHandlers } from "./balances.js";
import { createKeyringsHandlers } from "./keyrings.js";
import { createNetworksHandlers } from "./networks.js";
import { createOnboardingHandlers } from "./onboarding.js";
import { createSessionHandlers } from "./session.js";
import { createSnapshotHandlers } from "./snapshot.js";
import { createTransactionsHandlers } from "./transactions.js";

export const createUiHandlers = (deps: UiHandlerDeps): UiHandlers => {
  const {
    accounts,
    approvals,
    transactions,
    chains,
    accountCodecs,
    session,
    keyrings,
    namespaceBindings,
    platform,
    uiOrigin,
    buildSnapshot,
    uiSessionId,
  } = deps;

  const toChainSnapshot = () => chains.getSelectedChainView();

  return {
    ...createSnapshotHandlers(buildSnapshot),
    ...createBalancesHandlers({ chains, session, namespaceBindings }),
    ...createSessionHandlers({ session }),
    ...createOnboardingHandlers({ accounts, chains, accountCodecs, session, keyrings, platform }),
    ...createAccountsHandlers({ accounts }),
    ...createNetworksHandlers({ chains }, toChainSnapshot),
    ...createApprovalsHandlers({ approvals, platform }),
    ...createKeyringsHandlers({ accounts, chains, accountCodecs, session, keyrings }),
    ...createTransactionsHandlers({ transactions, chains, session, namespaceBindings, uiOrigin }, uiSessionId),
  } as const satisfies UiHandlers;
};
