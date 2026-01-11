import type { ProviderHostWindow } from "@arx/provider/host";
import { createProviderHost } from "@arx/provider/host";
import { createProviderRegistry } from "@arx/provider/registry";
import { WindowPostMessageTransport } from "@arx/provider/transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDom, MockContentBridge, type TestDomContext } from "./provider-host.test.helpers.js";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const isEip6963Info = (value: unknown): value is { uuid: string; name: string; icon: string; rdns: string } => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.uuid !== "string" || !UUID_V4_REGEX.test(candidate.uuid)) return false;
  if (typeof candidate.name !== "string" || candidate.name.length === 0) return false;
  if (typeof candidate.icon !== "string" || !candidate.icon.startsWith("data:image")) return false;
  if (typeof candidate.rdns !== "string" || candidate.rdns.length === 0) return false;
  return true;
};

describe("ProviderHost (window injection + EIP-6963)", () => {
  let ctx: TestDomContext;
  let cleanups: Array<() => void>;

  beforeEach(() => {
    ctx = createTestDom("https://dapp.test");
    cleanups = [];
  });

  afterEach(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    ctx.teardown();
  });

  const onWindowEvent = (type: string) => {
    const listener = vi.fn();
    window.addEventListener(type, listener as EventListener);
    cleanups.push(() => window.removeEventListener(type, listener as EventListener));
    return listener;
  };

  const createHarness = (options?: { registry?: ReturnType<typeof createProviderRegistry> }) => {
    const transport = new WindowPostMessageTransport();
    cleanups.push(() => transport.destroy());

    const host = createProviderHost({
      transport,
      targetWindow: window as unknown as ProviderHostWindow,
      ...(options?.registry ? { registry: options.registry } : {}),
    });

    return { transport, host };
  };

  const waitForTransportConnect = async (transport: WindowPostMessageTransport, timeoutMs = 2000) => {
    if (transport.isConnected()) return;
    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error("Timed out waiting for transport connect"));
      }, timeoutMs);

      transport.once("connect", () => {
        window.clearTimeout(timeoutId);
        resolve();
      });
    });
  };

  it("injects window.ethereum idempotently and dispatches ethereum#initialized once", async () => {
    const bridge = new MockContentBridge(ctx.dom);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host, transport } = createHarness();

    const initialized = onWindowEvent("ethereum#initialized");

    host.initialize();
    host.initialize();

    expect((window as any).ethereum).toBeDefined();
    expect(initialized).toHaveBeenCalledTimes(1);

    const descriptor = Object.getOwnPropertyDescriptor(window, "ethereum");
    expect(descriptor).toMatchObject({ configurable: true, enumerable: false, writable: false });

    await waitForTransportConnect(transport);
  });

  it("does not override an existing window.ethereum (no throw, no ethereum#initialized)", async () => {
    const existing = { name: "Other Wallet" };
    (window as any).ethereum = existing;

    const bridge = new MockContentBridge(ctx.dom);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host, transport } = createHarness();

    const initialized = onWindowEvent("ethereum#initialized");
    const announced = onWindowEvent("eip6963:announceProvider");

    host.initialize();

    expect((window as any).ethereum).toBe(existing);
    expect(initialized).toHaveBeenCalledTimes(0);

    expect(announced).toHaveBeenCalledTimes(1);
    const detail = announced.mock.calls[0]?.[0]?.detail;
    expect(detail?.provider).toBeDefined();
    expect(detail?.provider).not.toBe(existing);

    await waitForTransportConnect(transport);
  });

  it("re-announces on eip6963:requestProvider and freezes announce detail", async () => {
    const bridge = new MockContentBridge(ctx.dom);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host, transport } = createHarness();
    const announced = onWindowEvent("eip6963:announceProvider");

    host.initialize();
    announced.mockClear();

    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    expect(announced).toHaveBeenCalledTimes(2);
    const detail = announced.mock.calls[0]?.[0]?.detail;
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail.info)).toBe(true);
    expect(detail?.provider).toBe((window as any).ethereum);
    expect(detail?.info?.name).toBe("ARX Wallet");
    expect(detail?.info?.rdns).toBe("wallet.arx");
    expect(isEip6963Info(detail?.info)).toBe(true);

    await waitForTransportConnect(transport);
  });

  it("supports requestProvider before host init (announce on init + re-announce on request)", async () => {
    const bridge = new MockContentBridge(ctx.dom);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host, transport } = createHarness();
    const announced = onWindowEvent("eip6963:announceProvider");

    window.dispatchEvent(new Event("eip6963:requestProvider"));
    expect(announced).toHaveBeenCalledTimes(0);

    host.initialize();
    expect(announced).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("eip6963:requestProvider"));
    expect(announced).toHaveBeenCalledTimes(2);

    await waitForTransportConnect(transport);
  });

  it("does not throw for eth_accounts before ready, then returns accounts after handshake", async () => {
    const registry = createProviderRegistry({
      ethereum: { timeouts: { ethAccountsWaitMs: 0, readyTimeoutMs: 2000 } },
    });

    const bridge = new MockContentBridge(ctx.dom, { autoHandshake: false });
    bridge.setAccounts(["0xabc"]);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host, transport } = createHarness({ registry });
    host.initialize();

    const provider = (window as any).ethereum;
    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual([]);

    await bridge.waitForHandshake();
    const connected = new Promise<void>((resolve) => transport.once("connect", () => resolve()));
    bridge.ackHandshake({ accounts: ["0xabc"] });
    await connected;

    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual(["0xabc"]);
  });

  it("keeps chainChanged/accountsChanged consistent with eth_chainId/eth_accounts", async () => {
    const bridge = new MockContentBridge(ctx.dom);
    bridge.setAccounts(["0xaaa"]);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host, transport } = createHarness();

    const connected = new Promise<void>((resolve) => transport.once("connect", () => resolve()));
    host.initialize();
    await connected;

    const provider = (window as any).ethereum;

    const chainChanged = new Promise<string>((resolve) => provider.once("chainChanged", resolve));
    bridge.emitChainChanged({ chainId: "0x2", caip2: "eip155:2" });
    await expect(chainChanged).resolves.toBe("0x2");
    await expect(provider.request({ method: "eth_chainId" })).resolves.toBe("0x2");

    const accountsChanged = new Promise<string[]>((resolve) => provider.once("accountsChanged", resolve));
    bridge.emitAccountsChanged(["0xbbb"]);
    await expect(accountsChanged).resolves.toEqual(["0xbbb"]);
    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual(["0xbbb"]);
  });

  it("supports concurrent eth_requestAccounts without duplicate accountsChanged for identical results", async () => {
    const bridge = new MockContentBridge(ctx.dom);
    bridge.setAccounts([]);
    bridge.setRequestAccountsResult(["0xabc"]);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host, transport } = createHarness();
    const connected = new Promise<void>((resolve) => transport.once("connect", () => resolve()));
    host.initialize();
    await connected;

    const provider = (window as any).ethereum;

    const onAccountsChanged = vi.fn();
    provider.on("accountsChanged", onAccountsChanged);

    const p1 = provider.request({ method: "eth_requestAccounts" });
    const p2 = provider.request({ method: "eth_requestAccounts" });
    await expect(Promise.all([p1, p2])).resolves.toEqual([["0xabc"], ["0xabc"]]);

    expect(bridge.getRequestCount("eth_requestAccounts")).toBe(2);
    expect(onAccountsChanged).toHaveBeenCalledTimes(1);
    expect(onAccountsChanged).toHaveBeenCalledWith(["0xabc"]);
  });

  it("keeps window.ethereum reference stable across disconnect/reconnect", async () => {
    const bridge = new MockContentBridge(ctx.dom);
    bridge.setAccounts(["0xabc"]);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host, transport } = createHarness();
    const firstConnect = new Promise<void>((resolve) => transport.once("connect", () => resolve()));
    host.initialize();
    await firstConnect;

    const provider = (window as any).ethereum;

    const onDisconnect = new Promise<void>((resolve) => transport.once("disconnect", () => resolve()));
    bridge.emitDisconnect();
    await onDisconnect;

    await transport.connect();
    expect((window as any).ethereum).toBe(provider);
  });
});
