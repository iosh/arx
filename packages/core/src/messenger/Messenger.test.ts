import { describe, expect, it, vi } from "vitest";
import { createMessenger } from "./Messenger.js";
import { eventTopic } from "./topic.js";

describe("createMessenger", () => {
  const TOPIC = eventTopic<{ value: number }>("test:event");

  it("publishes payloads to subscribed listeners", () => {
    const messenger = createMessenger();
    const first = vi.fn();
    const second = vi.fn();

    messenger.subscribe(TOPIC, first);
    messenger.subscribe(TOPIC, second);
    messenger.publish(TOPIC, { value: 1 });

    expect(first).toHaveBeenCalledWith({ value: 1 });
    expect(second).toHaveBeenCalledWith({ value: 1 });
  });

  it("removes listeners through unsubscribe", () => {
    const messenger = createMessenger();
    const listener = vi.fn();

    const unsubscribe = messenger.subscribe(TOPIC, listener);
    unsubscribe();
    messenger.publish(TOPIC, { value: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("clears all listeners", () => {
    const messenger = createMessenger();
    const listener = vi.fn();

    messenger.subscribe(TOPIC, listener);
    messenger.clear();
    messenger.publish(TOPIC, { value: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("lets listener errors propagate", () => {
    const messenger = createMessenger();
    const error = new Error("listener failed");

    messenger.subscribe(TOPIC, () => {
      throw error;
    });

    expect(() => messenger.publish(TOPIC, { value: 1 })).toThrow(error);
  });
});
