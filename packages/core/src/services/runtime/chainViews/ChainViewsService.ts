import { ArxReasons, arxError } from "@arx/errors";
import { chainErrors } from "../../../chains/errors.js";
import type { ChainRef } from "../../../chains/ids.js";
import { type ChainMetadata, cloneChainMetadata } from "../../../chains/metadata.js";
import type { ChainDefinitionsController } from "../../../controllers/chainDefinitions/types.js";
import type { NetworkController } from "../../../controllers/network/types.js";
import type {
  ChainView,
  ChainViewsService,
  FindAvailableChainViewParams,
  ProviderMetaSnapshot,
  ResolveEip155SwitchChainParams,
  UiNetworksSnapshot,
} from "./types.js";

type CreateChainViewsServiceOptions = {
  chainDefinitions: ChainDefinitionsController;
  network: NetworkController;
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

class DefaultChainViewsService implements ChainViewsService {
  readonly #chainDefinitions: ChainDefinitionsController;
  readonly #network: NetworkController;

  constructor(options: CreateChainViewsServiceOptions) {
    this.#chainDefinitions = options.chainDefinitions;
    this.#network = options.network;
  }

  getActiveChainView(): ChainView {
    const activeChainRef = this.#network.getState().activeChainRef;
    return toChainView(this.requireChainMetadata(activeChainRef));
  }

  requireChainMetadata(chainRef: ChainRef): ChainMetadata {
    return this.#getRequiredChainMetadata(chainRef);
  }

  requireAvailableChainMetadata(chainRef: ChainRef): ChainMetadata {
    const entry = this.#chainDefinitions.getChain(chainRef);
    if (!entry) {
      throw chainErrors.notFound({ chainRef });
    }

    const isAvailable = this.#network
      .getState()
      .availableChainRefs.some((availableChainRef) => availableChainRef === chainRef);
    if (!isAvailable) {
      throw chainErrors.notAvailable({ chainRef });
    }

    return cloneChainMetadata(entry.metadata);
  }

  findAvailableChainView(params: FindAvailableChainViewParams): ChainView | null {
    if (params.chainRef) {
      try {
        const view = toChainView(this.requireAvailableChainMetadata(params.chainRef));
        if (params.namespace && view.namespace !== params.namespace) {
          return null;
        }
        return view;
      } catch {
        return null;
      }
    }

    if (params.namespace) {
      return this.listAvailableChainViews().find((chain) => chain.namespace === params.namespace) ?? null;
    }

    return null;
  }

  listKnownChainViews(): ChainView[] {
    const views = this.#chainDefinitions.getState().chains.map((entry) => toChainView(entry.metadata));
    return sortChainViews(views);
  }

  listAvailableChainViews(): ChainView[] {
    const views = this.#listAvailableMetadata().map(toChainView);
    return sortChainViews(views);
  }

  buildUiNetworksSnapshot(): UiNetworksSnapshot {
    const active = this.#network.getState().activeChainRef;

    return {
      active,
      known: this.listKnownChainViews(),
      available: this.listAvailableChainViews(),
    };
  }

  buildProviderMeta(): ProviderMetaSnapshot {
    const active = this.#getRequiredChainMetadata(this.#network.getState().activeChainRef);

    return {
      activeChain: active.chainRef,
      activeNamespace: active.namespace,
      supportedChains: sortChainRefs([...this.#network.getState().availableChainRefs]),
    };
  }

  resolveEip155SwitchChain(params: ResolveEip155SwitchChainParams): ChainMetadata {
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
      throw chainErrors.notFound({
        ...(params.chainId ? { chainId: params.chainId } : {}),
        ...(params.chainRef ? { chainRef: params.chainRef } : {}),
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
    return this.#network.getState().availableChainRefs.map((chainRef) => this.requireAvailableChainMetadata(chainRef));
  }

  #getRequiredChainMetadata(chainRef: ChainRef): ChainMetadata {
    const metadata = this.#chainDefinitions.getChain(chainRef)?.metadata;
    if (!metadata) {
      throw chainErrors.notFound({ chainRef });
    }
    return cloneChainMetadata(metadata);
  }
}

export const createChainViewsService = (options: CreateChainViewsServiceOptions): ChainViewsService => {
  return new DefaultChainViewsService(options);
};
