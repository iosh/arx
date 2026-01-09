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

const PROTECTED_KEYS = [
  "request",
  "send",
  "sendAsync",
  "on",
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

describe("createEip155InjectedProvider", () => {
  const createInjected = (initialState: TransportState = INITIAL_STATE) => {
    const transport = new StubTransport(initialState);
    const raw = new Eip155Provider({ transport });
    const injected = createEip155InjectedProvider(raw) as any;
    return { transport, raw, injected };
  };

  const restorePrototypeProperty = (property: string, prev: PropertyDescriptor | undefined) => {
    if (prev) {
      Object.defineProperty(Object.prototype, property, prev);
      return;
    }

    delete (Object.prototype as any)[property];
  };

  describe("compatibility shims", () => {
    it("exposes isMetaMask/_metamask and legacy read-only fields", async () => {
      const { injected } = createInjected();

      expect(injected.isMetaMask).toBe(true);
      expect(await injected._metamask.isUnlocked()).toBe(true);

      expect(injected.selectedAddress).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(injected.chainId).toBe("0x1");
      expect(injected.networkVersion).toBe("1");

      expect(Object.getOwnPropertyDescriptor(injected, "selectedAddress")).toMatchObject({
        configurable: true,
        enumerable: true,
      });
      expect(Object.getOwnPropertyDescriptor(injected, "chainId")).toMatchObject({
        configurable: true,
        enumerable: true,
      });
      expect(Object.getOwnPropertyDescriptor(injected, "networkVersion")).toMatchObject({
        configurable: true,
        enumerable: true,
      });

      expect(Object.getOwnPropertyDescriptor(injected, "isMetaMask")).toMatchObject({
        configurable: true,
        enumerable: true,
        value: true,
        writable: false,
      });
      expect(Object.getOwnPropertyDescriptor(injected, "_metamask")).toMatchObject({
        configurable: true,
        enumerable: false,
        writable: false,
      });
    });

    it("keeps selectedAddress/chainId/networkVersion in sync with provider state", () => {
      const { transport, injected } = createInjected();

      transport.emit("accountsChanged", ["0xabc"]);
      expect(injected.selectedAddress).toBe("0xabc");

      transport.emit("chainChanged", {
        chainId: "0x89",
        caip2: "eip155:137",
        meta: buildMeta({ activeChain: "eip155:137", supportedChains: ["eip155:1", "eip155:137"] }),
      });
      expect(injected.chainId).toBe("0x89");
      expect(injected.networkVersion).toBe("137");
    });

    it("reports injected properties via the `in` operator (feature detection)", () => {
      const { injected } = createInjected();

      // dApps frequently use `in` for feature detection and compatibility checks.
      expect("chainId" in injected).toBe(true);
      expect("networkVersion" in injected).toBe(true);
      expect("selectedAddress" in injected).toBe(true);
      expect("isMetaMask" in injected).toBe(true);
      expect("_metamask" in injected).toBe(true);
    });
  });

  describe("hardening against dapp-side mutation", () => {
    it.each(PROTECTED_KEYS)("rejects mutation attempts for %s (read-only)", (key) => {
      const { injected } = createInjected();

      expect(() => {
        injected[key] = "evil";
      }).toThrow(TypeError);
      expect(() => Object.defineProperty(injected, key, { value: "evil" })).toThrow(TypeError);
      expect(() => {
        delete injected[key];
      }).toThrow(TypeError);
    });

    it("protects wallet_getPermissions and wallet_requestPermissions from dapp overrides (injected helpers)", async () => {
      const { transport, injected } = createInjected();

      // These methods are injected by the Proxy (they are not part of the provider's own API surface).
      // Verify they cannot be overridden and still route correctly through request().
      const handler = vi.fn(async ({ method }: RequestArguments) => {
        if (method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
        throw new Error(`unexpected method ${method}`);
      });
      transport.setRequestHandler(handler);

      const attemptedOverride = vi.fn(async () => "evil");
      expect(() => {
        injected.wallet_getPermissions = attemptedOverride;
      }).toThrow(TypeError);
      expect(() => {
        injected.wallet_requestPermissions = attemptedOverride;
      }).toThrow(TypeError);

      await expect(injected.wallet_getPermissions()).resolves.toEqual([{ parentCapability: "eth_accounts" }]);
      await expect(injected.wallet_requestPermissions([{ eth_accounts: {} }])).resolves.toEqual([
        { parentCapability: "eth_accounts" },
      ]);

      expect(attemptedOverride).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith({ method: "wallet_getPermissions" });
      expect(handler).toHaveBeenCalledWith({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    });
  });

  describe("hardening against prototype pollution", () => {
    it("ignores Object.prototype pollution for injected shims", async () => {
      const { injected } = createInjected();

      const prevIsMetaMask = Object.getOwnPropertyDescriptor(Object.prototype, "isMetaMask");
      const prevMetamask = Object.getOwnPropertyDescriptor(Object.prototype, "_metamask");

      try {
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

        expect(injected.isMetaMask).toBe(true);
        expect(await injected._metamask.isUnlocked()).toBe(true);
      } finally {
        restorePrototypeProperty("isMetaMask", prevIsMetaMask);
        restorePrototypeProperty("_metamask", prevMetamask);
      }
    });

    it("ignores Object.prototype pollution for core provider methods", () => {
      const { injected } = createInjected();

      const coreKeys = ["request", "send", "sendAsync", "on", "removeListener", "removeAllListeners"] as const;
      const prev = Object.fromEntries(
        coreKeys.map((key) => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]),
      ) as Record<(typeof coreKeys)[number], PropertyDescriptor | undefined>;

      try {
        for (const key of coreKeys) {
          Object.defineProperty(Object.prototype, key, {
            configurable: true,
            get: () => {
              throw new Error(`polluted ${key} getter should not run`);
            },
          });
        }

        expect(typeof injected.request).toBe("function");
        expect(typeof injected.send).toBe("function");
        expect(typeof injected.sendAsync).toBe("function");
        expect(typeof injected.on).toBe("function");
        expect(typeof injected.removeListener).toBe("function");
        expect(typeof injected.removeAllListeners).toBe("function");
      } finally {
        for (const key of coreKeys) {
          restorePrototypeProperty(key, prev[key]);
        }
      }
    });
  });
});
