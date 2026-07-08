import { OWNER_CHANGED } from "../../events/ownerChanged.js";
import type { Messenger } from "../../messenger/index.js";
import { ATTENTION_REQUESTED, ATTENTION_STATE_CHANGED } from "./topics.js";
import type {
  AttentionRequest,
  AttentionRequestResult,
  AttentionService,
  AttentionState,
  RequestAttentionParams,
} from "./types.js";

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_QUEUE_SIZE = 20;

type Entry = { key: string; request: AttentionRequest };

export class InMemoryAttentionService implements AttentionService {
  #messenger: Messenger;
  #defaultTtlMs: number;
  #maxQueueSize: number;
  #queue: Entry[] = [];
  #byKey = new Map<string, AttentionRequest>();

  constructor(opts: {
    messenger: Messenger;
    defaultTtlMs?: number;
    maxQueueSize?: number;
  }) {
    this.#messenger = opts.messenger;
    this.#defaultTtlMs = opts.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.#maxQueueSize = opts.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  }

  requestAttention(params: RequestAttentionParams): AttentionRequestResult {
    const now = Date.now();
    this.#pruneExpired(now);

    const key = JSON.stringify([
      params.reason,
      params.origin,
      params.method,
      params.chainRef ?? null,
      params.namespace ?? null,
    ]);
    const existing = this.#byKey.get(key);

    if (existing && existing.expiresAt > now) {
      this.#messenger.publish(ATTENTION_REQUESTED, existing);
      return { enqueued: false, request: null, state: this.getSnapshot() };
    }

    const ttlMs = params.ttlMs ?? this.#defaultTtlMs;
    const request: AttentionRequest = {
      reason: params.reason,
      origin: params.origin,
      method: params.method,
      chainRef: params.chainRef ?? null,
      namespace: params.namespace ?? null,
      requestedAt: now,
      expiresAt: now + ttlMs,
    };

    this.#queue.push({ key, request });
    this.#byKey.set(key, request);

    while (this.#queue.length > this.#maxQueueSize) {
      const dropped = this.#queue.shift();
      if (dropped) this.#byKey.delete(dropped.key);
    }

    this.#messenger.publish(ATTENTION_REQUESTED, request);
    const state = this.getSnapshot();
    this.#publishStateChanged(state);

    return { enqueued: true, request, state };
  }

  #pruneExpired(now: number): boolean {
    const before = this.#queue.length;
    if (before === 0) return false;

    this.#queue = this.#queue.filter((e) => e.request.expiresAt > now);
    if (this.#queue.length === before) return false;

    this.#byKey.clear();
    for (const e of this.#queue) this.#byKey.set(e.key, e.request);
    return true;
  }

  getSnapshot(): AttentionState {
    const queue = this.#queue.map((e) => ({ ...e.request }));
    return { queue, count: queue.length };
  }

  clear(): AttentionState {
    if (this.#queue.length === 0) return this.getSnapshot();
    this.#queue = [];
    this.#byKey.clear();
    const state = this.getSnapshot();
    this.#publishStateChanged(state);
    return state;
  }

  clearExpired(): AttentionState {
    const now = Date.now();
    const changed = this.#pruneExpired(now);
    if (!changed) return this.getSnapshot();

    const state = this.getSnapshot();
    this.#publishStateChanged(state);
    return state;
  }

  onStateChanged(handler: (state: AttentionState) => void): () => void {
    return this.#messenger.subscribe(ATTENTION_STATE_CHANGED, handler);
  }

  #publishStateChanged(state: AttentionState): void {
    this.#messenger.publish(ATTENTION_STATE_CHANGED, state);
    this.#messenger.publish(OWNER_CHANGED, { topic: "attention", change: "state" });
  }
}
