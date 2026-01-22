import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata, ChainRegistryPort } from "../../chains/index.js";
import {
  CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION,
  type ChainRegistryEntity,
  ChainRegistryEntitySchema,
} from "../../storage/index.js";
import type {
  ChainRegistryController,
  ChainRegistryMessenger,
  ChainRegistryState,
  ChainRegistryUpdate,
  ChainRegistryUpsertOptions,
} from "./types.js";

const STATE_TOPIC = "chainRegistry:stateChanged";
const UPDATE_TOPIC = "chainRegistry:updated";

const isSameRecord = <T>(
  previous: Record<string, T> | undefined,
  next: Record<string, T> | undefined,
  comparator: (a: T, b: T) => boolean = (a, b) => a === b,
) => {
  if (!previous && !next) return true;
  if (!previous || !next) return false;
  const prevKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  return prevKeys.every((key) => Object.hasOwn(next, key) && comparator(previous[key]!, next[key]!));
};

const isSameHeaders = (previous: Record<string, string> | undefined, next: Record<string, string> | undefined) => {
  return isSameRecord(previous, next);
};

const isSameStringArray = (previous: readonly string[] | undefined, next: readonly string[] | undefined) => {
  if (!previous && !next) return true;
  if (!previous || !next) return false;
  if (previous.length !== next.length) return false;
  return previous.every((value, index) => value === next[index]);
};

const isSameRpcEndpoint = (
  previous: ChainMetadata["rpcEndpoints"][number],
  next: ChainMetadata["rpcEndpoints"][number],
) => {
  return (
    previous.url === next.url &&
    previous.type === next.type &&
    previous.weight === next.weight &&
    isSameHeaders(previous.headers, next.headers)
  );
};

const isSameExplorerLink = (
  previous: NonNullable<ChainMetadata["blockExplorers"]>[number],
  next: NonNullable<ChainMetadata["blockExplorers"]>[number],
) => {
  return previous.type === next.type && previous.url === next.url && previous.title === next.title;
};

const isSameNativeCurrency = (previous: ChainMetadata["nativeCurrency"], next: ChainMetadata["nativeCurrency"]) => {
  return previous.name === next.name && previous.symbol === next.symbol && previous.decimals === next.decimals;
};

const isSameIcon = (previous: ChainMetadata["icon"], next: ChainMetadata["icon"]) => {
  if (!previous && !next) return true;
  if (!previous || !next) return false;
  return (
    previous.url === next.url &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.format === next.format
  );
};

const isSameExtensions = (previous: ChainMetadata["extensions"], next: ChainMetadata["extensions"]) => {
  return isSameRecord(previous, next);
};

const isSameMetadata = (previous: ChainMetadata, next: ChainMetadata) => {
  if (
    previous.chainRef !== next.chainRef ||
    previous.namespace !== next.namespace ||
    previous.chainId !== next.chainId ||
    previous.displayName !== next.displayName ||
    previous.shortName !== next.shortName ||
    previous.description !== next.description
  ) {
    return false;
  }

  if (!isSameNativeCurrency(previous.nativeCurrency, next.nativeCurrency)) {
    return false;
  }

  if (previous.rpcEndpoints.length !== next.rpcEndpoints.length) {
    return false;
  }

  for (let i = 0; i < previous.rpcEndpoints.length; i += 1) {
    if (!isSameRpcEndpoint(previous.rpcEndpoints[i]!, next.rpcEndpoints[i]!)) {
      return false;
    }
  }

  const prevExplorers = previous.blockExplorers;
  const nextExplorers = next.blockExplorers;
  if (!prevExplorers && nextExplorers) return false;
  if (prevExplorers && !nextExplorers) return false;
  if (prevExplorers && nextExplorers) {
    if (prevExplorers.length !== nextExplorers.length) return false;
    for (let i = 0; i < prevExplorers.length; i += 1) {
      if (!isSameExplorerLink(prevExplorers[i]!, nextExplorers[i]!)) {
        return false;
      }
    }
  }

  if (!isSameIcon(previous.icon, next.icon)) {
    return false;
  }

  if (!isSameStringArray(previous.features, next.features)) {
    return false;
  }

  if (!isSameStringArray(previous.tags, next.tags)) {
    return false;
  }

  return isSameExtensions(previous.extensions, next.extensions);
};

