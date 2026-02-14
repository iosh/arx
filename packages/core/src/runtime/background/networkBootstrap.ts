import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ChainRegistryController } from "../../controllers/chainRegistry/types.js";
import type { NetworkController, RpcEndpointState } from "../../controllers/network/types.js";
import type { SettingsRecord } from "../../db/records.js";
import type { SettingsService } from "../../services/settings/types.js";
import type { NetworkRpcPort } from "../../storage/types.js";
import { createNetworkRpcSync } from "../persistence/createNetworkRpcSync.js";
import { buildDefaultEndpointState, DEFAULT_CHAIN } from "./constants.js";

type HydratedPreference = { activeIndex: number; strategy: RpcEndpointState["strategy"] };

export type CreateNetworkBootstrapOptions = {
  network: NetworkController;
  chainRegistry: ChainRegistryController;
  settings: SettingsService | null;

  networkRpcPort?: NetworkRpcPort;
  hydrationEnabled: boolean;
  now: () => number;
  logger: (message: string, error?: unknown) => void;
  getIsHydrating: () => boolean;
  getIsDestroyed: () => boolean;
  networkRpcDebounceMs?: number;
};

export type NetworkBootstrap = {
  loadSettings(): Promise<void>;
  hydrateRpcPreferences(): Promise<void>;
  requestSync(): void;
  flushPendingSync(): Promise<void>;
  start(): void;
  destroy(): void;
};

export const createNetworkBootstrap = (opts: CreateNetworkBootstrapOptions): NetworkBootstrap => {
  const {
    network,
    chainRegistry,
    settings,
    networkRpcPort,
    hydrationEnabled,
    now,
    logger,
    getIsHydrating,
    getIsDestroyed,
    networkRpcDebounceMs,
  } = opts;

  let cachedSettings: SettingsRecord | null = null;
  let hydratedPrefs: Map<ChainRef, HydratedPreference> | null = null;
  let pendingSync = false;

  let listenersAttached = false;
  let unsubscribeRegistry: (() => void) | null = null;
  let unsubscribeActiveChainPersist: (() => void) | null = null;

  const networkRpcSync =
    networkRpcPort === undefined
      ? undefined
      : createNetworkRpcSync({
          port: networkRpcPort,
          network,
          now,
          logger: (message, error) => logger(message, error),
          ...(networkRpcDebounceMs !== undefined ? { debounceMs: networkRpcDebounceMs } : {}),
        });

  let networkRpcSyncAttached = false;

  const readRegistryChains = (): ChainMetadata[] => chainRegistry.getChains().map((entry) => entry.metadata);

  const computeRpcState = (
    registryChains: ChainMetadata[],
    current: ReturnType<typeof network.getState>,
  ): Record<ChainRef, RpcEndpointState> => {
    return Object.fromEntries(
      registryChains.map((chain) => {
        const fromCurrent = current.rpc[chain.chainRef];
        const base = fromCurrent ?? buildDefaultEndpointState(chain);

        const pref = hydratedPrefs?.get(chain.chainRef) ?? null;
        if (!pref) {
          return [chain.chainRef, base] as const;
        }

        // Apply hydrated preference only once per chainRef.
        hydratedPrefs?.delete(chain.chainRef);

        const safeIndex = Math.min(pref.activeIndex, Math.max(0, base.endpoints.length - 1));
        const next: RpcEndpointState = {
          ...base,
          activeIndex: safeIndex,
          strategy: pref.strategy,
        };

        return [chain.chainRef, next] as const;
      }),
    ) as Record<ChainRef, RpcEndpointState>;
  };

  const selectActiveChainRef = (
    current: ReturnType<typeof network.getState>,
    registryChains: ChainMetadata[],
  ): ChainRef => {
    if (registryChains.length === 0) {
      return current.activeChain;
    }

    const available = new Set(registryChains.map((chain) => chain.chainRef));

    const preferred = cachedSettings?.activeChainRef ?? null;
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

  const syncFromRegistry = async () => {
    const registryChains = readRegistryChains();
    if (registryChains.length === 0) {
      pendingSync = false;
      return;
    }

    const current = network.getState();
    const nextActive = selectActiveChainRef(current, registryChains);
    const didChange = current.activeChain !== nextActive;

    const rpc = computeRpcState(registryChains, current);

    if (hydratedPrefs?.size === 0) {
      hydratedPrefs = null;
    }

    network.replaceState({
      activeChain: nextActive,
      knownChains: registryChains,
      rpc,
    });

    // Persist any corrections even when the active chain didn't change (e.g. stale settings fallback).
    if (!didChange && settings && !getIsHydrating() && cachedSettings?.activeChainRef !== nextActive) {
      try {
        cachedSettings = await settings.upsert({ activeChainRef: nextActive });
      } catch (error) {
        logger("settings: failed to persist corrected activeChainRef", error);
      }
    }

    pendingSync = false;
  };

  const requestSync = () => {
    pendingSync = true;
    if (getIsHydrating()) {
      return;
    }
    void syncFromRegistry().catch((error) => logger("network: failed to sync from registry", error));
  };

  const attachListeners = () => {
    if (listenersAttached) {
      return;
    }
    listenersAttached = true;

    unsubscribeRegistry = chainRegistry.onStateChanged(() => requestSync());

    unsubscribeActiveChainPersist = network.onChainChanged((chain) => {
      if (getIsDestroyed()) return;
      if (!settings) return;
      if (getIsHydrating()) return;

      void settings
        .upsert({ activeChainRef: chain.chainRef })
        .then((next) => {
          cachedSettings = next;
        })
        .catch((error) => {
          logger("settings: failed to persist activeChainRef", error);
        });
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

    if (unsubscribeActiveChainPersist) {
      try {
        unsubscribeActiveChainPersist();
      } catch (error) {
        logger("lifecycle: failed to remove activeChain persist listener", error);
      }
      unsubscribeActiveChainPersist = null;
    }
  };

  const loadSettings = async () => {
    if (!settings) {
      cachedSettings = null;
      return;
    }

    try {
      cachedSettings = await settings.get();
    } catch (error) {
      logger("settings: failed to load", error);
      cachedSettings = null;
    }
  };

  const hydrateRpcPreferences = async () => {
    if (!networkRpcPort || !hydrationEnabled) {
      return;
    }

    try {
      const rows = await networkRpcPort.getAll();
      const next = new Map<ChainRef, HydratedPreference>();
      for (const row of rows) {
        next.set(row.chainRef, { activeIndex: row.activeIndex, strategy: row.strategy });
      }
      hydratedPrefs = next;
    } catch (error) {
      logger("storage: failed to hydrate network rpc preferences", error);
    }
  };

  const flushPendingSync = async () => {
    if (!pendingSync) {
      return;
    }
    await syncFromRegistry();
  };

  const start = () => {
    attachListeners();
    requestSync();

    if (networkRpcSync && !networkRpcSyncAttached) {
      networkRpcSync.attach();
      networkRpcSyncAttached = true;
    }
  };

  const destroy = () => {
    detachListeners();

    if (networkRpcSyncAttached) {
      networkRpcSync?.detach();
      networkRpcSyncAttached = false;
    }
  };

  return {
    loadSettings,
    hydrateRpcPreferences,
    requestSync,
    flushPendingSync,
    start,
    destroy,
  };
};
