import { getChainRefNamespace } from "../../chains/caip.js";
import { ChainRpcAccessConfigError } from "../../chains/errors.js";
import type { ChainRef } from "../../chains/ids.js";
import { assertNonEmptyRpcEndpoints } from "../../chains/rpc/config.js";
import type {
  ChainRpcDefaultEndpointsSeed,
  ChainRpcDefaultEndpointsService,
} from "../../chains/rpc/defaultEndpoints/types.js";
import type { ChainRpcEndpointOverridesService } from "../../chains/rpc/endpointOverrides/types.js";
import type { ChainRpcAccess, ChainRpcAccessUpdater } from "../../chains/rpc/types.js";
import type { ChainDefinitionsService } from "../../chains/runtime/chainDefinitions/types.js";
import type { WalletChainSelectionService } from "../../chains/selection/wallet/types.js";
import type { RuntimeWalletChainSelectionDefaults } from "./chainRpcDefaults.js";
import { RuntimeHydrationError } from "./errors.js";

export type CreateChainRpcBootstrapOptions = {
  chainRpcAccessUpdater: ChainRpcAccessUpdater;
  chainDefinitions: ChainDefinitionsService;
  selection: WalletChainSelectionService;
  defaultEndpoints: ChainRpcDefaultEndpointsService;
  defaultEndpointSeeds: readonly ChainRpcDefaultEndpointsSeed[];
  endpointOverrides: ChainRpcEndpointOverridesService;
  selectionDefaults: RuntimeWalletChainSelectionDefaults;
  hydrationEnabled: boolean;
  getIsHydrating: () => boolean;
  getRegisteredNamespaces: () => ReadonlySet<string>;
};

export type ChainRpcBootstrap = {
  loadStoredChainState(): Promise<void>;
  refreshChainRpcAccesses(): void;
  cleanStoredChainState(): Promise<void>;
  start(): void;
};

