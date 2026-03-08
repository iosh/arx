import { ArxReasons, arxError } from "@arx/errors";
import type { ChainRef } from "../../chains/ids.js";
import { type ChainMetadata, isSameAddChainComparableMetadata, isSameChainMetadata } from "../../chains/metadata.js";
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
  ChainDefinitionsUpsertCustomOptions,
  ChainDefinitionsUpsertCustomResult,
} from "./types.js";

type ControllerOptions = {
  messenger: ChainDefinitionsMessenger;
  port: ChainDefinitionsPort;
  now?: () => number;
  logger?: (message: string, error?: unknown) => void;
  seed?: readonly ChainMetadata[];
  schemaVersion?: number;
};

type ReconcileOptions = {
  publish: boolean;
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

  async reconcileBuiltinChains(seed: readonly ChainMetadata[]): Promise<void> {
    await this.#ready;
    await this.#reconcileBuiltinChains(seed, { publish: true });
  }

  async upsertCustomChain(
    metadata: ChainMetadata,
    options?: ChainDefinitionsUpsertCustomOptions,
  ): Promise<ChainDefinitionsUpsertCustomResult> {
    await this.#ready;
    return await this.#upsertCustomChain(metadata, options);
  }

  async removeCustomChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: ChainDefinitionEntity }> {
    await this.#ready;

    const previous = this.#chains.get(chainRef);
    if (!previous) {
      return { removed: false };
    }
    if (previous.source !== "custom") {
      return { removed: false, previous: cloneChainDefinitionEntity(previous) };
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

      for (const entity of sanitized) {
        this.#chains.set(entity.chainRef, entity);
      }

      if (seed.length > 0) {
        await this.#reconcileBuiltinChains(seed, { publish: false });
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

  async #reconcileBuiltinChains(seed: readonly ChainMetadata[], options: ReconcileOptions): Promise<void> {
    const nextBuiltinRefs = new Set<ChainRef>();
    const nextEntries = new Map<ChainRef, ChainDefinitionEntity>();
    const changedEntries: Array<{ previous: ChainDefinitionEntity | null; next: ChainDefinitionEntity }> = [];

    for (const metadata of seed) {
      const normalized = normalizeAndValidateMetadata(metadata);
      if (nextBuiltinRefs.has(normalized.chainRef)) {
        throw new Error(`Duplicate builtin chain definition for ${normalized.chainRef}`);
      }

      nextBuiltinRefs.add(normalized.chainRef);
      const previous = this.#chains.get(normalized.chainRef) ?? null;
      if (
        previous &&
        previous.source === "builtin" &&
        previous.schemaVersion === this.#defaultSchemaVersion &&
        isSameChainMetadata(previous.metadata, normalized)
      ) {
        continue;
      }

      const next = parseEntity({
        chainRef: normalized.chainRef,
        namespace: normalized.namespace,
        metadata: normalized,
        schemaVersion: this.#defaultSchemaVersion,
        updatedAt: this.#now(),
        source: "builtin",
      });
      nextEntries.set(next.chainRef, next);
      changedEntries.push({ previous, next });
    }

    const removedBuiltins = Array.from(this.#chains.values()).filter(
      (entry) => entry.source === "builtin" && !nextBuiltinRefs.has(entry.chainRef),
    );

    if (nextEntries.size === 0 && removedBuiltins.length === 0) {
      return;
    }

    if (nextEntries.size > 0) {
      await this.#port.putMany([...nextEntries.values()]);
      for (const [chainRef, entity] of nextEntries) {
        this.#chains.set(chainRef, entity);
      }
    }

    for (const entry of removedBuiltins) {
      await this.#port.delete(entry.chainRef);
      this.#chains.delete(entry.chainRef);
    }

    if (!options.publish) {
      return;
    }

    this.#publishState();
    for (const { previous, next } of changedEntries) {
      this.#publishUpdate(previous, next);
    }
    for (const removed of removedBuiltins) {
      this.#messenger.publish(CHAIN_DEFINITIONS_UPDATED, {
        kind: "removed",
        chainRef: removed.chainRef,
        previous: cloneChainDefinitionEntity(removed),
      });
    }
  }

  async #upsertCustomChain(
    metadata: ChainMetadata,
    options?: ChainDefinitionsUpsertCustomOptions,
  ): Promise<ChainDefinitionsUpsertCustomResult> {
    const normalized = normalizeAndValidateMetadata(metadata);
    const previous = this.#chains.get(normalized.chainRef) ?? null;

    if (previous?.source === "builtin") {
      if (isSameAddChainComparableMetadata(previous.metadata, normalized)) {
        return { kind: "noop", chain: cloneChainDefinitionEntity(previous) };
      }

      throw arxError({
        reason: ArxReasons.ChainNotSupported,
        message: "Requested chain conflicts with a builtin chain definition",
        data: { chainRef: normalized.chainRef },
      });
    }

    const schemaVersion = options?.schemaVersion ?? this.#defaultSchemaVersion;
    const createdByOrigin = previous?.createdByOrigin ?? options?.createdByOrigin;
    if (
      previous &&
      previous.schemaVersion === schemaVersion &&
      previous.source === "custom" &&
      previous.createdByOrigin === createdByOrigin &&
      isSameChainMetadata(previous.metadata, normalized)
    ) {
      return { kind: "noop", chain: cloneChainDefinitionEntity(previous) };
    }

    const entity = parseEntity({
      chainRef: normalized.chainRef,
      namespace: normalized.namespace,
      metadata: normalized,
      schemaVersion,
      updatedAt: options?.updatedAt ?? this.#now(),
      source: "custom",
      ...(createdByOrigin ? { createdByOrigin } : {}),
    });

    await this.#port.put(entity);
    this.#chains.set(entity.chainRef, entity);

    const result: ChainDefinitionsUpsertCustomResult =
      previous === null
        ? { kind: "added", chain: cloneChainDefinitionEntity(entity) }
        : {
            kind: "updated",
            chain: cloneChainDefinitionEntity(entity),
            previous: cloneChainDefinitionEntity(previous),
          };

    this.#publishState();
    this.#publishUpdate(previous, entity);
    return result;
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
