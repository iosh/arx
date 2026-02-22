import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ChainRegistryController } from "../../controllers/chainRegistry/types.js";
import type { NetworkController, RpcRoutingState } from "../../controllers/network/types.js";
import type { NetworkPreferencesService } from "../../services/networkPreferences/types.js";
import type { NetworkPreferencesRecord, NetworkRpcPreference } from "../../storage/records.js";
import { buildDefaultRoutingState, DEFAULT_CHAIN } from "./constants.js";

export type CreateNetworkBootstrapOptions = {
  network: NetworkController;
  chainRegistry: ChainRegistryController;
  preferences: NetworkPreferencesService;
  hydrationEnabled: boolean;
  logger: (message: string, error?: unknown) => void;
  getIsHydrating: () => boolean;
};

export type NetworkBootstrap = {
  loadPreferences(): Promise<void>;
  requestSync(): void;
  flushPendingSync(): Promise<void>;
  start(): void;
  destroy(): void;
};

export const createNetworkBootstrap = (opts: CreateNetworkBootstrapOptions): NetworkBootstrap => {
  const { network, chainRegistry, preferences, hydrationEnabled, logger, getIsHydrating } = opts;

  let cachedPreferences: NetworkPreferencesRecord | null = null;
  let pendingSync = false;
  let suppressActivePersist = false;

  let listenersAttached = false;
  let unsubscribeRegistry: (() => void) | null = null;
  let unsubscribeNetwork: (() => void) | null = null;

  const readRegistryChains = (): ChainMetadata[] => chainRegistry.getState().chains.map((entry) => entry.metadata);

  let syncInFlight: Promise<void> | null = null;

  const computeRpcState = (registryChains: ChainMetadata[], current: ReturnType<typeof network.getState>) => {
    const corrections: Record<ChainRef, NetworkRpcPreference> = {};

    const rpc = Object.fromEntries(
      registryChains.map((chain) => {
        const fromCurrent = current.rpc[chain.chainRef];
        const base = fromCurrent ?? buildDefaultRoutingState(chain);

        const pref = cachedPreferences?.rpc?.[chain.chainRef] ?? null;
        if (!pref) {
          return [chain.chainRef, base] as const;
        }

        // Clamp against registry metadata (the source of truth), not the current runtime snapshot.
        const safeIndex = Math.min(pref.activeIndex, Math.max(0, chain.rpcEndpoints.length - 1));
        if (safeIndex !== pref.activeIndex) {
          corrections[chain.chainRef] = { ...pref, activeIndex: safeIndex };
        }

        const next: RpcRoutingState = { ...base, activeIndex: safeIndex, strategy: pref.strategy };

        return [chain.chainRef, next] as const;
      }),
    ) as Record<ChainRef, RpcRoutingState>;

    return { rpc, corrections };
  };

  const selectActiveChainRef = (
    current: ReturnType<typeof network.getState>,
    registryChains: ChainMetadata[],
  ): ChainRef => {
    if (registryChains.length === 0) {
      return current.activeChain;
    }

    const available = new Set(registryChains.map((chain) => chain.chainRef));

    const preferred = cachedPreferences?.activeChainRef ?? null;
    if (preferred && available.has(preferred)) {
      return preferred;
    }

    if (available.has(current.activeChain)) {
      return current.activeChain;
    }

    if (available.has(DEFAULT_CHAIN.chainRef)) {
      return DEFAULT_CHAIN.chainRef;
    }

    const first = registryChains[0];
    if (!first) {
      throw new Error("Network bootstrap expected chain registry to provide at least one chain");
    }
    return first.chainRef;
  };

  const pruneRpcPreferences = (available: Set<ChainRef>) => {
    const base = cachedPreferences?.rpc ?? null;
    if (!base) return {};

    const patch: Record<ChainRef, NetworkRpcPreference | null> = {};
    for (const chainRef of Object.keys(base) as ChainRef[]) {
      if (!available.has(chainRef)) {
        patch[chainRef] = null;
      }
    }
    return patch;
  };

  const syncOnceFromRegistry = async () => {
    const registryChains = readRegistryChains();
    if (registryChains.length === 0) {
      return;
    }

    if (hydrationEnabled) {
      try {
        cachedPreferences = await preferences.get();
      } catch (error) {
        logger("preferences: failed to load", error);
        cachedPreferences = null;
      }
    }

    const current = network.getState();
    const nextActive = selectActiveChainRef(current, registryChains);

    const available = new Set(registryChains.map((chain) => chain.chainRef));
    const { rpc, corrections } = computeRpcState(registryChains, current);
    const prunePatch = pruneRpcPreferences(available);

    suppressActivePersist = true;
    try {
      network.replaceState({
        activeChain: nextActive,
        knownChains: registryChains,
        rpc,
      });
    } finally {
      suppressActivePersist = false;
    }

    // Persist any corrections even when the active chain didn't change (e.g. stale preferences fallback).
    if (!getIsHydrating()) {
      const nextPatch: Record<ChainRef, NetworkRpcPreference | null> = {};
      Object.assign(nextPatch, prunePatch);
      for (const [chainRef, pref] of Object.entries(corrections) as Array<[ChainRef, NetworkRpcPreference]>) {
        nextPatch[chainRef] = pref;
      }

      const shouldPersistActive = cachedPreferences?.activeChainRef !== nextActive;
      const shouldPersistRpc = Object.keys(nextPatch).length > 0;

      if (shouldPersistActive || shouldPersistRpc) {
        try {
          cachedPreferences = await preferences.upsert({
            ...(shouldPersistActive ? { activeChainRef: nextActive } : {}),
            ...(shouldPersistRpc ? { rpcPatch: nextPatch } : {}),
          });
        } catch (error) {
          logger("preferences: failed to persist corrected network preferences", error);
        }
      }
    }
  };

  const requestSync = () => {
    pendingSync = true;
    if (getIsHydrating()) {
      return;
    }
    if (syncInFlight) {
      return;
    }

    syncInFlight = (async () => {
      try {
        while (pendingSync && !getIsHydrating()) {
          pendingSync = false;
          await syncOnceFromRegistry();
        }
      } catch (error) {
        logger("network: failed to sync from registry", error);
      } finally {
        syncInFlight = null;
      }
    })();
  };

  const attachListeners = () => {
    if (listenersAttached) {
      return;
    }
    listenersAttached = true;

    unsubscribeRegistry = chainRegistry.onStateChanged(() => requestSync());
    unsubscribeNetwork = network.onActiveChainChanged(({ next }) => {
      if (getIsHydrating()) {
        return;
      }
      if (suppressActivePersist) {
        return;
      }
      void preferences
        .setActiveChainRef(next)
        .then((record) => {
          cachedPreferences = record;
        })
        .catch((error) => logger("preferences: failed to persist activeChainRef", error));
    });
  };

  const detachListeners = () => {
    if (!listenersAttached) {
      return;
    }
    listenersAttached = false;

    if (unsubscribeRegistry) {
      try {
        unsubscribeRegistry();
      } catch (error) {
        logger("lifecycle: failed to remove chain registry listener", error);
      }
      unsubscribeRegistry = null;
    }

    if (unsubscribeNetwork) {
      try {
        unsubscribeNetwork();
      } catch (error) {
        logger("lifecycle: failed to remove network listener", error);
      }
      unsubscribeNetwork = null;
    }
  };

  const loadPreferences = async () => {
    if (!hydrationEnabled) {
      cachedPreferences = null;
      return;
    }

    try {
      cachedPreferences = await preferences.get();
    } catch (error) {
      logger("preferences: failed to load", error);
      cachedPreferences = null;
    }
  };

  const flushPendingSync = async () => {
    if (syncInFlight) {
      await syncInFlight;
      return;
    }

    if (pendingSync) {
      pendingSync = false;
      await syncOnceFromRegistry();
    }
  };

  const start = () => {
    attachListeners();
  };

  const destroy = () => {
    detachListeners();
  };

  return {
    loadPreferences,
    requestSync,
    flushPendingSync,
    start,
    destroy,
  };
};