const isSameEntity = (previous: ChainRegistryEntity, next: ChainRegistryEntity) => {
  if (
    previous.chainRef !== next.chainRef ||
    previous.namespace !== next.namespace ||
    previous.schemaVersion !== next.schemaVersion ||
    previous.updatedAt !== next.updatedAt
  ) {
    return false;
  }

  return isSameMetadata(previous.metadata, next.metadata);
};

const cloneEntity = (entity: ChainRegistryEntity): ChainRegistryEntity => ({
  chainRef: entity.chainRef,
  namespace: entity.namespace,
  metadata: {
    chainRef: entity.metadata.chainRef,
    namespace: entity.metadata.namespace,
    chainId: entity.metadata.chainId,
    displayName: entity.metadata.displayName,
    shortName: entity.metadata.shortName,
    description: entity.metadata.description,
    nativeCurrency: {
      name: entity.metadata.nativeCurrency.name,
      symbol: entity.metadata.nativeCurrency.symbol,
      decimals: entity.metadata.nativeCurrency.decimals,
    },
    rpcEndpoints: entity.metadata.rpcEndpoints.map((endpoint) => ({
      url: endpoint.url,
      type: endpoint.type,
      weight: endpoint.weight,
      headers: endpoint.headers ? { ...endpoint.headers } : undefined,
    })),
    blockExplorers: entity.metadata.blockExplorers
      ? entity.metadata.blockExplorers.map((explorer) => ({
          type: explorer.type,
          url: explorer.url,
          title: explorer.title,
        }))
      : undefined,
    icon: entity.metadata.icon
      ? {
          url: entity.metadata.icon.url,
          width: entity.metadata.icon.width,
          height: entity.metadata.icon.height,
          format: entity.metadata.icon.format,
        }
      : undefined,
    features: entity.metadata.features ? [...entity.metadata.features] : undefined,
    tags: entity.metadata.tags ? [...entity.metadata.tags] : undefined,
    extensions: entity.metadata.extensions ? { ...entity.metadata.extensions } : undefined,
  },
  schemaVersion: entity.schemaVersion,
  updatedAt: entity.updatedAt,
});

const cloneState = (entities: Iterable<ChainRegistryEntity>): ChainRegistryState => ({
  chains: Array.from(entities, cloneEntity).sort((a, b) => a.chainRef.localeCompare(b.chainRef)),
});

type ControllerOptions = {
  messenger: ChainRegistryMessenger;
  port: ChainRegistryPort;
  now?: () => number;
  logger?: (message: string, error?: unknown) => void;
  seed?: readonly ChainMetadata[];
  schemaVersion?: number;
};

type UpsertResult =
  | { kind: "added"; chain: ChainRegistryEntity }
  | { kind: "updated"; chain: ChainRegistryEntity; previous: ChainRegistryEntity };

export class InMemoryChainRegistryController implements ChainRegistryController {
  #messenger: ChainRegistryMessenger;
  #port: ChainRegistryPort;
  #now: () => number;
  #logger: (message: string, error?: unknown) => void;
  #defaultSchemaVersion: number;
  #chains = new Map<ChainRef, ChainRegistryEntity>();
  #ready: Promise<void>;

  constructor({ messenger, port, now = Date.now, logger = () => {}, seed = [], schemaVersion }: ControllerOptions) {
    this.#messenger = messenger;
    this.#port = port;
    this.#now = now;
    this.#logger = logger;
    this.#defaultSchemaVersion = schemaVersion ?? CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION;
    this.#ready = this.#initialize(seed);
  }

