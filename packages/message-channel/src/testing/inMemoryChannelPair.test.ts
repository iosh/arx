import { describe, expect, it, vi } from "vitest";
import { createInMemoryChannelPair } from "./inMemoryChannelPair.js";

describe("createInMemoryChannelPair", () => {
  it("delivers messages in both directions", () => {
    const pair = createInMemoryChannelPair();
    const leftListener = vi.fn();
    const rightListener = vi.fn();

    pair.left.onMessage(leftListener);
    pair.right.onMessage(rightListener);

    pair.left.send({ direction: "right", value: 1 });
    pair.right.send({ direction: "left", value: 2 });

    expect(rightListener).toHaveBeenCalledWith({ direction: "right", value: 1 });
    expect(leftListener).toHaveBeenCalledWith({ direction: "left", value: 2 });

    pair.disconnect();
  });

  it("stops delivering messages after a listener is unsubscribed", () => {
    const pair = createInMemoryChannelPair();
    const listener = vi.fn();
    const disconnectListener = vi.fn();

    const unsubscribe = pair.left.onMessage(listener);
    const unsubscribeDisconnect = pair.left.onDisconnect(disconnectListener);
    unsubscribe();
    unsubscribeDisconnect();
    pair.right.send("ignored");
    pair.disconnect();

    expect(listener).not.toHaveBeenCalled();
    expect(disconnectListener).not.toHaveBeenCalled();
  });

  it("notifies each endpoint once when the pair disconnects", () => {
    const pair = createInMemoryChannelPair();
    const leftListener = vi.fn();
    const rightListener = vi.fn();

    pair.left.onDisconnect(leftListener);
    pair.right.onDisconnect(rightListener);

    pair.disconnect();
    pair.disconnect();

    expect(leftListener).toHaveBeenCalledOnce();
    expect(rightListener).toHaveBeenCalledOnce();
  });

  it("fails synchronously when sending after disconnect", () => {
    const pair = createInMemoryChannelPair();

    pair.disconnect();

    expect(() => pair.left.send("ignored")).toThrow("Cannot send through a disconnected channel.");
    expect(() => pair.right.send("ignored")).toThrow("Cannot send through a disconnected channel.");
  });
});
