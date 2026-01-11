import { CHANNEL, PROTOCOL_VERSION } from "@arx/provider/protocol";
import type { TransportMeta } from "@arx/provider/types";
import { JSDOM } from "jsdom";

export type TestDomContext = {
  dom: JSDOM;
  teardown: () => void;
};

export const createTestDom = (url = "https://dapp.test"): TestDomContext => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });

  const g = globalThis as unknown as Record<string, unknown>;
  const prev = {
    window: g.window,
    document: g.document,
    Event: g.Event,
    CustomEvent: g.CustomEvent,
    MessageEvent: g.MessageEvent,
  };

  g.window = dom.window as unknown as Window;
  g.document = dom.window.document;
  g.Event = dom.window.Event;
  g.CustomEvent = dom.window.CustomEvent;
  g.MessageEvent = dom.window.MessageEvent;

  const restoreKey = (key: keyof typeof prev) => {
    if (prev[key] === undefined) {
      delete g[key];
      return;
    }
    g[key] = prev[key] as unknown;
  };

  return {
    dom,
    teardown: () => {
      restoreKey("MessageEvent");
      restoreKey("CustomEvent");
      restoreKey("Event");
      restoreKey("document");
      restoreKey("window");
      dom.window.close();
    },
  };
};

export const buildMeta = (activeChain: string): TransportMeta => ({
  activeChain,
  activeNamespace: "eip155",
  supportedChains: [activeChain],
});

export class MockContentBridge {
  #dom: JSDOM;
  #attached = false;
  #autoHandshake = true;
  #sessionId: string | null = null;
  #handshakeId: string | null = null;
  #handshakeWaiters: Array<() => void> = [];
  #chainId = "0x1";
  #caip2 = "eip155:1";
  #accounts: string[] = [];
  #requestAccountsResult: string[] = [];
  #requestCounts = new Map<string, number>();

  constructor(dom: JSDOM, options?: { autoHandshake?: boolean }) {
    this.#dom = dom;
    this.#autoHandshake = options?.autoHandshake ?? true;
  }

  attach() {
    if (this.#attached) return;
    this.#attached = true;
    this.#dom.window.addEventListener("message", this.#handleMessage);
  }

  detach() {
    if (!this.#attached) return;
    this.#attached = false;
    this.#dom.window.removeEventListener("message", this.#handleMessage);
  }

  getRequestCount(method: string) {
    return this.#requestCounts.get(method) ?? 0;
  }

  setChain(chainId: string, caip2: string) {
    this.#chainId = chainId;
    this.#caip2 = caip2;
  }

  setAccounts(accounts: string[]) {
    this.#accounts = accounts;
  }

  setRequestAccountsResult(accounts: string[]) {
    this.#requestAccountsResult = accounts;
  }

  async waitForHandshake() {
    if (this.#sessionId && this.#handshakeId) return;
    await new Promise<void>((resolve) => this.#handshakeWaiters.push(resolve));
  }

  ackHandshake(overrides?: Partial<{ chainId: string; caip2: string; accounts: string[] }>) {
    if (!this.#sessionId || !this.#handshakeId) {
      throw new Error("No pending handshake to acknowledge");
    }

    const chainId = overrides?.chainId ?? this.#chainId;
    const caip2 = overrides?.caip2 ?? this.#caip2;
    const accounts = overrides?.accounts ?? this.#accounts;

    this.#dispatchMessage({
      channel: CHANNEL,
      sessionId: this.#sessionId,
      type: "handshake_ack",
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        handshakeId: this.#handshakeId,
        chainId,
        caip2,
        accounts,
        isUnlocked: true,
        meta: buildMeta(caip2),
      },
    });
  }

  emitAccountsChanged(accounts: string[]) {
    if (!this.#sessionId) throw new Error("No active sessionId");
    this.#dispatchMessage({
      channel: CHANNEL,
      sessionId: this.#sessionId,
      type: "event",
      payload: { event: "accountsChanged", params: [accounts] },
    });
  }

  emitChainChanged(update: { chainId: string; caip2: string }) {
    if (!this.#sessionId) throw new Error("No active sessionId");
    this.#dispatchMessage({
      channel: CHANNEL,
      sessionId: this.#sessionId,
      type: "event",
      payload: {
        event: "chainChanged",
        params: [{ chainId: update.chainId, caip2: update.caip2, meta: buildMeta(update.caip2) }],
      },
    });
  }

  emitDisconnect() {
    if (!this.#sessionId) throw new Error("No active sessionId");
    this.#dispatchMessage({
      channel: CHANNEL,
      sessionId: this.#sessionId,
      type: "event",
      payload: { event: "disconnect", params: [] },
    });
  }

  #dispatchMessage(data: unknown) {
    this.#dom.window.dispatchEvent(
      new this.#dom.window.MessageEvent("message", {
        data,
        source: this.#dom.window as unknown as Window,
        origin: this.#dom.window.location.origin,
      }),
    );
  }

  #handleMessage = (event: MessageEvent) => {
    const data = event.data as any;
    if (data?.channel !== CHANNEL) return;

    if (data.type === "handshake") {
      this.#sessionId = data.sessionId;
      this.#handshakeId = data.payload?.handshakeId;
      for (const resolve of this.#handshakeWaiters.splice(0)) resolve();
      if (this.#autoHandshake) {
        this.ackHandshake();
      }
      return;
    }

    if (data.type !== "request") return;

    const method = data.payload?.method as string | undefined;
    const id = data.id as string | undefined;
    const sessionId = data.sessionId as string | undefined;
    if (typeof method !== "string" || typeof id !== "string" || typeof sessionId !== "string") return;

    this.#requestCounts.set(method, (this.#requestCounts.get(method) ?? 0) + 1);

    const resultByMethod: Record<string, unknown> = {
      eth_chainId: this.#chainId,
      eth_accounts: this.#accounts,
      eth_requestAccounts: this.#requestAccountsResult,
    };

    if (!(method in resultByMethod)) return;

    this.#dispatchMessage({
      channel: CHANNEL,
      sessionId,
      type: "response",
      id,
      payload: { jsonrpc: "2.0", id, result: resultByMethod[method] },
    });
  };
}
