import type { ChainRef } from "../../chains/ids.js";
import { type ChainMetadata, isSameChainMetadata } from "../../chains/metadata.js";
import type { ChainDefinitionsPort } from "../../services/store/chainDefinitions/port.js";
import {
  CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION,
  type ChainDefinitionEntity,
  ChainDefinitionEntitySchema,
} from "../../storage/index.js";
import {
  cloneChainDefinitionEntity,
  cloneChainDefinitionsState,
  normalizeAndValidateMetadata,
  parseEntity,
} from "./state.js";
import {
  CHAIN_DEFINITIONS_STATE_CHANGED,
  CHAIN_DEFINITIONS_UPDATED,
  type ChainDefinitionsMessenger,
} from "./topics.js";
import type {
  ChainDefinitionsController,
  ChainDefinitionsState,
  ChainDefinitionsUpdate,
  ChainDefinitionsUpsertOptions,
  ChainDefinitionsUpsertResult,
} from "./types.js";

type ControllerOptions = {
  messenger: ChainDefinitionsMessenger;
  port: ChainDefinitionsPort;
  now?: () => number;
  logger?: (message: string, error?: unknown) => void;
  seed?: readonly ChainMetadata[];
  schemaVersion?: number;
};

export class InMemoryChainDefinitionsController implements ChainDefinitionsController {
  #messenger: ChainDefinitionsMessenger;
  #port: ChainDefinitionsPort;
  #now: () => number;
  #logger: (message: string, error?: unknown) => void;
  #defaultSchemaVersion: number;
  #chains = new Map<ChainRef, ChainDefinitionEntity>();
  #ready: Promise<void>;

  constructor({ messenger, port, now = Date.now, logger = () => {}, seed = [], schemaVersion }: ControllerOptions) {
    this.#messenger = messenger;
    this.#port = port;
    this.#now = now;
    this.#logger = logger;
    this.#defaultSchemaVersion = schemaVersion ?? CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION;
    this.#ready = this.#initialize(seed);
  }

  getState(): ChainDefinitionsState {
    return cloneChainDefinitionsState(this.#chains.values());
  }

  getChain(chainRef: ChainRef): ChainDefinitionEntity | null {
    const entry = this.#chains.get(chainRef);
    return entry ? cloneChainDefinitionEntity(entry) : null;
  }

  getChains(): ChainDefinitionEntity[] {
    return cloneChainDefinitionsState(this.#chains.values()).chains;
  }

  async upsertChain(
    metadata: ChainMetadata,
    options?: ChainDefinitionsUpsertOptions,
  ): Promise<ChainDefinitionsUpsertResult> {
    await this.#ready;

    // Validate first so normalization cannot throw (e.g. bad payloads cast as ChainMetadata).
    const normalized = normalizeAndValidateMetadata(metadata);
    const previous = this.#chains.get(normalized.chainRef) ?? null;
    const schemaVersion = options?.schemaVersion ?? this.#defaultSchemaVersion;
    if (previous && previous.schemaVersion === schemaVersion && isSameChainMetadata(previous.metadata, normalized)) {
      return { kind: "noop", chain: cloneChainDefinitionEntity(previous) };
    }

    const entity: ChainDefinitionEntity = {
      chainRef: normalized.chainRef,
      namespace: normalized.namespace,
      metadata: normalized,
      schemaVersion,
      updatedAt: options?.updatedAt ?? this.#now(),
    };

    const checked = ChainDefinitionEntitySchema.parse(entity);

    await this.#port.put(checked);

    this.#chains.set(checked.chainRef, checked);

    const result: ChainDefinitionsUpsertResult =
      previous === null
        ? { kind: "added" as const, chain: cloneChainDefinitionEntity(checked) }
        : {
            kind: "updated" as const,
            chain: cloneChainDefinitionEntity(checked),
            previous: cloneChainDefinitionEntity(previous),
          };

    this.#publishState();
    this.#publishUpdate(previous, checked);
    return result;
  }

  async removeChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: ChainDefinitionEntity }> {
    await this.#ready;

    const previous = this.#chains.get(chainRef);
    if (!previous) {
      return { removed: false };
    }

    await this.#port.delete(chainRef);
    this.#chains.delete(chainRef);

    this.#publishState();
    this.#messenger.publish(CHAIN_DEFINITIONS_UPDATED, {
      kind: "removed",
      chainRef,
      previous: cloneChainDefinitionEntity(previous),
    });
    return { removed: true, previous: cloneChainDefinitionEntity(previous) };
  }

  onStateChanged(handler: (state: ChainDefinitionsState) => void): () => void {
    return this.#messenger.subscribe(CHAIN_DEFINITIONS_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  onChainUpdated(handler: (update: ChainDefinitionsUpdate) => void): () => void {
    return this.#messenger.subscribe(CHAIN_DEFINITIONS_UPDATED, handler);
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
      this.#logger("[chainDefinitions] failed to initialize registry", error);
      throw error;
    }
  }

  async #sanitizePersisted(entries: ChainDefinitionEntity[]): Promise<ChainDefinitionEntity[]> {
    const valid: ChainDefinitionEntity[] = [];

    for (const entry of entries) {
      const parsed = ChainDefinitionEntitySchema.safeParse(entry);
      if (!parsed.success) {
        this.#logger("[chainDefinitions] dropping invalid entry", parsed.error);
        await this.#port.delete(entry.chainRef);
        continue;
      }
      valid.push(parsed.data);
    }

    return valid;
  }

  #publishState(): void {
    this.#messenger.publish(CHAIN_DEFINITIONS_STATE_CHANGED, cloneChainDefinitionsState(this.#chains.values()));
  }

  #publishUpdate(previous: ChainDefinitionEntity | null, next: ChainDefinitionEntity): void {
    const payload: ChainDefinitionsUpdate =
      previous === null
        ? { kind: "added", chain: cloneChainDefinitionEntity(next) }
        : { kind: "updated", chain: cloneChainDefinitionEntity(next), previous: cloneChainDefinitionEntity(previous) };

    this.#messenger.publish(CHAIN_DEFINITIONS_UPDATED, payload);
  }
}
