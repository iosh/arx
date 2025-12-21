import {
  evmProviderErrors,
  evmRpcErrors,
  registerChainErrorFactory,
  unregisterChainErrorFactory,
} from "@arx/core/errors";
import { EventEmitter } from "eventemitter3";
import { describe, expect, it, vi } from "vitest";
import { EthereumProvider } from "./provider.js";
import type { RequestArguments } from "./types/eip1193.js";
import type { Transport, TransportMeta, TransportState } from "./types/transport.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type RequestHandler = (args: RequestArguments) => Promise<unknown>;
const unimplemented: RequestHandler = async ({ method }) => {
  throw new Error(
    `StubTransport: request handler not implemented for method "${method}". ` +
      `Use transport.setRequestHandler() to mock this method.`,
  );
};

class StubTransport extends EventEmitter implements Transport {
  #state: TransportState;
  #requestHandler: RequestHandler = unimplemented;
  #requests: RequestArguments[] = [];

  constructor(initial: TransportState) {
    super();
    this.#state = clone(initial);
  }

  connect = async () => {};

  disconnect = async () => {};

  isConnected = () => {
    return this.#state.connected;
  };

  getConnectionState(): TransportState {
    return clone(this.#state);
  }

  request = async (args: RequestArguments, _options?: { timeoutMs?: number }) => {
    this.#requests.push(args);
    return this.#requestHandler(args);
  };

  updateState(state: Partial<TransportState>) {
    this.#state = { ...this.#state, ...state };
  }

  setRequestHandler(handler: RequestHandler) {
    this.#requestHandler = handler;
  }

  getRequests() {
    return [...this.#requests];
  }

  clearRequests() {
    this.#requests = [];
  }
}

const buildMeta = (overrides?: Partial<TransportMeta>): TransportMeta => ({
  activeChain: "eip155:1",
  activeNamespace: "eip155",
  supportedChains: ["eip155:1"],
  ...overrides,
});

const createProvider = (initialState: TransportState = INITIAL_STATE) => {
  const transport = new StubTransport(initialState);
  const provider = new EthereumProvider({ transport });
  return { transport, provider };
};

const setupConfluxErrorFactory = () => {
  const rpcFactory = { ...evmRpcErrors };
  const providerFactory = { ...evmProviderErrors };
  const internalSpy = vi.spyOn(rpcFactory, "internal");
  const disconnectedSpy = vi.spyOn(providerFactory, "disconnected");

  registerChainErrorFactory("conflux", {
    rpc: rpcFactory,
    provider: providerFactory,
  });

  const cleanup = () => {
    unregisterChainErrorFactory("conflux");
    internalSpy.mockRestore();
    disconnectedSpy.mockRestore();
  };

  return {
    rpcFactory,
    providerFactory,
    internalSpy,
    disconnectedSpy,
    cleanup,
  };
};

const INITIAL_STATE: TransportState = {
  connected: true,
  chainId: "0x1",
  caip2: null,
  accounts: [],
  isUnlocked: true,
  meta: buildMeta(),
};

describe("EthereumProvider transport meta integration", () => {
  it("falls back to transport meta when caip2 is missing", () => {
    const transport = new StubTransport(INITIAL_STATE);
    const provider = new EthereumProvider({ transport });

    expect(provider.caip2).toBe("eip155:1");

    transport.emit("disconnect");
    expect(provider.caip2).toBeNull();
  });

  it("updates namespace when chainChanged event carries meta", () => {
    const transport = new StubTransport(INITIAL_STATE);
    const provider = new EthereumProvider({ transport });

    expect(provider.caip2).toBe("eip155:1");

    const confluxMeta = buildMeta({
      activeChain: "conflux:cfx",
      activeNamespace: "conflux",
      supportedChains: ["conflux:cfx"],
    });

    transport.emit("chainChanged", {
      chainId: "0x406",
      caip2: null,
      meta: confluxMeta,
    });

    expect(provider.caip2).toBe("conflux:cfx");

    transport.emit("chainChanged", {
      chainId: "0x1",
      caip2: "eip155:1",
      meta: buildMeta(),
    });

    expect(provider.caip2).toBe("eip155:1");
  });

  it("falls back to metaChanged activeChain when chainChanged lacks caip2", () => {
    const { transport, provider } = createProvider();
    const confluxMeta = buildMeta({
      activeChain: "conflux:cfx",
      activeNamespace: "conflux",
      supportedChains: ["conflux:cfx"],
    });

    transport.emit("metaChanged", confluxMeta);
    transport.emit("chainChanged", {
      chainId: "0x406",
      caip2: null,
    });

    expect(provider.chainId).toBe("0x406");
    expect(provider.caip2).toBe("conflux:cfx");
  });

  it("updates account cache after eth_requestAccounts resolves", async () => {
    const { transport, provider } = createProvider();
    const accountsChanged = vi.fn();
    provider.on("accountsChanged", accountsChanged);

    transport.setRequestHandler(async (args) => {
      expect(args.method).toBe("eth_requestAccounts");
      return ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];
    });

    const result = await provider.request({ method: "eth_requestAccounts" });

    expect(result).toEqual([
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);
    expect(provider.selectedAddress).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(accountsChanged).toHaveBeenCalledTimes(1);
    expect(accountsChanged).toHaveBeenCalledWith([
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);
    expect(transport.getRequests()).toHaveLength(1);
    expect(transport.getRequests()[0]?.method).toBe("eth_requestAccounts");
  });

  it("emits accountsChanged when connect snapshot clears accounts", () => {
    const initialState: TransportState = {
      ...INITIAL_STATE,
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      caip2: "eip155:1",
    };

    const { transport, provider } = createProvider(initialState);
    const accountsChanged = vi.fn();
    provider.on("accountsChanged", accountsChanged);

    transport.emit("connect", {
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: [],
      isUnlocked: true,
      meta: buildMeta(),
    });

    expect(provider.selectedAddress).toBeNull();
    expect(accountsChanged).toHaveBeenCalledTimes(1);
    expect(accountsChanged).toHaveBeenCalledWith([]);
  });

  it("emits chainChanged with updated CAIP-2 after wallet_switchEthereumChain", async () => {
    const initialState: TransportState = {
      ...INITIAL_STATE,
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: ["0x1111111111111111111111111111111111111111"],
    };

    const { transport, provider } = createProvider(initialState);
    const chainChanged = vi.fn();
    const accountsChanged = vi.fn();
    provider.on("chainChanged", chainChanged);
    provider.on("accountsChanged", accountsChanged);

    transport.setRequestHandler(async (args) => {
      expect(args.method).toBe("wallet_switchEthereumChain");
      expect(args.params).toEqual([{ chainId: "0x89" }]);
      return null;
    });

    const request = provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x89" }],
    });

    transport.emit("chainChanged", {
      chainId: "0x89",
      caip2: "eip155:137",
      meta: buildMeta({
        activeChain: "eip155:137",
        supportedChains: ["eip155:1", "eip155:137"],
      }),
    });

    await expect(request).resolves.toBeNull();

    expect(provider.chainId).toBe("0x89");
    expect(provider.caip2).toBe("eip155:137");
    expect(provider.selectedAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(chainChanged).toHaveBeenCalledTimes(1);
    expect(chainChanged).toHaveBeenCalledWith("0x89");
    expect(accountsChanged).not.toHaveBeenCalled();
    expect(transport.getRequests()).toHaveLength(1);
  });

  it("relays unlockStateChanged notifications", () => {
    const initialState: TransportState = {
      ...INITIAL_STATE,
      isUnlocked: true,
    };

    const { transport, provider } = createProvider(initialState);
    const unlockListener = vi.fn();
    provider.on("unlockStateChanged", unlockListener);

    transport.emit("unlockStateChanged", { isUnlocked: false });
    expect(provider.isUnlocked).toBe(false);
    expect(unlockListener).toHaveBeenCalledTimes(1);
    expect(unlockListener).toHaveBeenCalledWith({ isUnlocked: false });

    transport.emit("unlockStateChanged", { isUnlocked: true });
    expect(provider.isUnlocked).toBe(true);
    expect(unlockListener).toHaveBeenCalledTimes(2);
  });

  it("clears cached state and emits disconnect error on transport disconnect", () => {
    const initialState: TransportState = {
      connected: true,
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: ["0x1111111111111111111111111111111111111111"],
      isUnlocked: true,
      meta: buildMeta(),
    };

    const { transport, provider } = createProvider(initialState);
    const disconnectListener = vi.fn();
    provider.on("disconnect", disconnectListener);

    transport.emit("disconnect");

    expect(provider.chainId).toBeNull();
    expect(provider.caip2).toBeNull();
    expect(provider.selectedAddress).toBeNull();
    expect(provider.isUnlocked).toBeNull();
    expect(disconnectListener).toHaveBeenCalledTimes(1);

    const [error] = disconnectListener.mock.calls[0] ?? [];
    expect(error).toMatchObject({ code: 4900 });
  });

  it("handles wallet_addEthereumChain without mutating active state until chainChanged", async () => {
    const initialState: TransportState = {
      ...INITIAL_STATE,
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: ["0x1111111111111111111111111111111111111111"],
      meta: buildMeta({ supportedChains: ["eip155:1"] }),
    };

    const { transport, provider } = createProvider(initialState);
    const chainChanged = vi.fn();
    provider.on("chainChanged", chainChanged);

    transport.setRequestHandler(async (args) => {
      expect(args.method).toBe("wallet_addEthereumChain");
      expect(args.params).toEqual([
        {
          chainId: "0x89",
          rpcUrls: ["https://polygon.example"],
          chainName: "Polygon",
        },
      ]);
      return null;
    });

    await expect(
      provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x89",
            rpcUrls: ["https://polygon.example"],
            chainName: "Polygon",
          },
        ],
      }),
    ).resolves.toBeNull();

    expect(provider.chainId).toBe("0x1");
    expect(provider.caip2).toBe("eip155:1");
    expect(provider.selectedAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(chainChanged).not.toHaveBeenCalled();

    // 0x89(137) === eip155:137
    transport.emit(
      "metaChanged",
      buildMeta({
        activeChain: "eip155:137",
        supportedChains: ["eip155:1", "eip155:137"],
      }),
    );

    transport.emit("chainChanged", {
      chainId: "0x89",
      caip2: null,
    });

    expect(provider.chainId).toBe("0x89");
    expect(provider.caip2).toBe("eip155:137");
  });