export const createChainRpcBootstrap = (opts: CreateChainRpcBootstrapOptions): ChainRpcBootstrap => {
  const {
    chainRpcAccessUpdater,
    chainDefinitions,
    selection,
    defaultEndpoints,
    defaultEndpointSeeds,
    endpointOverrides,
    selectionDefaults,
    hydrationEnabled,
    getIsHydrating,
    getRegisteredNamespaces,
  } = opts;

  let selectionLoaded = !hydrationEnabled;
  let defaultEndpointsLoaded = !hydrationEnabled;
  let endpointOverridesLoaded = !hydrationEnabled;

  const listChainDefinitionsForRegisteredNamespaces = () =>
    chainDefinitions.getState().chains.filter((entry) => getRegisteredNamespaces().has(entry.namespace));

  const buildDefaultEndpointReplacementSeeds = (): ChainRpcDefaultEndpointsSeed[] => {
    const supportedChainRefs = new Set(listChainDefinitionsForRegisteredNamespaces().map((entry) => entry.chainRef));
    const registeredNamespaces = getRegisteredNamespaces();
    return defaultEndpointSeeds.filter(
      (entry) =>
        registeredNamespaces.has(getChainRefNamespace(entry.chainRef)) && supportedChainRefs.has(entry.chainRef),
    );
  };

  const readSupportedChainRpcAccesses = (): ChainRpcAccess[] => {
    const accesses: ChainRpcAccess[] = [];
    for (const entry of listChainDefinitionsForRegisteredNamespaces()) {
      const endpoints =
        endpointOverrides.readEndpointOverride(entry.chainRef) ?? defaultEndpoints.readDefaultEndpoints(entry.chainRef);
      if (!endpoints) {
        throw new ChainRpcAccessConfigError({ chainRef: entry.chainRef, reason: "missing_endpoints" });
      }

      accesses.push({
        chainRef: entry.chainRef,
        endpoints: assertNonEmptyRpcEndpoints(entry.chainRef, endpoints),
      });
    }
    return accesses;
  };

  const resolveChainRefByNamespace = (accesses: readonly ChainRpcAccess[]): Record<string, ChainRef> => {
    const availableByNamespace = new Map<string, ChainRef[]>();

    for (const access of accesses) {
      const namespace = getChainRefNamespace(access.chainRef);
      const chainRefs = availableByNamespace.get(namespace);
      if (chainRefs) {
        chainRefs.push(access.chainRef);
      } else {
        availableByNamespace.set(namespace, [access.chainRef]);
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
    accesses: readonly ChainRpcAccess[],
    chainRefByNamespace: Record<string, ChainRef>,
  ): string => {
    if (accesses.length === 0) {
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

    const first = accesses[0];
    if (!first) {
      throw new Error("Chain RPC bootstrap expected at least one available chain");
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

    await selection.update({
      ...(shouldPersistNamespace ? { selectedNamespace } : {}),
      ...(shouldPersistChainRefs ? { chainRefByNamespace } : {}),
    });
  };

  const pruneUnavailableEndpointOverrides = async (availableChainRefs: Set<ChainRef>) => {
    const records = await endpointOverrides.getAll();

    for (const record of records) {
      if (availableChainRefs.has(record.chainRef)) {
        continue;
      }

      await endpointOverrides.clearEndpointOverride(record.chainRef);
    }
  };

  const loadPersistedState = async () => {
    if (!hydrationEnabled) {
      selectionLoaded = true;
      defaultEndpointsLoaded = true;
      endpointOverridesLoaded = true;
      return;
    }

    if (!selectionLoaded) {
      try {
        await selection.get();
        selectionLoaded = true;
      } catch (error) {
        throw new RuntimeHydrationError({
          owner: "chains",
          resource: "walletChainSelection",
          cause: error,
        });
      }
    }

    if (!defaultEndpointsLoaded) {
      try {
        await defaultEndpoints.getAll();
        defaultEndpointsLoaded = true;
      } catch (error) {
        throw new RuntimeHydrationError({
          owner: "chains",
          resource: "chainRpcDefaultEndpoints",
          cause: error,
        });
      }
    }

    if (!endpointOverridesLoaded) {
      try {
        await endpointOverrides.getAll();
        endpointOverridesLoaded = true;
      } catch (error) {
        throw new RuntimeHydrationError({
          owner: "chains",
          resource: "chainRpcEndpointOverrides",
          cause: error,
        });
      }
    }
  };

  const refreshChainRpcAccesses = () => {
    const accesses = readSupportedChainRpcAccesses();
    chainRpcAccessUpdater.replaceAccesses(accesses);
  };

  const cleanStoredChainState = async () => {
    if (getIsHydrating()) {
      return;
    }

    const accesses = readSupportedChainRpcAccesses();
    const availableChainRefs = new Set(accesses.map((access) => access.chainRef));
    if (accesses.length === 0) {
      await pruneUnavailableEndpointOverrides(availableChainRefs);
      return;
    }

    const nextChainRefByNamespace = resolveChainRefByNamespace(accesses);
    const nextSelectedNamespace = selectNamespace(accesses, nextChainRefByNamespace);

    await persistSelectionIfNeeded(nextSelectedNamespace, nextChainRefByNamespace);
    await pruneUnavailableEndpointOverrides(availableChainRefs);
  };

  let listenersAttached = false;
  const attachListeners = () => {
    if (listenersAttached) return;
    listenersAttached = true;
    chainDefinitions.onStateChanged(() => refreshChainRpcAccesses());
    defaultEndpoints.subscribeChanged(() => refreshChainRpcAccesses());
    endpointOverrides.subscribeChanged(() => refreshChainRpcAccesses());
  };

  const loadStoredChainState = async () => {
    await loadPersistedState();
    await defaultEndpoints.replaceDefaultEndpoints(buildDefaultEndpointReplacementSeeds());
  };

  const start = () => {
    attachListeners();
  };

  return {
    loadStoredChainState,
    refreshChainRpcAccesses,
    cleanStoredChainState,
    start,
  };
};
