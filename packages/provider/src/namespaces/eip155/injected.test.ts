import { EventEmitter } from "eventemitter3";
import { describe, expect, it, vi } from "vitest";
import type { RequestArguments } from "../../types/eip1193.js";
import type { Transport, TransportMeta, TransportState } from "../../types/transport.js";
import { createEip155InjectedProvider } from "./injected.js";
import { Eip155Provider } from "./provider.js";

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
    return this.#requestHandler(args);
  };

  setRequestHandler(handler: RequestHandler) {
    this.#requestHandler = handler;
  }
}

const buildMeta = (overrides?: Partial<TransportMeta>): TransportMeta => ({
  activeChain: "eip155:1",
  activeNamespace: "eip155",
  supportedChains: ["eip155:1"],
  ...overrides,
});

const INITIAL_STATE: TransportState = {
  connected: true,
  chainId: "0x1",
  caip2: "eip155:1",
  accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  isUnlocked: true,
  meta: buildMeta(),
};

describe("createEip155InjectedProvider hardening", () => {
  it("exposes MetaMask compatibility shims and blocks mutation", async () => {
    const transport = new StubTransport(INITIAL_STATE);
    const raw = new Eip155Provider({ transport });
    const injected = createEip155InjectedProvider(raw) as any;

    expect(injected.isMetaMask).toBe(true);
    expect(await injected._metamask.isUnlocked()).toBe(true);

    const isMetaMaskDesc = Object.getOwnPropertyDescriptor(injected, "isMetaMask");
    expect(isMetaMaskDesc).toMatchObject({ enumerable: true, value: true, writable: false });

    const metamaskDesc = Object.getOwnPropertyDescriptor(injected, "_metamask");
    expect(metamaskDesc).toMatchObject({ enumerable: false, writable: false });

    injected.isMetaMask = false;
    expect(injected.isMetaMask).toBe(true);

    Object.defineProperty(injected, "isMetaMask", { value: false });
    expect(injected.isMetaMask).toBe(true);

    delete injected.isMetaMask;
    expect(injected.isMetaMask).toBe(true);
  });

  it("protects wallet_getPermissions and wallet_requestPermissions from dapp overrides", async () => {
    const transport = new StubTransport(INITIAL_STATE);
    const raw = new Eip155Provider({ transport });
    const injected = createEip155InjectedProvider(raw) as any;

    const handler = vi.fn(async ({ method }: RequestArguments) => {
      if (method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
      if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
      throw new Error(`unexpected method ${method}`);
    });
    transport.setRequestHandler(handler);

    const evil = vi.fn(async () => "evil");
    injected.wallet_getPermissions = evil;
    injected.wallet_requestPermissions = evil;

    await expect(injected.wallet_getPermissions()).resolves.toEqual([{ parentCapability: "eth_accounts" }]);
    await expect(injected.wallet_requestPermissions([{ eth_accounts: {} }])).resolves.toEqual([
      { parentCapability: "eth_accounts" },
    ]);

    expect(evil).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({ method: "wallet_getPermissions" });
    expect(handler).toHaveBeenCalledWith({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  });

  it("reports injected properties via the `in` operator", () => {
    const transport = new StubTransport(INITIAL_STATE);
    const raw = new Eip155Provider({ transport });
    const injected = createEip155InjectedProvider(raw) as any;

    expect("chainId" in injected).toBe(true);
    expect("networkVersion" in injected).toBe(true);
    expect("selectedAddress" in injected).toBe(true);
    expect("isMetaMask" in injected).toBe(true);
    expect("_metamask" in injected).toBe(true);
  });
});
