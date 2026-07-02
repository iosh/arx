import type { Topic, Unsubscribe } from "./topic.js";

type Listener<Payload> = (payload: Payload) => void;
type AnyListener = Listener<unknown>;

export type Messenger = {
  publish<Payload>(topic: Topic<Payload>, payload: Payload): void;
  subscribe<Payload>(topic: Topic<Payload>, handler: Listener<Payload>): Unsubscribe;
  clear(): void;
};

export const createMessenger = (): Messenger => {
  const listeners = new Map<string, Set<AnyListener>>();

  return {
    publish(topic, payload) {
      const topicListeners = listeners.get(topic.name);
      if (!topicListeners) {
        return;
      }

      for (const listener of Array.from(topicListeners)) {
        listener(payload);
      }
    },
    subscribe(topic, handler) {
      const topicListeners = listeners.get(topic.name) ?? new Set<AnyListener>();
      topicListeners.add(handler as AnyListener);
      listeners.set(topic.name, topicListeners);

      return () => {
        const currentListeners = listeners.get(topic.name);
        if (!currentListeners) {
          return;
        }

        currentListeners.delete(handler as AnyListener);
        if (currentListeners.size === 0) {
          listeners.delete(topic.name);
        }
      };
    },
    clear() {
      listeners.clear();
    },
  };
};
