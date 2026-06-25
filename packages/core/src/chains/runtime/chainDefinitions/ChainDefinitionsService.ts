import type { ChainDefinitionsPort } from "../../../services/store/chainDefinitions/port.js";
import { CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION, type ChainDefinitionEntity } from "../../../storage/index.js";
import { getChainRefNamespace } from "../../caip.js";
import { ChainDefinitionConflictError } from "../../errors.js";
import type { ChainRef } from "../../ids.js";
import { type ChainDefinition, isSameChainDefinition } from "../../metadata.js";
import {
  cloneChainDefinitionEntity,
  cloneChainDefinitionsState,
  parseEntity,
  prepareChainDefinitionForStorage,
} from "./state.js";
import {
  CHAIN_DEFINITIONS_STATE_CHANGED,
  CHAIN_DEFINITIONS_UPDATED,
  type ChainDefinitionsMessenger,
} from "./topics.js";
import type {
  ChainDefinitionsService,
  ChainDefinitionsState,
  ChainDefinitionsUpdate,
  ChainDefinitionsUpsertCustomOptions,
  ChainDefinitionsUpsertCustomResult,
} from "./types.js";

type SupportedChainsServiceOptions = {
  messenger: ChainDefinitionsMessenger;
  port: ChainDefinitionsPort;
  now?: () => number;
  logger?: (message: string, error?: unknown) => void;
  seed?: readonly ChainDefinition[];
  schemaVersion?: number;
};

type ReconcileOptions = {
  publish: boolean;
};

export class InMemoryChainDefinitionsService implements ChainDefinitionsService {
  #messenger: ChainDefinitionsMessenger;
  #port: ChainDefinitionsPort;
  #now: () => number;
  #logger: (message: string, error?: unknown) => void;
  #defaultSchemaVersion: number;
  #chains = new Map<ChainRef, ChainDefinitionEntity>();
  #ready: Promise<void>;

  constructor({
    messenger,
    port,
    now = Date.now,
    logger = () => {},
    seed = [],
    schemaVersion,
  }: SupportedChainsServiceOptions) {
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

  async reconcileBuiltinChains(seed: readonly ChainDefinition[]): Promise<void> {
    await this.#ready;
    await this.#reconcileBuiltinChains(seed, { publish: true });
  }

  async upsertCustomChain(
    definition: ChainDefinition,
    options?: ChainDefinitionsUpsertCustomOptions,
  ): Promise<ChainDefinitionsUpsertCustomResult> {
    await this.#ready;
    return await this.#upsertCustomChain(definition, options);
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
    return this.#messenger.subscribe(CHAIN_DEFINITIONS_STATE_CHANGED, handler);
  }

  onChainUpdated(handler: (update: ChainDefinitionsUpdate) => void): () => void {
    return this.#messenger.subscribe(CHAIN_DEFINITIONS_UPDATED, handler);
  }

  whenReady(): Promise<void> {
    return this.#ready;
  }

  async #initialize(seed: readonly ChainDefinition[]): Promise<void> {
    try {
      const persisted = await this.#port.getAll();

      for (const entity of persisted) {
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

  async #reconcileBuiltinChains(seed: readonly ChainDefinition[], options: ReconcileOptions): Promise<void> {
    const nextBuiltinRefs = new Set<ChainRef>();
    const nextEntries = new Map<ChainRef, ChainDefinitionEntity>();
    const changedEntries: Array<{ previous: ChainDefinitionEntity | null; next: ChainDefinitionEntity }> = [];

    for (const definition of seed) {
      const storedDefinition = prepareChainDefinitionForStorage(definition);
      if (nextBuiltinRefs.has(storedDefinition.chainRef)) {
        throw new Error(`Duplicate builtin chain definition for ${storedDefinition.chainRef}`);
      }

      nextBuiltinRefs.add(storedDefinition.chainRef);
      const previous = this.#chains.get(storedDefinition.chainRef) ?? null;
      if (
        previous &&
        previous.source === "builtin" &&
        previous.schemaVersion === this.#defaultSchemaVersion &&
        isSameChainDefinition(previous.definition, storedDefinition)
      ) {
        continue;
      }

      const next = parseEntity({
        chainRef: storedDefinition.chainRef,
        namespace: getChainRefNamespace(storedDefinition.chainRef),
        definition: storedDefinition,
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
    definition: ChainDefinition,
    options?: ChainDefinitionsUpsertCustomOptions,
  ): Promise<ChainDefinitionsUpsertCustomResult> {
    const storedDefinition = prepareChainDefinitionForStorage(definition);
    const previous = this.#chains.get(storedDefinition.chainRef) ?? null;

    if (previous?.source === "builtin") {
      if (isSameChainDefinition(previous.definition, storedDefinition)) {
        return { kind: "noop", chain: cloneChainDefinitionEntity(previous) };
      }

      throw new ChainDefinitionConflictError({ chainRef: storedDefinition.chainRef });
    }

    const schemaVersion = options?.schemaVersion ?? this.#defaultSchemaVersion;
    const createdByOrigin = previous?.createdByOrigin ?? options?.createdByOrigin;
    if (
      previous &&
      previous.schemaVersion === schemaVersion &&
      previous.source === "custom" &&
      previous.createdByOrigin === createdByOrigin &&
      isSameChainDefinition(previous.definition, storedDefinition)
    ) {
      return { kind: "noop", chain: cloneChainDefinitionEntity(previous) };
    }

    const entity = parseEntity({
      chainRef: storedDefinition.chainRef,
      namespace: getChainRefNamespace(storedDefinition.chainRef),
      definition: storedDefinition,
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
