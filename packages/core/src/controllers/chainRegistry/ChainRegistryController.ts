import type { ChainRef } from "../../chains/ids.js";
import type { ChainRegistryPort } from "../../chains/index.js";
import { type ChainMetadata, isSameChainMetadata } from "../../chains/metadata.js";
import {
  CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION,
  type ChainRegistryEntity,
  ChainRegistryEntitySchema,
} from "../../storage/index.js";
import {
  cloneChainRegistryEntity,
  cloneChainRegistryState,
  normalizeAndValidateMetadata,
  parseEntity,
} from "./state.js";
import { CHAIN_REGISTRY_STATE_CHANGED, CHAIN_REGISTRY_UPDATED, type ChainRegistryMessenger } from "./topics.js";
import type {
  ChainRegistryController,
  ChainRegistryState,
  ChainRegistryUpdate,
  ChainRegistryUpsertOptions,
  ChainRegistryUpsertResult,
} from "./types.js";

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
    return cloneChainRegistryState(this.#chains.values());
  }

  getChain(chainRef: ChainRef): ChainRegistryEntity | null {
    const entry = this.#chains.get(chainRef);
    return entry ? cloneChainRegistryEntity(entry) : null;
  }

  getChains(): ChainRegistryEntity[] {
    return cloneChainRegistryState(this.#chains.values()).chains;
  }

  async upsertChain(metadata: ChainMetadata, options?: ChainRegistryUpsertOptions): Promise<ChainRegistryUpsertResult> {
    await this.#ready;

    // Validate first so normalization cannot throw (e.g. bad payloads cast as ChainMetadata).
    const normalized = normalizeAndValidateMetadata(metadata);
    const previous = this.#chains.get(normalized.chainRef) ?? null;
    const schemaVersion = options?.schemaVersion ?? this.#defaultSchemaVersion;
    if (previous && previous.schemaVersion === schemaVersion && isSameChainMetadata(previous.metadata, normalized)) {
      return { kind: "noop", chain: cloneChainRegistryEntity(previous) };
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
        ? { kind: "added" as const, chain: cloneChainRegistryEntity(checked) }
        : {
            kind: "updated" as const,
            chain: cloneChainRegistryEntity(checked),
            previous: cloneChainRegistryEntity(previous),
          };

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
    this.#messenger.publish(CHAIN_REGISTRY_UPDATED, {
      kind: "removed",
      chainRef,
      previous: cloneChainRegistryEntity(previous),
    });
    return { removed: true, previous: cloneChainRegistryEntity(previous) };
  }

  onStateChanged(handler: (state: ChainRegistryState) => void): () => void {
    return this.#messenger.subscribe(CHAIN_REGISTRY_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  onChainUpdated(handler: (update: ChainRegistryUpdate) => void): () => void {
    return this.#messenger.subscribe(CHAIN_REGISTRY_UPDATED, handler);
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
          const normalized = normalizeAndValidateMetadata(metadata);
          return parseEntity({
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
    this.#messenger.publish(CHAIN_REGISTRY_STATE_CHANGED, cloneChainRegistryState(this.#chains.values()));
  }

  #publishUpdate(previous: ChainRegistryEntity | null, next: ChainRegistryEntity): void {
    const payload: ChainRegistryUpdate =
      previous === null
        ? { kind: "added", chain: cloneChainRegistryEntity(next) }
        : { kind: "updated", chain: cloneChainRegistryEntity(next), previous: cloneChainRegistryEntity(previous) };

    this.#messenger.publish(CHAIN_REGISTRY_UPDATED, payload);
  }
}
