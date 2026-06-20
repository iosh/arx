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
  const { wallet, read, buildSnapshot } = deps;

  return {
    ...createSnapshotHandlers(buildSnapshot),
    ...createBalancesHandlers({ read }),
    ...createSessionHandlers({ wallet }),
    ...createOnboardingHandlers({ wallet }),
    ...createAccountsHandlers({ wallet }),
    ...createNetworksHandlers({ wallet }),
    ...createApprovalsHandlers({ wallet, read }),
    ...createKeyringsHandlers({ wallet, read }),
    ...createTransactionsHandlers({ wallet, read }),
  } as const satisfies UiMethodHandlerMap;
};
