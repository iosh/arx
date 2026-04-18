import { getChainRefNamespace } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import { buildNetworkChainConfigs, createNetworkRuntimeInput } from "../../controllers/network/config.js";
import type { NetworkChainConfig, NetworkController, RpcRoutingState } from "../../controllers/network/types.js";
import type { SupportedChainsController } from "../../controllers/supportedChains/types.js";
import type { CustomRpcService } from "../../services/store/customRpc/types.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
import { buildDefaultRoutingState } from "./constants.js";
import type { RuntimeNetworkSelectionDefaults } from "./networkDefaults.js";

export type CreateNetworkBootstrapOptions = {
  network: NetworkController;
  supportedChains: SupportedChainsController;
  selection: NetworkSelectionService;
  customRpc: CustomRpcService;
  selectionDefaults: RuntimeNetworkSelectionDefaults;
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
  const {
    network,
    supportedChains,
    selection,
    customRpc,
    selectionDefaults,
    hydrationEnabled,
    logger,
    getIsHydrating,
    getRegisteredNamespaces,
  } = opts;

  let selectionLoaded = !hydrationEnabled;
  let customRpcLoaded = !hydrationEnabled;
  let pendingSync = false;

  let listenersAttached = false;
  let unsubscribeSupportedChains: (() => void) | null = null;
  let unsubscribeCustomRpc: (() => void) | null = null;

  let syncInFlight: Promise<void> | null = null;

  const readSupportedChainConfigs = (): NetworkChainConfig[] =>
    buildNetworkChainConfigs(
      supportedChains
        .getState()
        .chains.filter((entry) => getRegisteredNamespaces().has(entry.namespace))
        .map((entry) => ({
          chainRef: entry.metadata.chainRef,
          rpcEndpoints: customRpc.getRpcEndpoints(entry.chainRef) ?? entry.metadata.rpcEndpoints,
        })),
    );

  const computeRpcState = (
    chainConfigs: NetworkChainConfig[],
    current: ReturnType<typeof network.getState>,
  ): Record<ChainRef, RpcRoutingState> => {
    return Object.fromEntries(
      chainConfigs.map((chain) => {
        const fromCurrent = current.rpc[chain.chainRef];
        const base = fromCurrent ?? buildDefaultRoutingState(chain);
        const safeIndex = Math.min(base.activeIndex, Math.max(0, chain.rpcEndpoints.length - 1));

        return [
          chain.chainRef,
          {
            ...base,
            activeIndex: safeIndex,
          },
        ] as const;
      }),
    ) as Record<ChainRef, RpcRoutingState>;
  };

  const resolveChainRefByNamespace = (chainConfigs: NetworkChainConfig[]): Record<string, ChainRef> => {
    const availableByNamespace = new Map<string, ChainRef[]>();

    for (const chain of chainConfigs) {
      const namespace = getChainRefNamespace(chain.chainRef);
      const chainRefs = availableByNamespace.get(namespace);
      if (chainRefs) {
        chainRefs.push(chain.chainRef);
      } else {
        availableByNamespace.set(namespace, [chain.chainRef]);
      }
    }

    const selectedChainRefByNamespace = selection.getChainRefByNamespace();
    const next: Record<string, ChainRef> = {};

    for (const [namespace, chainRefs] of availableByNamespace) {
      const selectedChainRef = selectedChainRefByNamespace[namespace] ?? null;
      if (selectedChainRef && chainRefs.includes(selectedChainRef)) {
        next[namespace] = selectedChainRef;
        continue;
      }

      const fallbackChainRef = selectionDefaults.chainRefByNamespace[namespace] ?? null;
      if (fallbackChainRef && chainRefs.includes(fallbackChainRef)) {
        next[namespace] = fallbackChainRef;
        continue;
      }

      const first = chainRefs[0];
      if (first) {
        next[namespace] = first;
      }
    }

    return next;
  };

  const selectNamespace = (
    chainConfigs: NetworkChainConfig[],
    chainRefByNamespace: Record<string, ChainRef>,
  ): string => {
    if (chainConfigs.length === 0) {
      return selection.getSelectedNamespace();
    }

    const availableNamespaces = new Set(Object.keys(chainRefByNamespace));
    const selectedNamespace = selection.getSelectedNamespace();
    if (availableNamespaces.has(selectedNamespace)) {
      return selectedNamespace;
    }

    if (availableNamespaces.has(selectionDefaults.selectedNamespace)) {
      return selectionDefaults.selectedNamespace;
    }

    const first = chainConfigs[0];
    if (!first) {
      throw new Error("Network bootstrap expected at least one available chain");
    }

    return getChainRefNamespace(first.chainRef);
  };

  const persistSelectionIfNeeded = async (selectedNamespace: string, chainRefByNamespace: Record<string, ChainRef>) => {
    const currentSelection = selection.getSnapshot();
    const previousNamespace = currentSelection?.selectedNamespace ?? null;
    const previousChainRefByNamespace = currentSelection?.chainRefByNamespace ?? {};
    const shouldPersistNamespace = previousNamespace !== selectedNamespace;
    const shouldPersistChainRefs =
      Object.keys(previousChainRefByNamespace).length !== Object.keys(chainRefByNamespace).length ||
      Object.entries(chainRefByNamespace).some(
        ([namespace, chainRef]) => previousChainRefByNamespace[namespace] !== chainRef,
      );

    if (!shouldPersistNamespace && !shouldPersistChainRefs) {
      return;
    }

    try {
      await selection.update({
        ...(shouldPersistNamespace ? { selectedNamespace } : {}),
        ...(shouldPersistChainRefs ? { chainRefByNamespace } : {}),
      });
    } catch (error) {
      logger("selection: failed to persist corrected selection", error);
    }
  };

  const pruneUnavailableCustomRpc = async (availableChainRefs: Set<ChainRef>) => {
    let records: Awaited<ReturnType<CustomRpcService["getAll"]>>;
    try {
      records = await customRpc.getAll();
    } catch (error) {
      logger("customRpc: failed to read overrides for pruning", error);
      return;
    }

    for (const record of records) {
      if (availableChainRefs.has(record.chainRef)) {
        continue;
      }

      try {
        await customRpc.clear(record.chainRef);
      } catch (error) {
        logger(`customRpc: failed to clear unavailable override "${record.chainRef}"`, error);
      }
    }
  };

  const loadPersistedState = async () => {
    if (!hydrationEnabled) {
      selectionLoaded = true;
      customRpcLoaded = true;
      return;
    }

    if (!selectionLoaded) {
      try {
        await selection.get();
      } catch (error) {
        logger("selection: failed to load", error);
      } finally {
        selectionLoaded = true;
      }
    }

    if (!customRpcLoaded) {
      try {
        await customRpc.getAll();
      } catch (error) {
        logger("customRpc: failed to load", error);
      } finally {
        customRpcLoaded = true;
      }
    }
  };

  const syncOnce = async () => {
    if (!selectionLoaded || !customRpcLoaded) {
      await loadPersistedState();
    }

    const chainConfigs = readSupportedChainConfigs();
    if (chainConfigs.length === 0) {
      return;
    }

    const current = network.getState();
    const nextChainRefByNamespace = resolveChainRefByNamespace(chainConfigs);
    const nextSelectedNamespace = selectNamespace(chainConfigs, nextChainRefByNamespace);

    network.replaceState(
      createNetworkRuntimeInput({
        state: {
          availableChainRefs: chainConfigs.map((chain) => chain.chainRef),
          rpc: computeRpcState(chainConfigs, current),
        },
        chainConfigs,
      }),
    );

    if (!getIsHydrating()) {
      await persistSelectionIfNeeded(nextSelectedNamespace, nextChainRefByNamespace);
      await pruneUnavailableCustomRpc(new Set(chainConfigs.map((chain) => chain.chainRef)));
    }
  };

  const requestSync = () => {
    pendingSync = true;
    if (getIsHydrating() || syncInFlight) {
      return;
    }

    syncInFlight = (async () => {
      try {
        while (pendingSync && !getIsHydrating()) {
          pendingSync = false;
          await syncOnce();
        }
      } catch (error) {
        logger("network: failed to sync supported chains", error);
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

    unsubscribeSupportedChains = supportedChains.onStateChanged(() => requestSync());
    unsubscribeCustomRpc = customRpc.subscribeChanged(() => requestSync());
  };

  const detachListeners = () => {
    if (!listenersAttached) {
      return;
    }
    listenersAttached = false;

    if (unsubscribeSupportedChains) {
      try {
        unsubscribeSupportedChains();
      } catch (error) {
        logger("lifecycle: failed to remove supported chains listener", error);
      }
      unsubscribeSupportedChains = null;
    }

    if (unsubscribeCustomRpc) {
      try {
        unsubscribeCustomRpc();
      } catch (error) {
        logger("lifecycle: failed to remove custom rpc listener", error);
      }
      unsubscribeCustomRpc = null;
    }
  };

  const loadPreferences = async () => {
    await loadPersistedState();
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
