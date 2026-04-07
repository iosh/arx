import type { UiHandlerDeps, UiMethodHandlerMap } from "../types.js";
import { createAccountsHandlers } from "./accounts.js";
import { createApprovalsHandlers } from "./approvals.js";
import { createBalancesHandlers } from "./balances.js";
import { createKeyringsHandlers } from "./keyrings.js";
import { createNetworksHandlers } from "./networks.js";
import { createOnboardingHandlers } from "./onboarding.js";
import { createSessionHandlers } from "./session.js";
import { createSnapshotHandlers } from "./snapshot.js";
import { createTransactionsHandlers } from "./transactions.js";

export const createUiCommonHandlers = (deps: UiHandlerDeps): UiMethodHandlerMap => {
  const { access, surface, buildSnapshot } = deps;

  const toChainSnapshot = () => access.chains.getSelectedChainView();

  return {
    ...createSnapshotHandlers(buildSnapshot),
    ...createBalancesHandlers({
      chains: access.chains,
      session: access.session,
      namespaceBindings: access.namespaceBindings,
    }),
    ...createSessionHandlers({ session: access.session }),
    ...createOnboardingHandlers({
      accounts: access.accounts,
      chains: access.chains,
      accountCodecs: access.accountCodecs,
      walletSetup: access.walletSetup,
    }),
    ...createAccountsHandlers({ accounts: access.accounts }),
    ...createNetworksHandlers({ chains: access.chains }, toChainSnapshot),
    ...createApprovalsHandlers({ approvals: access.approvals }),
    ...createKeyringsHandlers({
      accounts: access.accounts,
      chains: access.chains,
      accountCodecs: access.accountCodecs,
      session: access.session,
      keyrings: access.keyrings,
    }),
    ...createTransactionsHandlers({
      transactions: access.transactions,
      chains: access.chains,
      session: access.session,
      namespaceBindings: access.namespaceBindings,
      surface,
    }),
  } as const satisfies UiMethodHandlerMap;
};
