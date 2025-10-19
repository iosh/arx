import { EventEmitter } from "eventemitter3";
import { describe, expect, it } from "vitest";
import { EthereumProvider } from "./provider.js";
import type { Transport, TransportMeta, TransportState } from "./types/transport.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class StubTransport extends EventEmitter implements Transport {
  #state: TransportState;

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

  request = async () => {
    throw new Error("not implemented in stub");
  };

  updateState(state: Partial<TransportState>) {
    this.#state = { ...this.#state, ...state };
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
});
