import { ArxReasons, arxError } from "@arx/errors";
import type { ChainRef } from "../../../chains/ids.js";
import { type ChainMetadata, cloneChainMetadata } from "../../../chains/metadata.js";
import type { ChainDefinitionsController } from "../../../controllers/chainDefinitions/types.js";
import type { NetworkController } from "../../../controllers/network/types.js";
import type { NetworkPreferencesService } from "../../store/networkPreferences/types.js";
import type {
  ChainService,
  ChainView,
  ProviderMetaSnapshot,
  ResolveEip155SwitchTargetParams,
  UiNetworksSnapshot,
} from "./types.js";

type CreateChainServiceOptions = {
  chainDefinitions: ChainDefinitionsController;
  network: NetworkController;
  preferences?: NetworkPreferencesService;
};

const sortChainRefs = (chainRefs: ChainRef[]) => [...chainRefs].sort((a, b) => a.localeCompare(b));

const toChainView = (metadata: ChainMetadata): ChainView => ({
  chainRef: metadata.chainRef,
  chainId: metadata.chainId,
  namespace: metadata.namespace,
  displayName: metadata.displayName,
  shortName: metadata.shortName ?? null,
  icon: metadata.icon?.url ?? null,
  nativeCurrency: {
    name: metadata.nativeCurrency.name,
    symbol: metadata.nativeCurrency.symbol,
    decimals: metadata.nativeCurrency.decimals,
  },
});

const sortChainViews = (views: ChainView[]) => [...views].sort((a, b) => a.chainRef.localeCompare(b.chainRef));

class DefaultChainService implements ChainService {
  readonly #chainDefinitions: ChainDefinitionsController;
  readonly #network: NetworkController;

  constructor(options: CreateChainServiceOptions) {
    this.#chainDefinitions = options.chainDefinitions;
    this.#network = options.network;
  }

  getActiveChainView(): ChainView {
    return toChainView(this.#network.getActiveChain());
  }

  listKnownChainsView(): ChainView[] {
    const views = this.#chainDefinitions.getState().chains.map((entry) => toChainView(entry.metadata));
    return sortChainViews(views);
  }

  listAvailableChainsView(): ChainView[] {
    const views = this.#listAvailableMetadata().map(toChainView);
    return sortChainViews(views);
  }

  buildUiNetworksSnapshot(): UiNetworksSnapshot {
    const active = this.#network.getState().activeChainRef;

    return {
      active,
      known: this.listKnownChainsView(),
      available: this.listAvailableChainsView(),
    };
  }

  buildProviderMeta(): ProviderMetaSnapshot {
    const active = this.#network.getActiveChain();

    return {
      activeChain: active.chainRef,
      activeNamespace: active.namespace,
      supportedChains: sortChainRefs([...this.#network.getState().availableChainRefs]),
    };
  }

  resolveEip155SwitchTarget(params: ResolveEip155SwitchTargetParams): ChainMetadata {
    const target = this.#listAvailableMetadata().find((item) => {
      if (params.chainRef && item.chainRef === params.chainRef) {
        return true;
      }

      if (params.chainId) {
        const candidateChainId = typeof item.chainId === "string" ? item.chainId.toLowerCase() : null;
        if (candidateChainId && candidateChainId === params.chainId) {
          return true;
        }
      }

      return false;
    });

    if (!target) {
      throw arxError({
        reason: ArxReasons.ChainNotFound,
        message: "Requested chain is not registered with ARX",
        data: { chainId: params.chainId, chainRef: params.chainRef },
      });
    }

    if (target.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: "Requested chain is not compatible with wallet_switchEthereumChain",
        data: { chainRef: target.chainRef },
      });
    }

    const supportsFeature = target.features?.includes("wallet_switchEthereumChain") ?? false;
    if (!supportsFeature) {
      throw arxError({
        reason: ArxReasons.ChainNotSupported,
        message: "Requested chain does not support wallet_switchEthereumChain",
        data: { chainRef: target.chainRef },
      });
    }

    return cloneChainMetadata(target);
  }

  #listAvailableMetadata(): ChainMetadata[] {
    const available: ChainMetadata[] = [];

    for (const chainRef of this.#network.getState().availableChainRefs) {
      const networkChain = this.#network.getChain(chainRef);
      if (networkChain) {
        available.push(networkChain);
        continue;
      }

      const registryChain = this.#chainDefinitions.getChain(chainRef)?.metadata;
      if (registryChain) {
        available.push(cloneChainMetadata(registryChain));
      }
    }

    return available;
  }
}

export const createChainService = (options: CreateChainServiceOptions): ChainService => {
  return new DefaultChainService(options);
};
