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
  const { wallet } = deps;

  return {
    ...createSnapshotHandlers({ wallet }),
    ...createBalancesHandlers({ wallet }),
    ...createSessionHandlers({ wallet }),
    ...createOnboardingHandlers({ wallet }),
    ...createAccountsHandlers({ wallet }),
    ...createNetworksHandlers({ wallet }),
    ...createApprovalsHandlers({ wallet }),
    ...createKeyringsHandlers({ wallet }),
    ...createTransactionsHandlers({ wallet }),
  } as const satisfies UiMethodHandlerMap;
};
