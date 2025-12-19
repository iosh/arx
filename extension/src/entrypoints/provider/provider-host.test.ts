import { CHANNEL } from "@arx/provider-extension/constants";
import { InpageTransport } from "@arx/provider-extension/inpage";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderHost } from "./providerHost";

describe("ProviderHost EIP-6963", () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://dapp.test" });
    (global as any).window = dom.window as unknown as Window;
    (global as any).document = dom.window.document;
    // Ensure CustomEvent is from JSDOM window
    (global as any).CustomEvent = dom.window.CustomEvent;
    (global as any).MessageEvent = dom.window.MessageEvent;
  });
  it("announces provider on requestProvider", async () => {
    const transport = new InpageTransport();
    const host = new ProviderHost(transport);
    const listener = vi.fn();
    window.addEventListener("eip6963:announceProvider", listener);

    // Mock content script behavior: listen for handshake and respond with handshake_ack
    const messageHandler = (event: MessageEvent) => {
      const data = event.data;

      // When receiving handshake request, reply with handshake_ack
      if (data?.channel === CHANNEL && data?.type === "handshake") {
        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            data: {
              channel: CHANNEL,
              type: "handshake_ack",
              payload: {
                chainId: "0x1",
                caip2: "eip155:1",
                accounts: [],
                isUnlocked: true,
                meta: {
                  activeChain: "eip155:1",
                  activeNamespace: "eip155",
                  supportedChains: ["eip155:1"],
                },
              },
            },
            source: dom.window as unknown as Window,
            origin: dom.window.location.origin,
          }),
        );
      }
    };

    dom.window.addEventListener("message", messageHandler);

    host.initialize();

    // Clear the announcement from start(), we only want to test the response to requestProvider
    listener.mockClear();

    window.dispatchEvent(new CustomEvent("eip6963:requestProvider"));

    expect(listener).toHaveBeenCalledTimes(1);
    const detail = listener.mock.calls[0]?.[0].detail;
    expect(detail?.provider).toBeDefined();
    expect(detail?.info?.name).toBe("ARX Wallet");

    dom.window.removeEventListener("message", messageHandler);
  });

  it("handles multiple requestProvider calls idempotently", async () => {
    const transport = new InpageTransport();
    const host = new ProviderHost(transport);
    const listener = vi.fn();
    window.addEventListener("eip6963:announceProvider", listener);

    // Mock content script behavior
    const messageHandler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.channel === CHANNEL && data?.type === "handshake") {
        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            data: {
              channel: CHANNEL,
              type: "handshake_ack",
              payload: {
                chainId: "0x1",
                caip2: "eip155:1",
                accounts: [],
                isUnlocked: true,
                meta: {
                  activeChain: "eip155:1",
                  activeNamespace: "eip155",
                  supportedChains: ["eip155:1"],
                },
              },
            },
            source: dom.window as unknown as Window,
          }),
        );
      }
    };

    dom.window.addEventListener("message", messageHandler);
    host.initialize();

    const firstProvider = (window as any).ethereum;
    listener.mockClear();

    // Trigger requestProvider multiple times
    window.dispatchEvent(new CustomEvent("eip6963:requestProvider"));
    window.dispatchEvent(new CustomEvent("eip6963:requestProvider"));
    window.dispatchEvent(new CustomEvent("eip6963:requestProvider"));

    // Should announce 3 times but provider instance stays the same
    expect(listener).toHaveBeenCalledTimes(3);
    const secondProvider = (window as any).ethereum;
    expect(secondProvider).toBe(firstProvider);

    dom.window.removeEventListener("message", messageHandler);
  });

  it("reconnects and syncs providers after disconnect", async () => {
    const transport = new InpageTransport();
    const host = new ProviderHost(transport);

    // Initial connection
    const messageHandler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.channel === CHANNEL && data?.type === "handshake") {
        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            data: {
              channel: CHANNEL,
              type: "handshake_ack",
              payload: {
                chainId: "0x1",
                caip2: "eip155:1",
                accounts: ["0xabc"],
                isUnlocked: true,
                meta: {
                  activeChain: "eip155:1",
                  activeNamespace: "eip155",
                  supportedChains: ["eip155:1"],
                },
              },
            },
            source: dom.window as unknown as Window,
          }),
        );
      }
    };

    dom.window.addEventListener("message", messageHandler);

    const firstConnect = new Promise<void>((resolve) => {
      transport.once("connect", () => resolve());
    });

    host.initialize();
    await firstConnect;

    const provider = (window as any).ethereum;
    expect(provider).toBeDefined();

    const onDisconnect = new Promise<void>((resolve) => {
      transport.once("disconnect", () => resolve());
    });

    // Simulate disconnect (after initial connect is established)
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", {
        data: {
          channel: CHANNEL,
          type: "event",
          payload: { event: "disconnect", params: [] },
        },
        source: dom.window as unknown as Window,
      }),
    );

    await onDisconnect;

    // Simulate a real reconnect by running handshake again
    await transport.connect();

    const providerAfterReconnect = (window as any).ethereum;
    expect(providerAfterReconnect).toBe(provider);
  });

  it("exposes wallet/metamask provider state helpers", async () => {
    const transport = new InpageTransport();
    const host = new ProviderHost(transport);
    const messageHandler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.channel === CHANNEL && data?.type === "handshake") {
        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            data: {
              channel: CHANNEL,
              type: "handshake_ack",
              payload: {
                chainId: "0x1",
                caip2: "eip155:1",
                accounts: ["0xabc"],
                isUnlocked: true,
                meta: {
                  activeChain: "eip155:1",
                  activeNamespace: "eip155",
                  supportedChains: ["eip155:1"],
                },
              },
            },
            source: dom.window as unknown as Window,
          }),
        );
      }
    };

    dom.window.addEventListener("message", messageHandler);

    const connected = new Promise<void>((resolve) => {
      transport.once("connect", () => resolve());
    });

    host.initialize();
    await connected;

    const provider = (window as any).ethereum;
    await expect(provider.request({ method: "wallet_getProviderState" })).resolves.toMatchObject({
      accounts: ["0xabc"],
      chainId: "0x1",
      isUnlocked: true,
    });

    dom.window.removeEventListener("message", messageHandler);
  });
});
