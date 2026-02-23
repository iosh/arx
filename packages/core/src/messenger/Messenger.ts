import type { PayloadOfTopic, Topic, Unsubscribe } from "./topic.js";

export type ViolationMode = "throw" | "warn" | "off";

export type PublishOptions<Payload> = {
  force?: boolean;
  /**
   * Overrides topic.remember (rare).
   */
  remember?: boolean;
  /**
   * Overrides topic.isEqual (rare).
   */
  isEqual?: (prev: Payload, next: Payload) => boolean;
};

export type SubscribeOptions = {
  /**
   * If "snapshot", immediately replay the last snapshot if present.
   */
  replay?: "none" | "snapshot";
  /**
   * Optional AbortSignal for automatic cleanup.
   */
  signal?: AbortSignal;
};

export type ListenerErrorHandler = (info: { topic: string; error: unknown }) => void;

export type ViolationHandler = (info: {
  kind: "not_allowed" | "payload_invalid";
  topic: string;
  scope?: string;
}) => void;

type AnyTopic = Topic<unknown, string>;
type AnyListener = (payload: unknown) => void;

export type ScopedMessenger<Pub extends readonly AnyTopic[], Sub extends readonly AnyTopic[] = Pub> = {
  publish<T extends Pub[number]>(
    topic: T,
    payload: PayloadOfTopic<T>,
    options?: PublishOptions<PayloadOfTopic<T>>,
  ): void;

  subscribe<T extends Sub[number]>(
    topic: T,
    handler: (payload: PayloadOfTopic<T>) => void,
    options?: SubscribeOptions,
  ): Unsubscribe;

  getSnapshot<T extends Sub[number]>(topic: T): PayloadOfTopic<T> | undefined;
};

export class Messenger {
  #listeners = new Map<string, Set<AnyListener>>();
  #snapshots = new Map<string, unknown>();

  #onListenerError: ListenerErrorHandler;
  #onViolation: ViolationHandler;
  #violationMode: ViolationMode;

  constructor(
    opts: {
      onListenerError?: ListenerErrorHandler;
      onViolation?: ViolationHandler;
      violationMode?: ViolationMode;
    } = {},
  ) {
    this.#onListenerError = opts.onListenerError ?? (() => {});
    this.#onViolation = opts.onViolation ?? (() => {});
    this.#violationMode = opts.violationMode ?? "throw";
  }

  publish<T>(topic: Topic<T>, payload: T, options: PublishOptions<T> = {}): void {
    if (topic.validate && !topic.validate(payload)) {
      this.#handleViolation({ kind: "payload_invalid", topic: topic.name });
      return;
    }

    const remember = options.remember ?? topic.remember;

    if (!options.force && remember) {
      const hasPrev = this.#snapshots.has(topic.name);
      if (hasPrev) {
        const prev = this.#snapshots.get(topic.name) as T;
        const isEqual = options.isEqual ?? topic.isEqual ?? Object.is;
        if (isEqual(prev, payload)) return;
      }
    }

    if (remember) {
      this.#snapshots.set(topic.name, payload);
    }

    const set = this.#listeners.get(topic.name);
    if (!set || set.size === 0) return;

    for (const handler of Array.from(set)) {
      try {
        handler(payload);
      } catch (error) {
        this.#onListenerError({ topic: topic.name, error });
      }
    }
  }

  subscribe<T>(topic: Topic<T>, handler: (payload: T) => void, options: SubscribeOptions = {}): Unsubscribe {
    const set = this.#listeners.get(topic.name) ?? new Set<AnyListener>();
    set.add(handler as unknown as AnyListener);
    this.#listeners.set(topic.name, set);

    if (options.replay === "snapshot" && this.#snapshots.has(topic.name)) {
      try {
        handler(this.#snapshots.get(topic.name) as T);
      } catch (error) {
        this.#onListenerError({ topic: topic.name, error });
      }
    }

    const unsubscribe = () => {
      const cur = this.#listeners.get(topic.name);
      if (!cur) return;
      cur.delete(handler as AnyListener);
      if (cur.size === 0) this.#listeners.delete(topic.name);
    };

    if (options.signal) {
      if (options.signal.aborted) {
        unsubscribe();
      } else {
        options.signal.addEventListener("abort", unsubscribe, { once: true });
      }
    }

    return unsubscribe;
  }

  getSnapshot<T>(topic: Topic<T>): T | undefined {
    return this.#snapshots.get(topic.name) as T | undefined;
  }

  clear(topic?: AnyTopic): void {
    if (!topic) {
      this.#listeners.clear();
      this.#snapshots.clear();
      return;
    }
    this.#listeners.delete(topic.name);
    this.#snapshots.delete(topic.name);
  }

  scope<const Pub extends readonly AnyTopic[], const Sub extends readonly AnyTopic[] = Pub>(config: {
    name?: string;
    publish: Pub;
    subscribe?: Sub;
    strict?: boolean;
  }): ScopedMessenger<Pub, Sub> {
    const self = this;
    const scopeName = config.name;
    const strict = config.strict ?? true;

    const pubAllowed = new Set(config.publish.map((t) => t.name));
    const subList = (config.subscribe ?? config.publish) as unknown as Sub;
    const subAllowed = new Set(subList.map((t) => t.name));

    const assertAllowed = (kind: "publish" | "subscribe", topic: AnyTopic): boolean => {
      if (!strict) return true;
      const ok = kind === "publish" ? pubAllowed.has(topic.name) : subAllowed.has(topic.name);
      if (ok) return true;
      this.#handleViolation({ kind: "not_allowed", topic: topic.name, ...(scopeName ? { scope: scopeName } : {}) });
      // Even when violationMode is "warn"/"off", a strict scope must still block execution.
      return false;
    };

    return {
      publish<T extends Pub[number]>(
        topic: T,
        payload: PayloadOfTopic<T>,
        options?: PublishOptions<PayloadOfTopic<T>>,
      ): void {
        if (!assertAllowed("publish", topic)) return;
        self.publish(
          topic as unknown as Topic<PayloadOfTopic<T>>,
          payload,
          options as PublishOptions<PayloadOfTopic<T>>,
        );
      },
      subscribe<T extends Sub[number]>(
        topic: T,
        handler: (payload: PayloadOfTopic<T>) => void,
        options?: SubscribeOptions,
      ): Unsubscribe {
        if (!assertAllowed("subscribe", topic)) {
          return () => {};
        }
        return self.subscribe(topic as unknown as Topic<PayloadOfTopic<T>>, handler, options);
      },
      getSnapshot<T extends Sub[number]>(topic: T): PayloadOfTopic<T> | undefined {
        if (!assertAllowed("subscribe", topic)) return undefined;
        return self.getSnapshot(topic as unknown as Topic<PayloadOfTopic<T>>) as PayloadOfTopic<T> | undefined;
      },
    } satisfies ScopedMessenger<Pub, Sub>;
  }

  #handleViolation(info: { kind: "not_allowed" | "payload_invalid"; topic: string; scope?: string }) {
    this.#onViolation(info);
    if (this.#violationMode === "off") return;

    const msg = info.scope
      ? `messenger violation(${info.kind}): ${info.topic} in scope(${info.scope})`
      : `messenger violation(${info.kind}): ${info.topic}`;

    if (this.#violationMode === "warn") {
      console.warn(msg);
      return;
    }

    throw new Error(msg);
  }
}
