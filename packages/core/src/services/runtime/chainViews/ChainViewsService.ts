import {
  type ApprovalChainContextRecord,
  type ApprovalChainContextRequest,
  deriveApprovalReviewContext,
} from "../../../approvals/chainContext.js";
import { getChainRefNamespace } from "../../../chains/caip.js";
import type { ChainDefinition } from "../../../chains/definition.js";
import { ChainNotAvailableError, ChainNotFoundError, ChainNotSupportedError } from "../../../chains/errors.js";
import type { ChainRef } from "../../../chains/ids.js";
import { cloneChainDefinition } from "../../../chains/metadata.js";
import type { ChainRpcReader } from "../../../chains/rpc/types.js";
import type { SupportedChainsService } from "../../../chains/runtime/supportedChains/types.js";
import type { WalletChainSelectionService } from "../../store/walletChainSelection/types.js";
import type {
  ApprovalReviewChainViewParams,
  ChainView,
  ChainViewsService,
  FindAvailableChainViewParams,
  NetworksSnapshot,
} from "./types.js";

type CreateChainViewsServiceOptions = {
  supportedChains: SupportedChainsService;
  chainRpc: ChainRpcReader;
  selection: Pick<WalletChainSelectionService, "getSelectedChainRef" | "getSelectedNamespace">;
};

const toChainView = (definition: ChainDefinition): ChainView => ({
  chainRef: definition.chainRef,
  namespace: getChainRefNamespace(definition.chainRef),
  displayName: definition.displayName,
  shortName: definition.shortName ?? null,
  icon: definition.icon?.url ?? null,
  nativeCurrency: {
    name: definition.nativeCurrency.name,
    symbol: definition.nativeCurrency.symbol,
    decimals: definition.nativeCurrency.decimals,
  },
});

const sortChainViews = (views: ChainView[]) => [...views].sort((a, b) => a.chainRef.localeCompare(b.chainRef));

class DefaultChainViewsService implements ChainViewsService {
  readonly #supportedChains: SupportedChainsService;
  readonly #chainRpc: ChainRpcReader;
  readonly #selection: Pick<WalletChainSelectionService, "getSelectedChainRef" | "getSelectedNamespace">;

  constructor(options: CreateChainViewsServiceOptions) {
    this.#supportedChains = options.supportedChains;
    this.#chainRpc = options.chainRpc;
    this.#selection = options.selection;
  }

  getSelectedNamespace(): string {
    return this.#resolveSelectedNamespace();
  }

  getSelectedChainView(): ChainView {
    return this.getActiveChainViewForNamespace(this.#resolveSelectedNamespace());
  }

  getActiveChainViewForNamespace(namespace: string): ChainView {
    return toChainView(this.requireAvailableChainDefinition(this.#resolveActiveChainRefForNamespace(namespace)));
  }

  getApprovalReviewChainView(params: ApprovalReviewChainViewParams): ChainView {
    const context = this.#deriveApprovalReviewContext(params.record, params.request);
    return toChainView(this.requireChainDefinition(context.reviewChainRef));
  }

  requireChainDefinition(chainRef: ChainRef): ChainDefinition {
    return this.#getRequiredChainDefinition(chainRef);
  }

  requireAvailableChainDefinition(chainRef: ChainRef): ChainDefinition {
    const entry = this.#supportedChains.getChain(chainRef);
    if (!entry) {
      throw new ChainNotFoundError();
    }

    if (!this.#chainRpc.hasEndpoints(chainRef)) {
      throw new ChainNotAvailableError();
    }

    return cloneChainDefinition(entry.definition);
  }

  findAvailableChainView(params: FindAvailableChainViewParams): ChainView | null {
    if (params.chainRef) {
      try {
        const view = toChainView(this.requireAvailableChainDefinition(params.chainRef));
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
    const views = this.#supportedChains.getState().chains.map((entry) => toChainView(entry.definition));
    return sortChainViews(views);
  }

  listAvailableChainViews(): ChainView[] {
    const views = this.#listAvailableDefinitions().map(toChainView);
    return sortChainViews(views);
  }

  buildWalletNetworksSnapshot(): NetworksSnapshot {
    const selectedNamespace = this.#resolveSelectedNamespace();
    const active = this.getActiveChainViewForNamespace(selectedNamespace).chainRef;

    return {
      selectedNamespace,
      active,
      known: this.listKnownChainViews(),
      available: this.listAvailableChainViews(),
    };
  }

  #listAvailableDefinitions(): ChainDefinition[] {
    return this.#chainRpc.listChainRefs().map((chainRef) => this.requireAvailableChainDefinition(chainRef));
  }

  #deriveApprovalReviewContext(record: ApprovalChainContextRecord, request?: ApprovalChainContextRequest) {
    return deriveApprovalReviewContext(record, request ? { request } : undefined);
  }

  #resolveActiveChainRefForNamespace(namespace: string, availableChainRefs = this.#chainRpc.listChainRefs()): ChainRef {
    const activeChainByNamespace = this.#resolveActiveChainByNamespace(availableChainRefs);
    const activeChain = activeChainByNamespace[namespace];
    if (activeChain) {
      return activeChain;
    }

    throw new ChainNotSupportedError({
      message: `No available chain for namespace "${namespace}"`,
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
      const activeChainRef = this.#selection.getSelectedChainRef(namespace);
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
    const selectedNamespace = this.#selection.getSelectedNamespace().trim();
    if (selectedNamespace.length === 0) {
      throw new ChainNotSupportedError({
        message: "Missing selected namespace",
      });
    }
    return selectedNamespace;
  }

  #getRequiredChainDefinition(chainRef: ChainRef): ChainDefinition {
    const definition = this.#supportedChains.getChain(chainRef)?.definition;
    if (!definition) {
      throw new ChainNotFoundError();
    }
    return cloneChainDefinition(definition);
  }
}

export const createChainViewsService = (options: CreateChainViewsServiceOptions): ChainViewsService => {
  return new DefaultChainViewsService(options);
};