  it("uses Conflux error factories after namespace switch", async () => {
    const { internalSpy, disconnectedSpy, cleanup } = setupConfluxErrorFactory();

    try {
      const initialState: TransportState = {
        ...INITIAL_STATE,
        chainId: "0x1",
        caip2: "eip155:1",
        meta: buildMeta(),
      };

      const { transport, provider } = createProvider(initialState);

      transport.emit("chainChanged", {
        chainId: "0x406",
        caip2: "conflux:cfx",
      });

      transport.setRequestHandler(async () => {
        throw new Error("upstream failure");
      });

      await expect(provider.request({ method: "eth_chainId" })).rejects.toMatchObject({
        code: -32603,
        data: {
          originalError: expect.objectContaining({ message: "upstream failure" }),
        },
      });

      expect(internalSpy).toHaveBeenCalledTimes(1);

      transport.emit("disconnect");
      expect(disconnectedSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("waits for initialization before forwarding non-readonly requests", async () => {
    const initial = { ...INITIAL_STATE, connected: false, chainId: null, caip2: null };
    const { transport, provider } = createProvider(initial);
    const handler = vi.fn(async () => "ok");
    transport.setRequestHandler(handler);

    const connectSpy = vi.spyOn(transport, "connect");

    const p = provider.request({ method: "eth_blockNumber" });
    expect(handler).not.toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    transport.updateState({ connected: true, chainId: "0x1", caip2: "eip155:1", meta: buildMeta() });
    transport.emit("connect", { chainId: "0x1", caip2: "eip155:1", accounts: [], isUnlocked: true, meta: buildMeta() });

    await expect(p).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("times out non-readonly requests when initialization never completes", async () => {
    vi.useFakeTimers();

    try {
      const initial = { ...INITIAL_STATE, connected: false, chainId: null, caip2: null };
      const { transport, provider } = createProvider(initial);

      const connectSpy = vi.spyOn(transport, "connect");
      const handler = vi.fn(async () => "ok");
      transport.setRequestHandler(handler);

      const pending = provider.request({ method: "eth_blockNumber" });
      const assertion = expect(pending).rejects.toMatchObject({ code: 4900 });

      await vi.runAllTimersAsync();

      await assertion;
      expect(handler).not.toHaveBeenCalled();
      expect(connectSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects wallet_switchEthereumChain when transport throws provider error", async () => {
    const { transport, provider } = createProvider();

    transport.setRequestHandler(async (args) => {
      expect(args.method).toBe("wallet_switchEthereumChain");
      throw evmProviderErrors.chainDisconnected({ message: "Chain 0x999 not found" });
    });

    await expect(
      provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x999" }],
      }),
    ).rejects.toMatchObject({
      code: 4901,
      message: expect.stringContaining("not found"),
    });
  });

  it("rejects wallet_switchEthereumChain when provider is locked", async () => {
    const initialState: TransportState = {
      ...INITIAL_STATE,
      isUnlocked: false,
    };

    const { transport, provider } = createProvider(initialState);

    transport.setRequestHandler(async () => {
      throw evmProviderErrors.unauthorized({ message: "Wallet is locked" });
    });

    await expect(
      provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x89" }],
      }),
    ).rejects.toMatchObject({
      code: 4100,
      message: expect.stringContaining("locked"),
    });
  });

  it("preserves accounts across namespace switches until backend updates them", () => {
    const initialState: TransportState = {
      ...INITIAL_STATE,
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    };

    const { transport, provider } = createProvider(initialState);
    const accountsChanged = vi.fn();
    provider.on("accountsChanged", accountsChanged);

    transport.emit("chainChanged", {
      chainId: "0x406",
      caip2: "conflux:cfx",
      meta: buildMeta({
        activeChain: "conflux:cfx",
        activeNamespace: "conflux",
        supportedChains: ["eip155:1", "conflux:cfx"],
      }),
    });

    expect(provider.chainId).toBe("0x406");
    expect(provider.caip2).toBe("conflux:cfx");
    expect(provider.selectedAddress).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(accountsChanged).not.toHaveBeenCalled();

    transport.emit("accountsChanged", ["cfx:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaaj4dpcs07"]);
    expect(provider.selectedAddress).toBe("cfx:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaaj4dpcs07");
    expect(accountsChanged).toHaveBeenCalledTimes(1);
  });

  it("returns cached chainId without init; accounts stay empty before init", async () => {
    const initial: TransportState = {
      connected: false,
      chainId: "0x1",
      caip2: null,
      accounts: ["0xabc"],
      isUnlocked: null,
      meta: buildMeta(),
    };
    const { provider } = createProvider(initial);

    await expect(provider.request({ method: "eth_chainId" })).resolves.toBe("0x1");
    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual([]);
  });

  it("eth_chainId throws 4900 when not connected and no cache; eth_accounts returns []", async () => {
    const initial: TransportState = {
      connected: false,
      chainId: null,
      caip2: null,
      accounts: [],
      isUnlocked: null,
      meta: null,
    };
    const { provider } = createProvider(initial);

    vi.useFakeTimers();
    try {
      const chainIdPromise = provider.request({ method: "eth_chainId" });
      const chainIdAssertion = expect(chainIdPromise).rejects.toMatchObject({ code: 4900 });
      await vi.advanceTimersByTimeAsync(5_001);
      await chainIdAssertion;

      await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("returns provider snapshot for metamask_getProviderState without transport roundtrip", async () => {
    const { transport, provider } = createProvider();
    transport.emit("accountsChanged", ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    transport.emit("chainChanged", { chainId: "0x2", caip2: "eip155:2" });

    await expect(provider.request({ method: "metamask_getProviderState" })).resolves.toEqual({
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      chainId: "0x2",
      networkVersion: "2",
      isUnlocked: true,
    });
    expect(transport.getRequests()).toHaveLength(0);
  });

  it("derives networkVersion from CAIP-2 when chainId is null", async () => {
    const initialState: TransportState = { ...INITIAL_STATE, chainId: null, caip2: "eip155:10" };
    const { provider } = createProvider(initialState);

    await expect(provider.request({ method: "metamask_getProviderState" })).resolves.toMatchObject({
      networkVersion: "10",
    });
  });

  it("supports wallet_getProviderState alias", async () => {
    const { provider } = createProvider();

    await expect(provider.request({ method: "wallet_getProviderState" })).resolves.toMatchObject({ chainId: "0x1" });
  });
});
