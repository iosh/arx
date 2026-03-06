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
  const { controllers, session, keyring, attention, platform, uiOrigin, rpcClients } = deps;
  const uiSessionId = crypto.randomUUID();

  const buildSnapshot = (): UiSnapshot =>
    buildUiSnapshot({
      controllers,
      session,
      keyring,
      attention,
    });

  const toChainSnapshot = () => {
    const chain = controllers.network.getActiveChain();
    return {
      chainRef: chain.chainRef,
      chainId: chain.chainId,
      namespace: chain.namespace,
      displayName: chain.displayName,
      shortName: chain.shortName ?? null,
      icon: chain.icon?.url ?? null,
      nativeCurrency: {
        name: chain.nativeCurrency.name,
        symbol: chain.nativeCurrency.symbol,
        decimals: chain.nativeCurrency.decimals,
      },
    };
  };

  return {
    ...createSnapshotHandlers(buildSnapshot),
    ...createAttentionHandlers({ platform }),
    ...createBalancesHandlers({ controllers, session, rpcClients }),
    ...createSessionHandlers({ session, keyring }),
    ...createOnboardingHandlers({ controllers, session, keyring, platform }),
    ...createAccountsHandlers({ controllers }, buildSnapshot),
    ...createNetworksHandlers({ controllers }, toChainSnapshot),
    ...createApprovalsHandlers({ controllers }),
    ...createKeyringsHandlers({ controllers, session, keyring }),
    ...createTransactionsHandlers({ controllers, session, uiOrigin }, uiSessionId),
  } as const satisfies UiHandlers;
};
