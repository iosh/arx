import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it } from "vitest";
import { CHANNEL } from "./constants.js";
import { InpageTransport } from "./inpage.js";

describe("InpageTransport handshake/disconnect", () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>");
    (global as any).window = dom.window as unknown as Window;
    (global as any).document = dom.window.document;
    // Ensure event constructors are from JSDOM window
    (global as any).MessageEvent = dom.window.MessageEvent;
  });

  it("returns empty state before handshake", () => {
    const t = new InpageTransport();
    expect(t.getConnectionState()).toEqual({
      connected: false,
      chainId: null,
      caip2: null,
      accounts: [],
      isUnlocked: null,
      meta: null,
    });
  });

  it("handles handshake_ack and marks connected", async () => {
    const t = new InpageTransport();

    // Wait for connect event to ensure handshake is complete
    const connectPromise = new Promise<void>((resolve) => {
      t.once("connect", () => resolve());
    });

    // Manually construct MessageEvent with proper source in JSDOM
    const messageData = {
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
    };

    // Create event using JSDOM's MessageEvent constructor
    const event = new MessageEvent("message", {
      data: messageData,
      source: window as MessageEventSource,
    });

    // Dispatch the event
    window.dispatchEvent(event);

    // Wait for the connect event to fire
    await connectPromise;

    const state = t.getConnectionState();
    expect(state.connected).toBe(true);
    expect(state.chainId).toBe("0x1");
    expect(state.accounts).toEqual(["0xabc"]);
    expect(state.caip2).toBe("eip155:1");
  });

  it("rejects pending request on disconnect", async () => {
    const t = new InpageTransport();

    window.postMessage(
      {
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
      "*",
    );
    await Promise.resolve();

    const reqPromise = t.request({ method: "eth_chainId" }).catch((err) => err);

    window.postMessage(
      {
        channel: CHANNEL,
        type: "event",
        payload: { event: "disconnect", params: [] },
      },
      "*",
    );

    const err = await reqPromise;
    expect(err).toMatchObject({ code: 4900 });
    expect(t.isConnected()).toBe(false);
  });
});
