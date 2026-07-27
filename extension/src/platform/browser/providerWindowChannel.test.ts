// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  createProviderWindowChannel,
  createProviderWindowEnvelope,
  PROVIDER_WINDOW_TARGET,
} from "./providerWindowChannel";

describe("createProviderWindowChannel", () => {
  it("posts toward content and only receives same-window, same-origin page messages", () => {
    const pageOrigin = window.location.origin;
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const channel = createProviderWindowChannel({ targetWindow: window, pageOrigin });
    const listener = vi.fn();
    const unsubscribe = channel.onMessage(listener);

    channel.send({ type: "open", namespace: "eip155" });
    expect(postMessage).toHaveBeenCalledWith(
      createProviderWindowEnvelope(PROVIDER_WINDOW_TARGET.content, { type: "open", namespace: "eip155" }),
      pageOrigin,
    );

    window.dispatchEvent(
      new MessageEvent("message", {
        data: createProviderWindowEnvelope(PROVIDER_WINDOW_TARGET.page, { type: "opened" }),
        source: null,
        origin: pageOrigin,
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: createProviderWindowEnvelope(PROVIDER_WINDOW_TARGET.page, { type: "opened" }),
        source: window,
        origin: "https://other.test",
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: createProviderWindowEnvelope(PROVIDER_WINDOW_TARGET.content, { type: "opened" }),
        source: window,
        origin: pageOrigin,
      }),
    );

    expect(listener).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: createProviderWindowEnvelope(PROVIDER_WINDOW_TARGET.page, { type: "opened" }),
        source: window,
        origin: pageOrigin,
      }),
    );
    expect(listener).toHaveBeenCalledWith({ type: "opened" });

    unsubscribe();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: createProviderWindowEnvelope(PROVIDER_WINDOW_TARGET.page, { type: "later" }),
        source: window,
        origin: pageOrigin,
      }),
    );
    expect(listener).toHaveBeenCalledOnce();
  });
});
