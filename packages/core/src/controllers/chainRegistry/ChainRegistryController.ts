import type { ChainRef } from "../../chains/ids.js";
import type { ChainRegistryPort } from "../../chains/index.js";
import {
  type ChainMetadata,
  cloneChainMetadata,
  isSameChainMetadata,
  normalizeChainMetadata,
  validateChainMetadata,
} from "../../chains/metadata.js";
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
  ChainRegistryUpsertResult,
} from "./types.js";

const STATE_TOPIC = "chainRegistry:stateChanged";
const UPDATE_TOPIC = "chainRegistry:updated";

const isSameEntity = (previous: ChainRegistryEntity, next: ChainRegistryEntity) => {
  if (
    previous.chainRef !== next.chainRef ||
    previous.namespace !== next.namespace ||
    previous.schemaVersion !== next.schemaVersion ||
    previous.updatedAt !== next.updatedAt
  ) {
    return false;
  }

  return isSameChainMetadata(previous.metadata, next.metadata);
};

const cloneEntity = (entity: ChainRegistryEntity): ChainRegistryEntity => ({
  chainRef: entity.chainRef,
  namespace: entity.namespace,
  metadata: cloneChainMetadata(entity.metadata),
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
    return cloneState(this.#chains.values()).chains;
  }

  async upsertChain(metadata: ChainMetadata, options?: ChainRegistryUpsertOptions): Promise<ChainRegistryUpsertResult> {
    await this.#ready;

    // Validate first so normalization cannot throw (e.g. bad payloads cast as ChainMetadata).
    const validated = validateChainMetadata(metadata);
    const normalized = normalizeChainMetadata(validated);
    const previous = this.#chains.get(normalized.chainRef) ?? null;
    const schemaVersion = options?.schemaVersion ?? this.#defaultSchemaVersion;
    if (previous && previous.schemaVersion === schemaVersion && isSameChainMetadata(previous.metadata, normalized)) {
      return { kind: "noop", chain: cloneEntity(previous) };
    }

    const entity: ChainRegistryEntity = {
      chainRef: normalized.chainRef,
      namespace: normalized.namespace,
      metadata: normalized,
      schemaVersion,
      updatedAt: options?.updatedAt ?? this.#now(),
    };

    const checked = ChainRegistryEntitySchema.parse(entity);

    await this.#port.put(checked);

    this.#chains.set(checked.chainRef, checked);

    const result: ChainRegistryUpsertResult =
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
        const seedEntities = seed.map((metadata) => {
          const validated = validateChainMetadata(metadata);
          const normalized = normalizeChainMetadata(validated);
          return ChainRegistryEntitySchema.parse({
            chainRef: normalized.chainRef,
            namespace: normalized.namespace,
            metadata: normalized,
            schemaVersion: this.#defaultSchemaVersion,
            updatedAt: this.#now(),
          });
        });

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
