import { ArxReasons, arxError } from "@arx/errors";
import type { ChainRef } from "../../chains/ids.js";
import { type ChainMetadata, isSameAddChainComparableMetadata } from "../../chains/metadata.js";
import type { CustomChainsPort } from "../../services/store/customChains/port.js";
import { type CustomChainRecord, CustomChainRecordSchema } from "../../storage/records.js";
import { prepareChainMetadataForStorage } from "../chainDefinitions/state.js";
import { cloneSupportedChainEntity, cloneSupportedChainsState, toSupportedChainEntity } from "./state.js";
import { SUPPORTED_CHAINS_STATE_CHANGED, SUPPORTED_CHAINS_UPDATED, type SupportedChainsMessenger } from "./topics.js";
import type {
  AddSupportedChainOptions,
  AddSupportedChainResult,
  SupportedChainEntity,
  SupportedChainsController,
  SupportedChainsState,
  SupportedChainsUpdate,
} from "./types.js";

type ControllerOptions = {
  messenger: SupportedChainsMessenger;
  port: CustomChainsPort;
  seed?: readonly ChainMetadata[];
  logger?: (message: string, error?: unknown) => void;
  now?: () => number;
};

export class InMemorySupportedChainsController implements SupportedChainsController {
  #messenger: SupportedChainsMessenger;
  #port: CustomChainsPort;
  #logger: (message: string, error?: unknown) => void;
  #now: () => number;
  #chains = new Map<ChainRef, SupportedChainEntity>();
  #ready: Promise<void>;

  constructor({ messenger, port, seed = [], logger = () => {}, now = Date.now }: ControllerOptions) {
    this.#messenger = messenger;
    this.#port = port;
    this.#logger = logger;
    this.#now = now;
    this.#ready = this.#initialize(seed);
  }

  getState(): SupportedChainsState {
    return cloneSupportedChainsState(this.#chains.values());
  }

  getChain(chainRef: ChainRef): SupportedChainEntity | null {
    const entry = this.#chains.get(chainRef);
    return entry ? cloneSupportedChainEntity(entry) : null;
  }

  listChains(): SupportedChainEntity[] {
    return cloneSupportedChainsState(this.#chains.values()).chains;
  }

  async addChain(chain: ChainMetadata, options?: AddSupportedChainOptions): Promise<AddSupportedChainResult> {
    await this.#ready;

    const storedMetadata = prepareChainMetadataForStorage(chain);
    const previous = this.#chains.get(storedMetadata.chainRef) ?? null;

    if (previous?.source === "builtin") {
      if (isSameAddChainComparableMetadata(previous.metadata, storedMetadata)) {
        return { kind: "noop", chain: cloneSupportedChainEntity(previous) };
      }

      throw arxError({
        reason: ArxReasons.ChainNotSupported,
        message: "Requested chain conflicts with a builtin chain definition",
        data: { chainRef: storedMetadata.chainRef },
      });
    }

    const createdByOrigin = previous?.createdByOrigin ?? options?.createdByOrigin;
    const next = toSupportedChainEntity({
      metadata: storedMetadata,
      source: "custom",
      ...(createdByOrigin ? { createdByOrigin } : {}),
    });

    if (
      previous &&
      previous.source === "custom" &&
      previous.createdByOrigin === next.createdByOrigin &&
      isSameAddChainComparableMetadata(previous.metadata, next.metadata)
    ) {
      return { kind: "noop", chain: cloneSupportedChainEntity(previous) };
    }

    await this.#port.upsert(this.#toCustomChainRecord(next));
    this.#chains.set(next.chainRef, next);

    this.#publishState();
    const update: SupportedChainsUpdate =
      previous && previous.source === "custom"
        ? {
            kind: "updated",
            chain: cloneSupportedChainEntity(next),
            previous: cloneSupportedChainEntity(previous),
          }
        : { kind: "added", chain: cloneSupportedChainEntity(next) };
    this.#messenger.publish(SUPPORTED_CHAINS_UPDATED, update);

    if (update.kind === "updated") {
      return update;
    }
    return update;
  }

  async removeChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: SupportedChainEntity }> {
    await this.#ready;

    const previous = this.#chains.get(chainRef);
    if (!previous) {
      return { removed: false };
    }
    if (previous.source !== "custom") {
      return { removed: false, previous: cloneSupportedChainEntity(previous) };
    }

    await this.#port.remove(chainRef);
    this.#chains.delete(chainRef);
    this.#publishState();
    this.#messenger.publish(SUPPORTED_CHAINS_UPDATED, {
      kind: "removed",
      chainRef,
      previous: cloneSupportedChainEntity(previous),
    });

    return { removed: true, previous: cloneSupportedChainEntity(previous) };
  }

  onStateChanged(handler: (state: SupportedChainsState) => void): () => void {
    return this.#messenger.subscribe(SUPPORTED_CHAINS_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  onChainUpdated(handler: (update: SupportedChainsUpdate) => void): () => void {
    return this.#messenger.subscribe(SUPPORTED_CHAINS_UPDATED, handler);
  }

  whenReady(): Promise<void> {
    return this.#ready;
  }

  async #initialize(seed: readonly ChainMetadata[]): Promise<void> {
    try {
      for (const metadata of seed) {
        const storedMetadata = prepareChainMetadataForStorage(metadata);
        if (this.#chains.has(storedMetadata.chainRef)) {
          throw new Error(`Duplicate builtin supported chain "${storedMetadata.chainRef}"`);
        }
        this.#chains.set(
          storedMetadata.chainRef,
          toSupportedChainEntity({
            metadata: storedMetadata,
            source: "builtin",
          }),
        );
      }

      const persisted = await this.#port.list();
      for (const entry of persisted) {
        const record = this.#parseCustomChainRecord(entry);
        if (!record) {
          continue;
        }

        const existing = this.#chains.get(record.chainRef) ?? null;
        if (existing?.source === "builtin") {
          await this.#port.remove(record.chainRef);
          continue;
        }

        this.#chains.set(
          record.chainRef,
          toSupportedChainEntity({
            metadata: record.metadata,
            source: "custom",
            ...(record.createdByOrigin ? { createdByOrigin: record.createdByOrigin } : {}),
          }),
        );
      }

      if (this.#chains.size > 0) {
        this.#publishState();
      }
    } catch (error) {
      this.#logger("[supportedChains] failed to initialize", error);
      throw error;
    }
  }

  #parseCustomChainRecord(record: CustomChainRecord): CustomChainRecord | null {
    const parsed = CustomChainRecordSchema.safeParse(record);
    if (!parsed.success) {
      this.#logger("[supportedChains] dropping invalid custom chain", parsed.error);
      return null;
    }

    return CustomChainRecordSchema.parse({
      chainRef: parsed.data.chainRef,
      namespace: parsed.data.namespace,
      metadata: prepareChainMetadataForStorage(parsed.data.metadata),
      ...(parsed.data.createdByOrigin ? { createdByOrigin: parsed.data.createdByOrigin } : {}),
      updatedAt: parsed.data.updatedAt,
    });
  }

  #toCustomChainRecord(chain: SupportedChainEntity): CustomChainRecord {
    return CustomChainRecordSchema.parse({
      chainRef: chain.chainRef,
      namespace: chain.namespace,
      metadata: chain.metadata,
      ...(chain.createdByOrigin ? { createdByOrigin: chain.createdByOrigin } : {}),
      updatedAt: this.#now(),
    });
  }

  #publishState() {
    this.#messenger.publish(SUPPORTED_CHAINS_STATE_CHANGED, cloneSupportedChainsState(this.#chains.values()));
  }
}
