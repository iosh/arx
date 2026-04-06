import type { ProviderHostWindow } from "@arx/provider/host";
import { createProviderHost } from "@arx/provider/host";
import type { ProviderModule } from "@arx/provider/modules";
import { createEip155Module, eip155TransportCodec } from "@arx/provider/namespaces";
import { WindowPostMessageTransport } from "@arx/provider/transport";
import type { EIP1193Provider, Transport } from "@arx/provider/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INSTALLED_NAMESPACES } from "@/platform/namespaces/installed";
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

type WindowWithBuiltinProviders = Window & { ethereum?: unknown; conflux?: unknown };
type InjectedProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  once: (event: string, listener: (...args: unknown[]) => void) => void;
};

const createStubTransport = (): Transport => ({
  bootstrap: async () => ({
    connected: true,
    chainId: "0x1",
    chainRef: "eip155:1",
    accounts: [],
    isUnlocked: true,
    meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
  }),
  disconnect: async () => {},
  isConnected: () => false,
  request: async () => null,
  on: () => {},
  removeListener: () => {},
});

const createMultiNamespaceModules = (): readonly ProviderModule[] => {
  const createModule = (namespace: string): ProviderModule => {
    const provider = {
      request: vi.fn(async () => null),
      on: vi.fn(),
      removeListener: vi.fn(),
      isConnected: vi.fn(() => false),
    } as unknown as EIP1193Provider;

    return {
      namespace,
      discovery: {
        eip6963: {
          info: {
            uuid: crypto.randomUUID(),
            name: `${namespace} wallet`,
            icon: "data:image/png;base64,AA==",
            rdns: `wallet.${namespace}.test`,
          },
        },
      },
      create: () => ({
        core: provider,
        injected: provider,
      }),
    };
  };

  return [createModule("eip155"), createModule("conflux")];
};

const createInjectedMultiNamespaceModules = (): readonly ProviderModule[] => {
  const createModule = (namespace: string, windowKey: string): ProviderModule => {
    const provider = {
      request: vi.fn(async () => null),
      on: vi.fn(),
      removeListener: vi.fn(),
      isConnected: vi.fn(() => false),
    } as unknown as EIP1193Provider;

    return {
      namespace,
      injection: {
        windowKey,
        mode: "if_absent",
        initializedEvent: `${windowKey}#initialized`,
      },
      create: () => ({
        core: provider,
        injected: provider,
      }),
    };
  };

  return [createModule("eip155", "ethereum"), createModule("conflux", "conflux")];
};

const createDuplicateWindowKeyModules = (): readonly ProviderModule[] => {
  const createModule = (namespace: string): ProviderModule => {
    const provider = {
      request: vi.fn(async () => null),
      on: vi.fn(),
      removeListener: vi.fn(),
      isConnected: vi.fn(() => false),
    } as unknown as EIP1193Provider;

    return {
      namespace,
      injection: {
        windowKey: "ethereum",
        mode: "if_absent",
      },
      create: () => ({
        core: provider,
        injected: provider,
      }),
    };
  };

  return [createModule("eip155"), createModule("conflux")];
};

const createEmptyModules = (): readonly ProviderModule[] => [];

const createDuplicateNamespaceModules = (): readonly ProviderModule[] => {
  const createModule = (): ProviderModule => {
    const provider = {
      request: vi.fn(async () => null),
      on: vi.fn(),
      removeListener: vi.fn(),
      isConnected: vi.fn(() => false),
    } as unknown as EIP1193Provider;

    return {
      namespace: "eip155",
      create: () => ({
        core: provider,
        injected: provider,
      }),
    };
  };

  return [createModule(), createModule()];
};

