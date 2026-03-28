import { ArxReasons, arxError } from "@arx/errors";
import {
  type ApprovalChainContextRecord,
  type ApprovalChainContextRequest,
  deriveApprovalReviewContext,
} from "../../../approvals/chainContext.js";
import { getChainRefNamespace } from "../../../chains/caip.js";
import { chainErrors } from "../../../chains/errors.js";
import type { ChainRef } from "../../../chains/ids.js";
import { type ChainMetadata, cloneChainMetadata } from "../../../chains/metadata.js";
import type { ChainDefinitionsController } from "../../../controllers/chainDefinitions/types.js";
import type { NetworkController } from "../../../controllers/network/types.js";
import type { NetworkPreferencesService } from "../../store/networkPreferences/types.js";
import type {
  ApprovalReviewChainViewParams,
  ChainView,
  ChainViewsService,
  FindAvailableChainViewParams,
  ProviderMetaSnapshot,
  UiNetworksSnapshot,
} from "./types.js";

type CreateChainViewsServiceOptions = {
  chainDefinitions: ChainDefinitionsController;
  network: NetworkController;
  preferences: Pick<NetworkPreferencesService, "getActiveChainRef" | "getSelectedNamespace">;
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
  readonly #preferences: Pick<NetworkPreferencesService, "getActiveChainRef" | "getSelectedNamespace">;

  constructor(options: CreateChainViewsServiceOptions) {
    this.#chainDefinitions = options.chainDefinitions;
    this.#network = options.network;
    this.#preferences = options.preferences;
  }

  getSelectedChainView(): ChainView {
    return this.getActiveChainViewForNamespace(this.#resolveSelectedNamespace());
  }

  getActiveChainViewForNamespace(namespace: string): ChainView {
    return toChainView(this.requireAvailableChainMetadata(this.#resolveActiveChainRefForNamespace(namespace)));
  }

  getApprovalReviewChainView(params: ApprovalReviewChainViewParams): ChainView {
    const context = this.#deriveApprovalReviewContext(params.record, params.request);
    return toChainView(this.requireChainMetadata(context.reviewChainRef));
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

  buildWalletNetworksSnapshot(): UiNetworksSnapshot {
    const selectedNamespace = this.#resolveSelectedNamespace();
    const active = this.getActiveChainViewForNamespace(selectedNamespace).chainRef;

    return {
      selectedNamespace,
      active,
      known: this.listKnownChainViews(),
      available: this.listAvailableChainViews(),
    };
  }

  buildProviderMeta(namespace: string): ProviderMetaSnapshot {
    const availableChainRefs = sortChainRefs([...this.#network.getState().availableChainRefs]);
    const activeChainByNamespace = this.#resolveActiveChainByNamespace(availableChainRefs);
    const activeChain =
      activeChainByNamespace[namespace] ?? this.#resolveActiveChainRefForNamespace(namespace, availableChainRefs);

    const active = this.#getRequiredChainMetadata(activeChain as ChainRef);

    return {
      activeChain: active.chainRef,
      activeNamespace: active.namespace,
      activeChainByNamespace,
      supportedChains: availableChainRefs,
    };
  }

  #listAvailableMetadata(): ChainMetadata[] {
    return this.#network.getState().availableChainRefs.map((chainRef) => this.requireAvailableChainMetadata(chainRef));
  }

  #deriveApprovalReviewContext(record: ApprovalChainContextRecord, request?: ApprovalChainContextRequest) {
    return deriveApprovalReviewContext(record, request ? { request } : undefined);
  }

  #resolveActiveChainRefForNamespace(
    namespace: string,
    availableChainRefs = sortChainRefs([...this.#network.getState().availableChainRefs]),
  ): ChainRef {
    const activeChainByNamespace = this.#resolveActiveChainByNamespace(availableChainRefs);
    const activeChain = activeChainByNamespace[namespace];
    if (activeChain) {
      return activeChain;
    }

    throw arxError({
      reason: ArxReasons.ChainNotSupported,
      message: `No available chain for namespace "${namespace}"`,
      data: { namespace },
    });
  }

  #resolveActiveChainByNamespace(availableChainRefs: ChainRef[]): Record<string, ChainRef> {
    const grouped = new Map<string, ChainRef[]>();

    for (const chainRef of availableChainRefs) {
      const namespace = getChainRefNamespace(chainRef);
      const current = grouped.get(namespace);
      if (current) {
        current.push(chainRef);
      } else {
        grouped.set(namespace, [chainRef]);
      }
    }

    const next: Record<string, ChainRef> = {};
    for (const [namespace, chainRefs] of grouped) {
      const activeChainRef = this.#preferences.getActiveChainRef(namespace);
      if (activeChainRef && chainRefs.includes(activeChainRef)) {
        next[namespace] = activeChainRef;
        continue;
      }

      const first = chainRefs[0];
      if (first) {
        next[namespace] = first;
      }
    }

    return next;
  }

  #resolveSelectedNamespace(): string {
    const selectedNamespace = this.#preferences.getSelectedNamespace().trim();
    if (selectedNamespace.length === 0) {
      throw arxError({
        reason: ArxReasons.ChainNotSupported,
        message: "Missing selected namespace",
      });
    }
    return selectedNamespace;
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
