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
  const { controllers, chainViews, session, keyring, attention, platform, uiOrigin, rpcClients } = deps;
  const uiSessionId = crypto.randomUUID();

  const buildSnapshot = (): UiSnapshot =>
    buildUiSnapshot({
      controllers,
      chainViews,
      session,
      keyring,
      attention,
    });

  const toChainSnapshot = () => chainViews.getActiveChainView();

  return {
    ...createSnapshotHandlers(buildSnapshot),
    ...createAttentionHandlers({ platform }),
    ...createBalancesHandlers({ chainViews, session, rpcClients }),
    ...createSessionHandlers({ session, keyring }),
    ...createOnboardingHandlers({ controllers, chainViews, session, keyring, platform }),
    ...createAccountsHandlers({ controllers }, buildSnapshot),
    ...createNetworksHandlers({ controllers }, toChainSnapshot),
    ...createApprovalsHandlers({ controllers, chainViews }),
    ...createKeyringsHandlers({ controllers, chainViews, session, keyring }),
    ...createTransactionsHandlers({ controllers, chainViews, session, uiOrigin }, uiSessionId),
  } as const satisfies UiHandlers;
};
