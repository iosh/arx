import type { ChainRef } from "../../chains/ids.js";
import type { ChainDefinitionsController } from "../../controllers/chainDefinitions/types.js";
import { buildNetworkChainConfigs, createNetworkRuntimeInput } from "../../controllers/network/config.js";
import type { NetworkChainConfig, NetworkController, RpcRoutingState } from "../../controllers/network/types.js";
import type { NetworkPreferencesService } from "../../services/store/networkPreferences/types.js";
import type { NetworkPreferencesRecord, NetworkRpcPreference } from "../../storage/records.js";
import { buildDefaultRoutingState, DEFAULT_CHAIN } from "./constants.js";

export type CreateNetworkBootstrapOptions = {
  network: NetworkController;
  chainDefinitions: ChainDefinitionsController;
  preferences: NetworkPreferencesService;
  hydrationEnabled: boolean;
  logger: (message: string, error?: unknown) => void;
  getIsHydrating: () => boolean;
  getRegisteredNamespaces: () => ReadonlySet<string>;
};

export type NetworkBootstrap = {
  loadPreferences(): Promise<void>;
  requestSync(): void;
  flushPendingSync(): Promise<void>;
  start(): void;
  destroy(): void;
};

export const createNetworkBootstrap = (opts: CreateNetworkBootstrapOptions): NetworkBootstrap => {
  const { network, chainDefinitions, preferences, hydrationEnabled, logger, getIsHydrating, getRegisteredNamespaces } =
    opts;

  let cachedPreferences: NetworkPreferencesRecord | null = null;
  let preferencesLoaded = !hydrationEnabled;
  let pendingSync = false;

  let listenersAttached = false;
  let unsubscribeRegistry: (() => void) | null = null;

  const readRegistryChainConfigs = (): NetworkChainConfig[] =>
    buildNetworkChainConfigs(
      chainDefinitions
        .getState()
        .chains.filter((entry) => getRegisteredNamespaces().has(entry.namespace))
        .map((entry) => entry.metadata),
    );

  let syncInFlight: Promise<void> | null = null;

  const computeRpcState = (registryChains: NetworkChainConfig[], current: ReturnType<typeof network.getState>) => {
    const corrections: Record<ChainRef, NetworkRpcPreference> = {};

    const rpc = Object.fromEntries(
      registryChains.map((chain) => {
        const fromCurrent = current.rpc[chain.chainRef];
        const base = fromCurrent ?? buildDefaultRoutingState(chain);

        const pref = cachedPreferences?.rpc?.[chain.chainRef] ?? null;
        if (!pref) {
          return [chain.chainRef, base] as const;
        }

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

  const getNamespace = (chainRef: ChainRef): string => {
    const [namespace] = chainRef.split(":");
    return namespace ?? DEFAULT_CHAIN.namespace;
  };

  const resolveActiveChainByNamespace = (
    current: ReturnType<typeof network.getState>,
    registryChains: NetworkChainConfig[],
    selectedChainRefHint: ChainRef,
  ): Record<string, ChainRef> => {
    const availableByNamespace = new Map<string, ChainRef[]>();

    for (const chain of registryChains) {
      const namespace = getNamespace(chain.chainRef);
      const chainRefs = availableByNamespace.get(namespace);
      if (chainRefs) {
        chainRefs.push(chain.chainRef);
      } else {
        availableByNamespace.set(namespace, [chain.chainRef]);
      }
    }

    const next: Record<string, ChainRef> = {};
    const selectedNamespace = getNamespace(selectedChainRefHint);
    const currentNamespace = getNamespace(current.activeChainRef);

    for (const [namespace, chainRefs] of availableByNamespace) {
      const preferred = cachedPreferences?.activeChainByNamespace?.[namespace] ?? null;
      if (preferred && chainRefs.includes(preferred)) {
        next[namespace] = preferred;
        continue;
      }

      if (namespace === selectedNamespace && chainRefs.includes(selectedChainRefHint)) {
        next[namespace] = selectedChainRefHint;
        continue;
      }

      if (namespace === currentNamespace && chainRefs.includes(current.activeChainRef)) {
        next[namespace] = current.activeChainRef;
        continue;
      }

      if (namespace === DEFAULT_CHAIN.namespace && chainRefs.includes(DEFAULT_CHAIN.chainRef)) {
        next[namespace] = DEFAULT_CHAIN.chainRef;
        continue;
      }

      const first = chainRefs[0];
      if (first) {
        next[namespace] = first;
      }
    }

    return next;
  };

  const selectActiveChainRef = (
    current: ReturnType<typeof network.getState>,
    registryChains: NetworkChainConfig[],
    activeChainByNamespace: Record<string, ChainRef>,
  ): ChainRef => {
    if (registryChains.length === 0) {
      return current.activeChainRef;
    }

    const available = new Set(registryChains.map((chain) => chain.chainRef));
    const preferredSelectedChainRef = cachedPreferences?.selectedChainRef ?? null;
    if (preferredSelectedChainRef && available.has(preferredSelectedChainRef)) {
      return preferredSelectedChainRef;
    }

    const preferredSelectedNamespace = preferredSelectedChainRef ? getNamespace(preferredSelectedChainRef) : null;
    const preferredSelectedNamespaceActive = preferredSelectedNamespace
      ? (activeChainByNamespace[preferredSelectedNamespace] ?? null)
      : null;
    if (preferredSelectedNamespaceActive && available.has(preferredSelectedNamespaceActive)) {
      return preferredSelectedNamespaceActive;
    }

    const currentNamespace = getNamespace(current.activeChainRef);

    const currentNamespaceActive = activeChainByNamespace[currentNamespace] ?? null;
    if (currentNamespaceActive && available.has(currentNamespaceActive)) {
      return currentNamespaceActive;
    }

    if (available.has(current.activeChainRef)) {
      return current.activeChainRef;
    }

    const defaultNamespaceActive = activeChainByNamespace[DEFAULT_CHAIN.namespace] ?? null;
    if (defaultNamespaceActive && available.has(defaultNamespaceActive)) {
      return defaultNamespaceActive;
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

  const loadCachedPreferences = async () => {
    if (!hydrationEnabled) {
      cachedPreferences = null;
      preferencesLoaded = true;
      return;
    }

    try {
      cachedPreferences = await preferences.get();
    } catch (error) {
      logger("preferences: failed to load", error);
      cachedPreferences = null;
    } finally {
      preferencesLoaded = true;
    }
  };

  const syncOnceFromRegistry = async () => {
    const registryChains = readRegistryChainConfigs();
    if (registryChains.length === 0) {
      return;
    }

    if (!preferencesLoaded) {
      await loadCachedPreferences();
    }

    const current = network.getState();
    const selectedChainRefHint = cachedPreferences?.selectedChainRef ?? current.activeChainRef;
    const nextActiveChainByNamespace = resolveActiveChainByNamespace(current, registryChains, selectedChainRefHint);
    const nextSelectedChainRef = selectActiveChainRef(current, registryChains, nextActiveChainByNamespace);

    const available = new Set(registryChains.map((chain) => chain.chainRef));
    const { rpc, corrections } = computeRpcState(registryChains, current);
    const prunePatch = pruneRpcPreferences(available);

    network.replaceState(
      createNetworkRuntimeInput({
        state: {
          activeChainRef: nextSelectedChainRef,
          availableChainRefs: registryChains.map((chain) => chain.chainRef),
          rpc,
        },
        chainConfigs: registryChains,
      }),
    );

    if (!getIsHydrating()) {
      const nextPatch: Record<ChainRef, NetworkRpcPreference | null> = {};
      Object.assign(nextPatch, prunePatch);
      for (const [chainRef, pref] of Object.entries(corrections) as Array<[ChainRef, NetworkRpcPreference]>) {
        nextPatch[chainRef] = pref;
      }

      const cachedActive = cachedPreferences?.activeChainByNamespace ?? {};
      const cachedSelected = cachedPreferences?.selectedChainRef ?? null;
      const shouldPersistSelected = cachedSelected !== nextSelectedChainRef;
      const shouldPersistActive =
        Object.keys(cachedActive).length !== Object.keys(nextActiveChainByNamespace).length ||
        Object.entries(nextActiveChainByNamespace).some(
          ([namespace, chainRef]) => cachedActive[namespace] !== chainRef,
        );
      const shouldPersistRpc = Object.keys(nextPatch).length > 0;

      if (shouldPersistSelected || shouldPersistActive || shouldPersistRpc) {
        try {
          cachedPreferences = await preferences.update({
            ...(shouldPersistSelected ? { selectedChainRef: nextSelectedChainRef } : {}),
            ...(shouldPersistActive ? { activeChainByNamespace: nextActiveChainByNamespace } : {}),
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

    unsubscribeRegistry = chainDefinitions.onStateChanged(() => requestSync());
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
  };

  const loadPreferences = async () => {
    await loadCachedPreferences();
  };

  const flushPendingSync = async () => {
    if (syncInFlight) {
      await syncInFlight;
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