  getState(): ChainRegistryState {
    return cloneState(this.#chains.values());
  }

  getChain(chainRef: ChainRef): ChainRegistryEntity | null {
    const entry = this.#chains.get(chainRef);
    return entry ? cloneEntity(entry) : null;
  }

  getChains(): ChainRegistryEntity[] {
    return Array.from(this.#chains.values(), cloneEntity);
  }

  async upsertChain(metadata: ChainMetadata, options?: ChainRegistryUpsertOptions): Promise<UpsertResult> {
    await this.#ready;

    const entity: ChainRegistryEntity = {
      chainRef: metadata.chainRef,
      namespace: metadata.namespace,
      metadata,
      schemaVersion: options?.schemaVersion ?? this.#defaultSchemaVersion,
      updatedAt: options?.updatedAt ?? this.#now(),
    };

    const checked = ChainRegistryEntitySchema.parse(entity);

    const previous = this.#chains.get(checked.chainRef) ?? null;

    await this.#port.put(checked);

    this.#chains.set(checked.chainRef, checked);

    const result: UpsertResult =
      previous === null
        ? { kind: "added" as const, chain: cloneEntity(checked) }
        : { kind: "updated" as const, chain: cloneEntity(checked), previous: cloneEntity(previous) };

    this.#publishState();
    this.#publishUpdate(previous, checked);
    return result;
  }

  async removeChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: ChainRegistryEntity }> {
    await this.#ready;

    const previous = this.#chains.get(chainRef);
    if (!previous) {
      return { removed: false };
    }

    await this.#port.delete(chainRef);
    this.#chains.delete(chainRef);

    this.#publishState();
    this.#messenger.publish(UPDATE_TOPIC, { kind: "removed", chainRef, previous: cloneEntity(previous) });
    return { removed: true, previous: cloneEntity(previous) };
  }

  onStateChanged(handler: (state: ChainRegistryState) => void): () => void {
    return this.#messenger.subscribe(STATE_TOPIC, handler);
  }

  onChainUpdated(handler: (update: ChainRegistryUpdate) => void): () => void {
    return this.#messenger.subscribe(UPDATE_TOPIC, handler);
  }

  whenReady(): Promise<void> {
    return this.#ready;
  }

  async #initialize(seed: readonly ChainMetadata[]): Promise<void> {
    try {
      const persisted = await this.#port.getAll();
      const sanitized = await this.#sanitizePersisted(persisted);

      if (sanitized.length === 0 && seed.length > 0) {
        const seedEntities = seed.map((metadata) =>
          ChainRegistryEntitySchema.parse({
            chainRef: metadata.chainRef,
            namespace: metadata.namespace,
            metadata,
            schemaVersion: this.#defaultSchemaVersion,
            updatedAt: this.#now(),
          }),
        );

        await this.#port.putMany(seedEntities);
        for (const entity of seedEntities) {
          this.#chains.set(entity.chainRef, entity);
        }
        this.#publishState();
        return;
      }

      for (const entity of sanitized) {
        this.#chains.set(entity.chainRef, entity);
      }

      if (this.#chains.size > 0) {
        this.#publishState();
      }
    } catch (error) {
      this.#logger("[chainRegistry] failed to initialize registry", error);
      throw error;
    }
  }

  async #sanitizePersisted(entries: ChainRegistryEntity[]): Promise<ChainRegistryEntity[]> {
    const valid: ChainRegistryEntity[] = [];

    for (const entry of entries) {
      const parsed = ChainRegistryEntitySchema.safeParse(entry);
      if (!parsed.success) {
        this.#logger("[chainRegistry] dropping invalid entry", parsed.error);
        await this.#port.delete(entry.chainRef);
        continue;
      }
      valid.push(parsed.data);
    }

    return valid;
  }

  #publishState(): void {
    this.#messenger.publish(STATE_TOPIC, cloneState(this.#chains.values()), {
      compare: (previous, next) => {
        if (!previous || !next) return false;
        if (previous.chains.length !== next.chains.length) return false;

        for (let i = 0; i < previous.chains.length; i += 1) {
          const prevChain = previous.chains[i];
          const nextChain = next.chains[i];
          if (!prevChain || !nextChain) {
            return false;
          }
          if (!isSameEntity(prevChain, nextChain)) {
            return false;
          }
        }

        return true;
      },
    });
  }

  #publishUpdate(previous: ChainRegistryEntity | null, next: ChainRegistryEntity): void {
    const payload: ChainRegistryUpdate =
      previous === null
        ? { kind: "added", chain: cloneEntity(next) }
        : { kind: "updated", chain: cloneEntity(next), previous: cloneEntity(previous) };

    this.#messenger.publish(UPDATE_TOPIC, payload);
  }
}
