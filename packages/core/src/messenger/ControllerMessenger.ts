type TopicPayloadMap = Record<string, unknown>;
type TopicName<T extends TopicPayloadMap> = Extract<keyof T, string>;
type Listener<Payload> = (payload: Payload) => void;

export type Unsubscribe = () => void;

export type CompareFn<Payload> = (previous?: Payload, next?: Payload) => boolean;

export type PublishOptions<Payload> = {
  force?: boolean;
  compare?: CompareFn<Payload>;
};

export class ControllerMessenger<TTopics extends TopicPayloadMap = TopicPayloadMap> {
  #listeners = new Map<TopicName<TTopics>, Set<Listener<TTopics[keyof TTopics]>>>();

  #snapshots = new Map<TopicName<TTopics>, TTopics[keyof TTopics]>();
  #defaultCompare: (previous: unknown, next: unknown) => boolean;

  constructor({ compare }: { compare?: CompareFn<unknown> }) {
    this.#defaultCompare = compare ?? Object.is;
  }

  publish<Name extends TopicName<TTopics>>(
    topic: Name,
    payload: TTopics[Name],
    options?: PublishOptions<TTopics[Name]>,
  ): void {
    const previous = this.#snapshots.get(topic) as TTopics[Name] | undefined;
    if (!options?.force) {
      const comparator = options?.compare ?? ((prev, next) => prev !== undefined && this.#defaultCompare(prev, next));
      if (comparator(previous, payload)) return;
    }

    this.#snapshots.set(topic, payload as TTopics[keyof TTopics]);

    const handlers = this.#listeners.get(topic);

    if (!handlers) return;

    for (const handler of handlers) {
      (handler as Listener<TTopics[Name]>)(payload);
    }
  }

  subscribe<Name extends TopicName<TTopics>>(topic: Name, handler: Listener<TTopics[Name]>): Unsubscribe {
    const existing = this.#listeners.get(topic) ?? new Set();

    existing.add(handler as Listener<TTopics[keyof TTopics]>);
    this.#listeners.set(topic, existing);

    return () => {
      const listeners = this.#listeners.get(topic);
      if (!listeners) return;
      listeners.delete(handler as Listener<TTopics[keyof TTopics]>);
      if (listeners.size === 0) {
        this.#listeners.delete(topic);
      }
    };
  }

  getSnapshot<Name extends TopicName<TTopics>>(topic: Name): TTopics[Name] | undefined {
    return this.#snapshots.get(topic) as TTopics[Name] | undefined;
  }

  clear(topic?: TopicName<TTopics>): void {
    if (topic) {
      this.#listeners.delete(topic);
      this.#snapshots.delete(topic);
      return;
    }
    this.#listeners.clear();
    this.#snapshots.clear();
  }
}
