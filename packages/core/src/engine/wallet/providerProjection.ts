import type { ChainRef } from "../../chains/ids.js";
import type { ChainAddressCodecRegistry } from "../../chains/registry.js";
import type { ProviderRuntimeConnectionState, ProviderRuntimeSnapshot } from "../../runtime/provider/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { PermissionViewsService } from "../../services/runtime/permissionViews/types.js";
import type { SessionStatusService } from "../../services/runtime/sessionStatus.js";

// Shared provider-facing projections keep chain, unlock, and account exposure consistent across
// dappConnections and snapshots without introducing another surface-specific state cache.
export type ProviderProjectionDeps = {
  sessionStatus: Pick<SessionStatusService, "getStatus">;
  chainViews: Pick<ChainViewsService, "getActiveChainViewForNamespace" | "buildProviderMeta">;
};

type FormattedPermittedAccountsDeps = {
  sessionStatus: Pick<SessionStatusService, "getStatus">;
  permissionViews: Pick<PermissionViewsService, "listPermittedAccounts">;
  chainAddressCodecs: Pick<ChainAddressCodecRegistry, "formatAddress">;
};

export const buildProviderSnapshot = (deps: ProviderProjectionDeps, namespace: string): ProviderRuntimeSnapshot => {
  const providerMeta = deps.chainViews.buildProviderMeta(namespace);
  const providerChain = deps.chainViews.getActiveChainViewForNamespace(namespace);
  const supportedChains = providerMeta.supportedChains.filter((chainRef) => chainRef.startsWith(`${namespace}:`));

  return {
    namespace,
    chain: {
      chainId: providerChain.chainId,
      chainRef: providerChain.chainRef,
    },
    isUnlocked: deps.sessionStatus.getStatus().isUnlocked,
    meta: {
      activeChainByNamespace: {
        [namespace]: providerMeta.activeChainByNamespace[namespace] ?? providerChain.chainRef,
      },
      supportedChains,
    },
  };
};

// Provider-facing account exposure is lock-aware. Durable permissions remain intact while
// the projected account list collapses to [] in the locked state.
export const listFormattedPermittedAccounts = (
  deps: FormattedPermittedAccountsDeps,
  params: { origin: string; chainRef: ChainRef },
): string[] => {
  if (!deps.sessionStatus.getStatus().isUnlocked) {
    return [];
  }

  const origin = params.origin.trim();
  if (origin.length === 0) {
    return [];
  }

  return deps.permissionViews.listPermittedAccounts(origin, { chainRef: params.chainRef }).map((account) =>
    deps.chainAddressCodecs.formatAddress({
      chainRef: params.chainRef,
      canonical: account.canonicalAddress,
    }),
  );
};

export const buildProviderConnectionState = (deps: {
  providerProjection: ProviderProjectionDeps;
  permissionProjection: FormattedPermittedAccountsDeps;
  origin: string;
  namespace: string;
}): ProviderRuntimeConnectionState => {
  const snapshot = buildProviderSnapshot(deps.providerProjection, deps.namespace);

  return {
    snapshot,
    accounts: listFormattedPermittedAccounts(deps.permissionProjection, {
      origin: deps.origin,
      chainRef: snapshot.chain.chainRef,
    }),
  };
};
