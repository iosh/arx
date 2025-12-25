import type { ProviderHostWindow } from "@arx/provider/host";
import { createProviderHost } from "@arx/provider/host";
import { CHANNEL, PROTOCOL_VERSION } from "@arx/provider/protocol";
import { WindowPostMessageTransport } from "@arx/provider/transport";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    const transport = new WindowPostMessageTransport();
    const host = createProviderHost({ transport, targetWindow: window as unknown as ProviderHostWindow });
    const listener = vi.fn();
    window.addEventListener("eip6963:announceProvider", listener);

    // Mock content script behavior: listen for handshake and respond with handshake_ack
    const messageHandler = (event: MessageEvent) => {
      const data = event.data;

      // When receiving handshake request, reply with handshake_ack
      if (data?.channel === CHANNEL && data?.type === "handshake") {
        const handshakeId = data.payload?.handshakeId;
        const sessionId = data.sessionId;
        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            data: {
              channel: CHANNEL,
              sessionId,
              type: "handshake_ack",
              payload: {
                protocolVersion: PROTOCOL_VERSION,
                handshakeId,
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
    const transport = new WindowPostMessageTransport();
    const host = createProviderHost({ transport, targetWindow: window as unknown as ProviderHostWindow });
    const listener = vi.fn();
    window.addEventListener("eip6963:announceProvider", listener);

    // Mock content script behavior
    const messageHandler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.channel === CHANNEL && data?.type === "handshake") {
        const handshakeId = data.payload?.handshakeId;
        const sessionId = data.sessionId;
        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            data: {
              channel: CHANNEL,
              sessionId,
              type: "handshake_ack",
              payload: {
                protocolVersion: PROTOCOL_VERSION,
                handshakeId,
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
    const transport = new WindowPostMessageTransport();
    const host = createProviderHost({ transport, targetWindow: window as unknown as ProviderHostWindow });

    // Initial connection
    let transportSessionId: string | null = null;
    const messageHandler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.channel === CHANNEL && data?.type === "handshake") {
        const handshakeId = data.payload?.handshakeId;
        const sessionId = data.sessionId;
        transportSessionId = sessionId;
        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            data: {
              channel: CHANNEL,
              sessionId,
              type: "handshake_ack",
              payload: {
                protocolVersion: PROTOCOL_VERSION,
                handshakeId,
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
            origin: dom.window.location.origin,
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
    expect(transportSessionId).toBeTruthy();
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", {
        data: {
          channel: CHANNEL,
          sessionId: transportSessionId,
          type: "event",
          payload: { event: "disconnect", params: [] },
        },
        source: dom.window as unknown as Window,
        origin: dom.window.location.origin,
      }),
    );

    await onDisconnect;

    // Simulate a real reconnect by running handshake again
    await transport.connect();

    const providerAfterReconnect = (window as any).ethereum;
    expect(providerAfterReconnect).toBe(provider);
  });

  it("supports standard eth_chainId/eth_accounts after handshake", async () => {
    const transport = new WindowPostMessageTransport();
    const host = createProviderHost({ transport, targetWindow: window as unknown as ProviderHostWindow });

    const messageHandler = (event: MessageEvent) => {
      const data = event.data as any;
      if (data?.channel !== CHANNEL) return;

      const { sessionId, type } = data;

      // Handle handshake
      if (type === "handshake") {
        const handshakeId = data.payload?.handshakeId;
        if (typeof handshakeId !== "string" || typeof sessionId !== "string") return;
        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            data: {
              channel: CHANNEL,
              sessionId,
              type: "handshake_ack",
              payload: {
                protocolVersion: PROTOCOL_VERSION,
                handshakeId,
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
            origin: dom.window.location.origin,
          }),
        );
        return;
      }

      // Handle RPC requests
      if (type === "request") {
        const { id, payload } = data;
        if (typeof sessionId !== "string" || typeof id !== "string") return;
        if (!payload || typeof payload !== "object") return;

        const responses: Record<string, unknown> = {
          eth_chainId: "0x1",
          eth_accounts: ["0xabc"],
        };
        const method = (payload as any).method as string | undefined;
        if (typeof method !== "string") return;
        if (!(method in responses)) return;

        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            data: {
              channel: CHANNEL,
              sessionId,
              type: "response",
              id,
              payload: {
                jsonrpc: "2.0",
                id,
                result: responses[method],
              },
            },
            source: dom.window as unknown as Window,
            origin: dom.window.location.origin,
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
    await expect(provider.request({ method: "eth_chainId" })).resolves.toBe("0x1");
    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual(["0xabc"]);

    dom.window.removeEventListener("message", messageHandler);
  });
});
