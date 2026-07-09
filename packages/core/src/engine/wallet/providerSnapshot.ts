import { eip155ChainIdHexFromChainRef } from "../../chains/eip155/format.js";
import { ChainNotAvailableError, ChainNotSupportedError } from "../../chains/errors.js";
import type { ProviderChainSelectionService } from "../../chains/selection/provider/types.js";
import type { ChainViewsService } from "../../chains/views/types.js";
import type { ProviderConnectionQuery, ProviderSnapshot } from "../../provider/access/types.js";

export type ProviderChainResolutionDeps = {
  chainViews: Pick<ChainViewsService, "findAvailableChainView">;
  providerChainSelection: Pick<ProviderChainSelectionService, "getSelectedChainRef">;
};

export type ResolvedProviderChain = {
  chain: ProviderSnapshot["chain"];
};

const deriveEip155ProviderChain = (
  input: ProviderConnectionQuery,
  chainRef: ProviderSnapshot["chain"]["chainRef"],
): ProviderSnapshot["chain"] => {
  if (input.namespace !== "eip155") {
    throw new ChainNotSupportedError(
      `EIP-1193 provider snapshots are not supported for namespace "${input.namespace}"`,
    );
  }

  return {
    chainId: eip155ChainIdHexFromChainRef(chainRef),
    chainRef,
  };
};

export type ProviderSnapshotDeps = {
  getSessionStatus: () => { isUnlocked: boolean };
  chainViews: Pick<ChainViewsService, "findAvailableChainView">;
  providerChainSelection: Pick<ProviderChainSelectionService, "getSelectedChainRef">;
};

export const resolveProviderChain = (
  deps: ProviderChainResolutionDeps,
  input: ProviderConnectionQuery,
): ResolvedProviderChain => {
  const selectedChainRef = deps.providerChainSelection.getSelectedChainRef(input);
  if (!selectedChainRef) {
    throw new ChainNotSupportedError(
      `Provider chain selection is not initialized for origin "${input.origin}" and namespace "${input.namespace}"`,
    );
  }

  const providerSelectedChain = deps.chainViews.findAvailableChainView({
    namespace: input.namespace,
    chainRef: selectedChainRef,
  });

  if (!providerSelectedChain) {
    throw new ChainNotAvailableError(`Selected provider chain "${selectedChainRef}" is not available`);
  }

  return {
    chain: deriveEip155ProviderChain(input, providerSelectedChain.chainRef),
  };
};

export const buildProviderSnapshot = (deps: ProviderSnapshotDeps, input: ProviderConnectionQuery): ProviderSnapshot => {
  const { namespace } = input;
  const resolvedProviderChain = resolveProviderChain(deps, input);
  const { chain } = resolvedProviderChain;

  return {
    namespace,
    chain,
    isUnlocked: deps.getSessionStatus().isUnlocked,
  };
};
