import { describe, expect, it, vi } from "vitest";
import type { RequestArguments } from "../../types/eip1193.js";
import { REQUEST_VALIDATION_MESSAGES } from "./constants.js";
import { buildMeta, StubTransport } from "./eip155.test.helpers.js";
import { providerErrors, rpcErrors } from "./errors.js";
import { Eip155Provider } from "./provider.js";
import type { ProviderSnapshot } from "./state.js";

const INITIAL_SNAPSHOT: ProviderSnapshot = {
  connected: true,
  chainId: "0x1",
  chainRef: "eip155:1",
  accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  isUnlocked: true,
  meta: buildMeta(),
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

type Eip155PageProvider = Eip155Provider &
  Record<string, unknown> & {
    isMetaMask: boolean;
    _metamask: { isUnlocked: () => Promise<boolean> };
    networkVersion: string | null;
  };

const PROTECTED_KEYS = [
  "request",
  "isConnected",
  "send",
  "sendAsync",
  "on",
  "once",
  "removeListener",
  "removeAllListeners",
  "enable",
  "wallet_getPermissions",
  "wallet_requestPermissions",
  "chainId",
  "networkVersion",
  "selectedAddress",
  "isMetaMask",
  "_metamask",
] as const;

const createProvider = (
  initialSnapshot: ProviderSnapshot = INITIAL_SNAPSHOT,
  options?: ConstructorParameters<typeof Eip155Provider>[0]["timeouts"],
) => {
  const transport = new StubTransport(initialSnapshot);
  const provider = new Eip155Provider({ transport, ...(options ? { timeouts: options } : {}) });
  return { transport, provider };
};

const asPageProvider = (provider: Eip155Provider): Eip155PageProvider => provider as unknown as Eip155PageProvider;

const restorePrototypeProperty = (property: string, prev: PropertyDescriptor | undefined) => {
  if (prev) {
    Object.defineProperty(Object.prototype, property, prev);
    return;
  }

  const proto = Object.prototype as unknown as Record<string, unknown>;
  delete proto[property];
};

describe("Eip155Provider: request() argument validation", () => {
  it.each([
    { label: "undefined", args: undefined, expectData: false },
    { label: "null", args: null, expectData: true },
    { label: "array", args: [], expectData: true },
    { label: "string", args: "foo", expectData: true },
  ])("rejects non-object args ($label)", async ({ args, expectData }) => {
    const { provider } = createProvider();

    const error = (await provider
      .request(args as unknown as Parameters<Eip155Provider["request"]>[0])
      .catch((err) => err)) as unknown;
    expect(error).toMatchObject({ code: -32600, message: REQUEST_VALIDATION_MESSAGES.invalidArgs });

    if (expectData) {
      expect(isRecord(error)).toBe(true);
      if (!isRecord(error)) throw new Error("Expected error to be an object");
      expect("data" in error).toBe(true);
      expect(error.data).toEqual(args);
    } else if (isRecord(error)) {
      expect("data" in error).toBe(false);
    }
  });

  it.each([
    { label: "missing method", args: {} },
    { label: "method null", args: { method: null } },
    { label: "method number", args: { method: 2 } },
    { label: "method empty string", args: { method: "" } },
  ])("rejects invalid args.method ($label)", async ({ args }) => {
    const { provider } = createProvider();
    const error = await provider
      .request(args as unknown as Parameters<Eip155Provider["request"]>[0])
      .catch((err) => err);
    expect(error).toMatchObject({ code: -32600, message: REQUEST_VALIDATION_MESSAGES.invalidMethod, data: args });
  });

  it.each([
    { label: "null", params: null },
    { label: "number", params: 2 },
    { label: "boolean", params: true },
    { label: "string", params: "a" },
  ])("rejects invalid args.params ($label)", async ({ params }) => {
    const { provider } = createProvider();
    const args = { method: "eth_call", params };
    const error = await provider
      .request(args as unknown as Parameters<Eip155Provider["request"]>[0])
      .catch((err) => err);
    expect(error).toMatchObject({ code: -32600, message: REQUEST_VALIDATION_MESSAGES.invalidParams, data: args });
  });
});

describe("Eip155Provider: request() state errors", () => {
  it("rejects when transport reports disconnected", async () => {
    const { transport, provider } = createProvider();

    transport.setRequestHandler(async () => {
      throw providerErrors.disconnected();
    });

    const error = (await provider.request({ method: "eth_blockNumber" }).catch((err) => err)) as unknown;
    expect(error).toMatchObject({ code: 4900 });
    if (isRecord(error)) {
      expect("data" in error).toBe(false);
    }
  });

  it("times out while waiting for initialization", async () => {
    vi.useFakeTimers();
    try {
      const { provider } = createProvider(
        {
          connected: false,
          chainId: null,
          chainRef: null,
          accounts: [],
          isUnlocked: null,
          meta: null,
        },
        { readyTimeoutMs: 10 },
      );

      const pending = provider.request({ method: "eth_blockNumber" });
      const assertion = expect(pending).rejects.toMatchObject({ code: 4900 });
      await vi.advanceTimersByTimeAsync(11);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces transport request timeout errors", async () => {
    const { transport, provider } = createProvider();

    transport.setRequestHandler(async () => {
      throw rpcErrors.internal({ message: "Request timed out" });
    });

    await expect(provider.request({ method: "eth_blockNumber" })).rejects.toMatchObject({
      code: -32603,
      message: "Request timed out",
    });
  });
});

describe("Eip155Provider: request timeout buckets", () => {
  it("uses the readonly timeout bucket for readonly methods", async () => {
    const { transport, provider } = createProvider(undefined, {
      requestTimeouts: {
        readonlyTimeoutMs: 1_000,
        normalTimeoutMs: 2_000,
        approvalTimeoutMs: 3_000,
      },
    });
    transport.setRequestHandler(async () => "0x1");
    const requestSpy = vi.spyOn(transport, "request");

    await provider.request({ method: "eth_getBalance", params: ["0xabc", "latest"] });

    expect(requestSpy).toHaveBeenCalledWith(
      { method: "eth_getBalance", params: ["0xabc", "latest"] },
      { timeoutMs: 1_000 },
    );
  });

  it("lets callers override approval method names", async () => {
    const { transport, provider } = createProvider(undefined, {
      requestTimeouts: {
        normalTimeoutMs: 2_000,
        approvalTimeoutMs: 3_000,
        approvalMethodNames: ["wallet_watchAsset"],
      },
    });
    transport.setRequestHandler(async () => null);
    const requestSpy = vi.spyOn(transport, "request");

    await provider.request({ method: "wallet_watchAsset" });

    expect(requestSpy).toHaveBeenCalledWith({ method: "wallet_watchAsset" }, { timeoutMs: 3_000 });
  });
});

describe("Eip155Provider: disconnect event semantics", () => {
  it("emits a recoverable disconnect error with stable {code,message} shape", () => {
    const { transport, provider } = createProvider();
    const disconnectListener = vi.fn();
    provider.on("disconnect", disconnectListener);

    transport.emit("disconnect");

    expect(disconnectListener).toHaveBeenCalledTimes(1);
    const [error] = disconnectListener.mock.calls[0] ?? [];
    expect(error).toMatchObject({ code: 4900 });
    expect(typeof error?.message).toBe("string");
  });
});

describe("Eip155Provider: state reset across transport disconnect", () => {
  it("clears cached chainId and accounts after disconnect", async () => {
    vi.useFakeTimers();
    try {
      const { transport, provider } = createProvider(
        {
          ...INITIAL_SNAPSHOT,
          chainId: "0x1",
          chainRef: "eip155:1",
          accounts: ["0xabc"],
        },
        { readyTimeoutMs: 10, ethAccountsWaitMs: 0 },
      );

      await provider.request({ method: "eth_chainId" });
      transport.setBootstrapHandler(
        async () =>
          await new Promise<ProviderSnapshot>(() => {
            // keep bootstrap pending so the provider cannot restore session state immediately
          }),
      );
      transport.emit("disconnect");

      expect(provider.chainId).toBeNull();
      expect(provider.selectedAddress).toBeNull();

      const pendingChainId = provider.request({ method: "eth_chainId" });
      const pendingAccounts = provider.request({ method: "eth_accounts" });

      const accountsAssertion = expect(pendingAccounts).resolves.toEqual([]);
      await vi.advanceTimersByTimeAsync(0);
      await accountsAssertion;

      const assertion = expect(pendingChainId).rejects.toMatchObject({ code: 4900 });
      await vi.advanceTimersByTimeAsync(11);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Eip155Provider: standard and legacy events", () => {
  it("emits connect once bootstrap resolves", async () => {
    const { transport, provider } = createProvider(
      {
        connected: false,
        chainId: null,
        chainRef: null,
        accounts: [],
        isUnlocked: null,
        meta: null,
      },
      { readyTimeoutMs: 2000 },
    );
    const connectListener = vi.fn();
    provider.on("connect", connectListener);

    transport.setBootstrapHandler(async () => ({
      connected: true,
      chainId: "0x1",
      chainRef: "eip155:1",
      accounts: [],
      isUnlocked: true,
      meta: buildMeta(),
    }));
    transport.setRequestHandler(async () => "0x10");

    await provider.request({ method: "eth_blockNumber" });

    expect(connectListener).toHaveBeenCalledTimes(1);
    expect(connectListener).toHaveBeenCalledWith({ chainId: "0x1" });
  });

  it("emits accountsChanged and updates eth_accounts cache from transport patches", async () => {
    const { transport, provider } = createProvider();
    const listener = vi.fn();
    provider.on("accountsChanged", listener);

    await provider.request({ method: "eth_chainId" });
    listener.mockClear();
    transport.emit("patch", { type: "accounts", accounts: ["0xabc", "0xdef"] });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(["0xabc", "0xdef"]);
    expect(provider.selectedAddress).toBe("0xabc");
    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual(["0xabc", "0xdef"]);
  });

  it("emits chainChanged and keeps eth_chainId consistent", async () => {
    const { transport, provider } = createProvider();
    const chainChanged = vi.fn();
    provider.on("chainChanged", chainChanged);

    await provider.request({ method: "eth_chainId" });
    transport.emit("patch", {
      type: "chain",
      chainId: "0x89",
      chainRef: "eip155:137",
      meta: buildMeta({
        activeChainByNamespace: { eip155: "eip155:137" },
        supportedChains: ["eip155:1", "eip155:137"],
      }),
    });

    expect(chainChanged).toHaveBeenCalledTimes(1);
    expect(chainChanged).toHaveBeenCalledWith("0x89");
    await expect(provider.request({ method: "eth_chainId" })).resolves.toBe("0x89");
  });

  it("emits _initialized, networkChanged, and unlockStateChanged for legacy compatibility", async () => {
    const { transport, provider } = createProvider();
    const initialized = vi.fn();
    const networkChanged = vi.fn();
    const unlockStateChanged = vi.fn();

    provider.on("_initialized", initialized);
    provider.on("networkChanged", networkChanged);
    provider.on("unlockStateChanged", unlockStateChanged);

    await provider.request({ method: "eth_chainId" });
    transport.emit("patch", {
      type: "chain",
      chainId: "0x89",
      chainRef: "eip155:137",
      meta: buildMeta({ activeChainByNamespace: { eip155: "eip155:137" } }),
    });
    transport.emit("patch", { type: "unlock", isUnlocked: false });

    expect(provider.isConnected()).toBe(true);
    expect(await provider._metamask.isUnlocked()).toBe(false);
    expect(initialized).toHaveBeenCalledTimes(1);
    expect(networkChanged).toHaveBeenCalledWith("137");
    expect(unlockStateChanged).toHaveBeenCalledWith({ isUnlocked: false });
  });
});

describe("Eip155Provider: canonical state ownership", () => {
  it("does not treat eth_requestAccounts return value as canonical state without a patch", async () => {
    const { transport, provider } = createProvider({ ...INITIAL_SNAPSHOT, accounts: [] });

    transport.setRequestHandler(async ({ method }) => {
      if (method === "eth_requestAccounts") {
        return ["0xabc"];
      }
      throw new Error(`unexpected method ${method}`);
    });

    await expect(provider.request({ method: "eth_requestAccounts" })).resolves.toEqual(["0xabc"]);
    expect(provider.selectedAddress).toBeNull();
    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual([]);

    transport.emit("patch", { type: "accounts", accounts: ["0xabc"] });

    expect(provider.selectedAddress).toBe("0xabc");
    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual(["0xabc"]);
  });
});

describe("Eip155Provider: public API hardening", () => {
  it("exposes isMetaMask, _metamask, and readonly legacy fields", async () => {
    const { provider } = createProvider();
    const pageProvider = asPageProvider(provider);

    await pageProvider.request({ method: "eth_chainId" });

    expect(pageProvider.isMetaMask).toBe(true);
    expect(await pageProvider._metamask.isUnlocked()).toBe(true);
    expect(pageProvider.selectedAddress).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(pageProvider.chainId).toBe("0x1");
    expect(pageProvider.networkVersion).toBe("1");

    expect(Object.getOwnPropertyDescriptor(pageProvider, "selectedAddress")).toMatchObject({
      configurable: false,
      enumerable: true,
    });
    expect(Object.getOwnPropertyDescriptor(pageProvider, "chainId")).toMatchObject({
      configurable: false,
      enumerable: true,
    });
    expect(Object.getOwnPropertyDescriptor(pageProvider, "networkVersion")).toMatchObject({
      configurable: false,
      enumerable: true,
    });
    expect(Object.getOwnPropertyDescriptor(pageProvider, "isMetaMask")).toMatchObject({
      configurable: false,
      enumerable: true,
      value: true,
      writable: false,
    });
    expect(Object.getOwnPropertyDescriptor(pageProvider, "_metamask")).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
    });
  });

  it("keeps legacy readonly fields in sync with provider state", async () => {
    const { transport, provider } = createProvider();
    const pageProvider = asPageProvider(provider);

    await pageProvider.request({ method: "eth_chainId" });

    transport.emit("patch", { type: "accounts", accounts: ["0xabc"] });
    expect(pageProvider.selectedAddress).toBe("0xabc");

    transport.emit("patch", {
      type: "chain",
      chainId: "0x89",
      chainRef: "eip155:137",
      meta: buildMeta({
        activeChainByNamespace: { eip155: "eip155:137" },
        supportedChains: ["eip155:1", "eip155:137"],
      }),
    });
    expect(pageProvider.chainId).toBe("0x89");
    expect(pageProvider.networkVersion).toBe("137");
  });

  it("reports injected properties through the in operator", () => {
    const pageProvider = asPageProvider(createProvider().provider);

    expect("chainId" in pageProvider).toBe(true);
    expect("networkVersion" in pageProvider).toBe(true);
    expect("selectedAddress" in pageProvider).toBe(true);
    expect("isMetaMask" in pageProvider).toBe(true);
    expect("_metamask" in pageProvider).toBe(true);
  });

  it.each(PROTECTED_KEYS)("rejects mutation attempts for %s", (key) => {
    const pageProvider = asPageProvider(createProvider().provider);

    expect(() => {
      pageProvider[key] = "evil";
    }).toThrow(TypeError);
    expect(() => Object.defineProperty(pageProvider, key, { value: "evil" })).toThrow(TypeError);
    expect(() => {
      delete pageProvider[key];
    }).toThrow(TypeError);
  });

  it("protects wallet permission helpers from dapp overrides", async () => {
    const { transport, provider } = createProvider();
    const pageProvider = asPageProvider(provider);
    const handler = vi.fn(async ({ method }: RequestArguments) => {
      if (method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
      if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
      throw new Error(`unexpected method ${method}`);
    });
    transport.setRequestHandler(handler);

    const attemptedOverride = vi.fn(async () => "evil");
    expect(() => {
      pageProvider.wallet_getPermissions = attemptedOverride;
    }).toThrow(TypeError);
    expect(() => {
      pageProvider.wallet_requestPermissions = attemptedOverride;
    }).toThrow(TypeError);

    await expect(pageProvider.wallet_getPermissions()).resolves.toEqual([{ parentCapability: "eth_accounts" }]);
    await expect(pageProvider.wallet_requestPermissions([{ eth_accounts: {} }])).resolves.toEqual([
      { parentCapability: "eth_accounts" },
    ]);

    expect(attemptedOverride).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({ method: "wallet_getPermissions" });
    expect(handler).toHaveBeenCalledWith({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  });

  it("ignores Object.prototype pollution for injected shims", async () => {
    const pageProvider = asPageProvider(createProvider().provider);
    const prevIsMetaMask = Object.getOwnPropertyDescriptor(Object.prototype, "isMetaMask");
    const prevMetamask = Object.getOwnPropertyDescriptor(Object.prototype, "_metamask");

    try {
      await pageProvider.request({ method: "eth_chainId" });

      Object.defineProperty(Object.prototype, "isMetaMask", {
        configurable: true,
        get: () => {
          throw new Error("polluted isMetaMask getter should not run");
        },
      });
      Object.defineProperty(Object.prototype, "_metamask", {
        configurable: true,
        get: () => {
          throw new Error("polluted _metamask getter should not run");
        },
      });

      expect(pageProvider.isMetaMask).toBe(true);
      expect(await pageProvider._metamask.isUnlocked()).toBe(true);
    } finally {
      restorePrototypeProperty("isMetaMask", prevIsMetaMask);
      restorePrototypeProperty("_metamask", prevMetamask);
    }
  });

  it("ignores Object.prototype pollution for bound provider methods", () => {
    const pageProvider = asPageProvider(createProvider().provider);
    const methodKeys = ["request", "send", "sendAsync", "on", "removeListener", "removeAllListeners"] as const;
    const prev = Object.fromEntries(
      methodKeys.map((key) => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]),
    ) as Record<(typeof methodKeys)[number], PropertyDescriptor | undefined>;

    try {
      for (const key of methodKeys) {
        Object.defineProperty(Object.prototype, key, {
          configurable: true,
          get: () => {
            throw new Error(`polluted ${key} getter should not run`);
          },
        });
      }

      expect(typeof pageProvider.request).toBe("function");
      expect(typeof pageProvider.send).toBe("function");
      expect(typeof pageProvider.sendAsync).toBe("function");
      expect(typeof pageProvider.on).toBe("function");
      expect(typeof pageProvider.removeListener).toBe("function");
      expect(typeof pageProvider.removeAllListeners).toBe("function");
    } finally {
      for (const key of methodKeys) {
        restorePrototypeProperty(key, prev[key]);
      }
    }
  });
});

describe("Eip155Provider: error normalization", () => {
  it("wraps unknown upstream errors into a JSON-RPC internal error", async () => {
    const { transport, provider } = createProvider();

    transport.setRequestHandler(async () => {
      throw new Error("upstream failure");
    });

    await expect(provider.request({ method: "eth_blockNumber" })).rejects.toMatchObject({
      code: -32603,
      message: "upstream failure",
      data: { originalError: expect.objectContaining({ message: "upstream failure" }) },
    });
  });
});
