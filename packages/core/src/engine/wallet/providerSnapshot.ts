import { ChainNotAvailableError, ChainNotSupportedError } from "../../chains/errors.js";
import type { ProviderRuntimeConnectionQuery, ProviderRuntimeSnapshot } from "../../runtime/provider/types.js";
import type { ChainView, ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { SessionStatusService } from "../../services/runtime/sessionStatus.js";
import type { ProviderChainSelectionService } from "../../services/store/providerChainSelection/types.js";

export type ProviderChainResolutionDeps = {
  chainViews: Pick<ChainViewsService, "findAvailableChainView">;
  providerChainSelection: Pick<ProviderChainSelectionService, "getSelectedChainRef">;
};

export type ResolvedProviderChain = {
  chain: ChainView;
};

export type ProviderSnapshotDeps = {
  sessionStatus: Pick<SessionStatusService, "getStatus">;
  chainViews: Pick<ChainViewsService, "findAvailableChainView">;
  providerChainSelection: Pick<ProviderChainSelectionService, "getSelectedChainRef">;
};

export const resolveProviderChain = (
  deps: ProviderChainResolutionDeps,
  input: ProviderRuntimeConnectionQuery,
): ResolvedProviderChain => {
  const selectedChainRef = deps.providerChainSelection.getSelectedChainRef(input);
  if (!selectedChainRef) {
    throw new ChainNotSupportedError({
      message: `Provider chain selection is not initialized for origin "${input.origin}" and namespace "${input.namespace}"`,
    });
  }

  const providerSelectedChain = deps.chainViews.findAvailableChainView({
    namespace: input.namespace,
    chainRef: selectedChainRef,
  });

  if (!providerSelectedChain) {
    throw new ChainNotAvailableError({
      message: `Selected provider chain "${selectedChainRef}" is not available`,
    });
  }

  return {
    chain: providerSelectedChain,
  };
};

export const buildProviderSnapshot = (
  deps: ProviderSnapshotDeps,
  input: ProviderRuntimeConnectionQuery,
): ProviderRuntimeSnapshot => {
  const { namespace } = input;
  const resolvedProviderChain = resolveProviderChain(deps, input);
  const { chain } = resolvedProviderChain;

  return {
    namespace,
    chain: {
      chainId: chain.chainId,
      chainRef: chain.chainRef,
    },
    isUnlocked: deps.sessionStatus.getStatus().isUnlocked,
  };
};