describe("ProviderHost (inpage injection + EIP-6963)", () => {
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

  const createHarness = (options?: { modules?: readonly ProviderModule[] }) => {
    const transport = new WindowPostMessageTransport({ namespace: "eip155", codec: eip155TransportCodec });

    const host = createProviderHost({
      targetWindow: window as unknown as ProviderHostWindow,
      modules: options?.modules ?? INSTALLED_NAMESPACES.provider.modules,
      createTransportForNamespace: () => transport,
    });
    cleanups.push(() => host.destroy());

    return { transport, host };
  };

  it("injects window.ethereum idempotently and dispatches ethereum#initialized once", () => {
    const bridge = new MockContentBridge(ctx.dom);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host } = createHarness();
    const initialized = onWindowEvent("ethereum#initialized");

    host.initialize();
    host.initialize();

    const w = window as WindowWithBuiltinProviders;
    expect(w.ethereum).toBeDefined();
    expect(initialized).toHaveBeenCalledTimes(1);

    const descriptor = Object.getOwnPropertyDescriptor(window, "ethereum");
    expect(descriptor).toMatchObject({ configurable: true, enumerable: false, writable: false });
  });

  it("does not override an existing window.ethereum (no throw, no ethereum#initialized)", () => {
    const existing = { name: "Other Wallet" };
    (window as WindowWithBuiltinProviders).ethereum = existing;

    const bridge = new MockContentBridge(ctx.dom);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host } = createHarness();

    const initialized = onWindowEvent("ethereum#initialized");
    const announced = onWindowEvent("eip6963:announceProvider");

    host.initialize();

    expect((window as WindowWithBuiltinProviders).ethereum).toBe(existing);
    expect(initialized).toHaveBeenCalledTimes(0);
    expect(announced).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("eip6963:requestProvider"));

    expect(announced).toHaveBeenCalledTimes(2);
    const detail = announced.mock.calls[0]?.[0]?.detail;
    expect(detail?.provider).toBeDefined();
    expect(detail?.provider).not.toBe(existing);
  });

  it("announces on init, re-announces on eip6963:requestProvider, and freezes announce detail", () => {
    const bridge = new MockContentBridge(ctx.dom);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host } = createHarness();
    const announced = onWindowEvent("eip6963:announceProvider");

    host.initialize();
    expect(announced).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    expect(announced).toHaveBeenCalledTimes(3);
    const detail = announced.mock.calls[0]?.[0]?.detail;
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail.info)).toBe(true);
    expect(detail?.provider).toBe((window as WindowWithBuiltinProviders).ethereum);
    expect(detail?.info?.name).toBe("ARX Wallet");
    expect(detail?.info?.rdns).toBe("com.arx.wallet");
    expect(isEip6963Info(detail?.info)).toBe(true);
  });

  it("supports requestProvider before host init and announces on init before re-announcing on request", () => {
    const bridge = new MockContentBridge(ctx.dom);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host } = createHarness();
    const announced = onWindowEvent("eip6963:announceProvider");

    window.dispatchEvent(new Event("eip6963:requestProvider"));
    expect(announced).toHaveBeenCalledTimes(0);

    host.initialize();
    expect(announced).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("eip6963:requestProvider"));
    expect(announced).toHaveBeenCalledTimes(2);
  });

  it("cleans up host-owned listeners and transports on destroy", () => {
    const { host, transport } = createHarness();
    const transportDestroy = vi.spyOn(transport, "destroy");
    const announced = onWindowEvent("eip6963:announceProvider");

    host.initialize();
    expect(announced).toHaveBeenCalledTimes(1);

    host.destroy();
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    expect(transportDestroy).toHaveBeenCalledTimes(1);
    expect(announced).toHaveBeenCalledTimes(1);

    host.destroy();
    expect(transportDestroy).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the provider modules list is empty", () => {
    const host = createProviderHost({
      targetWindow: window as unknown as ProviderHostWindow,
      modules: createEmptyModules(),
      createTransportForNamespace: () => createStubTransport(),
    });

    const initialized = onWindowEvent("ethereum#initialized");
    const announced = onWindowEvent("eip6963:announceProvider");

    host.initialize();
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    expect((window as WindowWithBuiltinProviders).ethereum).toBeUndefined();
    expect(initialized).toHaveBeenCalledTimes(0);
    expect(announced).toHaveBeenCalledTimes(0);
  });

  it("injects multiple provider window keys when the modules include another namespace", () => {
    const host = createProviderHost({
      targetWindow: window as unknown as ProviderHostWindow,
      modules: createInjectedMultiNamespaceModules(),
      createTransportForNamespace: () => createStubTransport(),
    });

    const ethereumInitialized = onWindowEvent("ethereum#initialized");
    const confluxInitialized = onWindowEvent("conflux#initialized");

    host.initialize();

    const w = window as WindowWithBuiltinProviders;
    expect(w.ethereum).toBeDefined();
    expect(w.conflux).toBeDefined();
    expect(w.ethereum).not.toBe(w.conflux);
    expect(ethereumInitialized).toHaveBeenCalledTimes(1);
    expect(confluxInitialized).toHaveBeenCalledTimes(1);
  });

  it("rejects reusing the same transport instance across namespaces", () => {
    const sharedTransport = createStubTransport();
    const host = createProviderHost({
      targetWindow: window as unknown as ProviderHostWindow,
      modules: createMultiNamespaceModules(),
      createTransportForNamespace: () => sharedTransport,
    });

    expect(() => host.initialize()).toThrow(
      'createTransportForNamespace must return a distinct transport per namespace; received the same transport for "eip155" and "conflux"',
    );
  });

  it("rejects duplicate provider module namespaces", () => {
    expect(() =>
      createProviderHost({
        targetWindow: window as unknown as ProviderHostWindow,
        modules: createDuplicateNamespaceModules(),
        createTransportForNamespace: () => createStubTransport(),
      }),
    ).toThrow(/Duplicate provider module namespace "eip155"/);
  });

  it("rejects duplicate injected window keys across namespaces", () => {
    expect(() =>
      createProviderHost({
        targetWindow: window as unknown as ProviderHostWindow,
        modules: createDuplicateWindowKeyModules(),
        createTransportForNamespace: () => createStubTransport(),
      }),
    ).toThrow(/duplicate injection windowKey "ethereum"/i);
  });

  it("rejects duplicate initialized events across namespaces", () => {
    const createModule = (namespace: string): ProviderModule => {
      const provider = {
        request: vi.fn(async () => null),
        on: vi.fn(),
        removeListener: vi.fn(),
        isConnected: vi.fn(() => false),
      } as unknown as EIP1193Provider;

      return {
        namespace,
        injection: {
          windowKey: namespace === "eip155" ? "ethereum" : "conflux",
          mode: "if_absent",
          initializedEvent: "wallet#initialized",
        },
        create: () => ({
          core: provider,
          injected: provider,
        }),
      };
    };

    expect(() =>
      createProviderHost({
        targetWindow: window as unknown as ProviderHostWindow,
        modules: [createModule("eip155"), createModule("conflux")],
        createTransportForNamespace: () => createStubTransport(),
      }),
    ).toThrow(/duplicate injection initializedEvent "wallet#initialized"/i);
  });

  it("keeps transport bootstrap lazy until the injected provider is used", async () => {
    const bridge = new MockContentBridge(ctx.dom, { autoHandshake: false });
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host } = createHarness();
    host.initialize();

    await Promise.resolve();
    expect(bridge.getRequestCount("eth_chainId")).toBe(0);

    const provider = (window as WindowWithBuiltinProviders).ethereum as unknown as InjectedProvider;
    const pending = provider.request({ method: "eth_chainId" });

    await bridge.waitForHandshake();
    bridge.ackHandshake();

    await expect(pending).resolves.toBe("0x1");
  });

  it("does not throw for eth_accounts before ready, then returns accounts after handshake", async () => {
    const modules = [
      createEip155Module({
        timeouts: { ethAccountsWaitMs: 0, readyTimeoutMs: 2000 },
      }),
    ] satisfies readonly ProviderModule[];

    const bridge = new MockContentBridge(ctx.dom, { autoHandshake: false });
    bridge.setAccounts(["0xabc"]);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host } = createHarness({ modules });
    host.initialize();

    const provider = (window as WindowWithBuiltinProviders).ethereum as unknown as InjectedProvider;
    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual([]);

    await bridge.waitForHandshake();
    bridge.ackHandshake({ accounts: ["0xabc"] });

    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual(["0xabc"]);
  });

  it("keeps chainChanged/accountsChanged consistent with eth_chainId/eth_accounts", async () => {
    const bridge = new MockContentBridge(ctx.dom);
    bridge.setAccounts(["0xaaa"]);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host } = createHarness();
    host.initialize();

    const provider = (window as WindowWithBuiltinProviders).ethereum as unknown as InjectedProvider;
    await expect(provider.request({ method: "eth_chainId" })).resolves.toBe("0x1");

    const chainChanged = new Promise<string>((resolve) =>
      provider.once("chainChanged", (...args: unknown[]) => resolve(args[0] as string)),
    );
    bridge.emitChainChanged({ chainId: "0x2", chainRef: "eip155:2" });
    await expect(chainChanged).resolves.toBe("0x2");
    await expect(provider.request({ method: "eth_chainId" })).resolves.toBe("0x2");

    const accountsChanged = new Promise<string[]>((resolve) =>
      provider.once("accountsChanged", (...args: unknown[]) => resolve(args[0] as string[])),
    );
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

    const { host } = createHarness();
    host.initialize();

    const provider = (window as WindowWithBuiltinProviders).ethereum as unknown as InjectedProvider;
    await provider.request({ method: "eth_chainId" });

    const onAccountsChanged = vi.fn();
    provider.on("accountsChanged", onAccountsChanged);

    const p1 = provider.request({ method: "eth_requestAccounts" });
    const p2 = provider.request({ method: "eth_requestAccounts" });
    await expect(Promise.all([p1, p2])).resolves.toEqual([["0xabc"], ["0xabc"]]);

    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(bridge.getRequestCount("eth_requestAccounts")).toBe(2);
    expect(onAccountsChanged).toHaveBeenCalledTimes(1);
    expect(onAccountsChanged).toHaveBeenCalledWith(["0xabc"]);
  });

  it("keeps window.ethereum reference stable across disconnect/rebootstrap", async () => {
    const bridge = new MockContentBridge(ctx.dom);
    bridge.setAccounts(["0xabc"]);
    bridge.attach();
    cleanups.push(() => bridge.detach());

    const { host, transport } = createHarness();
    host.initialize();

    const provider = (window as WindowWithBuiltinProviders).ethereum as unknown as InjectedProvider;
    await provider.request({ method: "eth_chainId" });

    bridge.emitDisconnect();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    await transport.bootstrap();
    expect((window as WindowWithBuiltinProviders).ethereum).toBe(provider);
  });
});
