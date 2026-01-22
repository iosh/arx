import { describe, expect, it, vi } from "vitest";
import { evmProviderErrors, evmRpcErrors } from "../../errors.js";
import { Eip155Provider } from "../../provider/index.js";
import type { RequestArguments } from "../../types/eip1193.js";
import type { TransportMeta, TransportState } from "../../types/transport.js";
import { DISCONNECT_EVENT_CODE, DISCONNECT_EVENT_MESSAGE, REQUEST_VALIDATION_MESSAGES } from "./constants.js";
import { buildMeta, StubTransport } from "./eip155.test.helpers.js";

const INITIAL_STATE: TransportState = {
  connected: true,
  chainId: "0x1",
  chainRef: "eip155:1",
  accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  isUnlocked: true,
  meta: buildMeta(),
};

const createProvider = (
  initialState: TransportState = INITIAL_STATE,
  options?: ConstructorParameters<typeof Eip155Provider>[0]["timeouts"],
) => {
  const transport = new StubTransport(initialState);
  const provider = new Eip155Provider({ transport, ...(options ? { timeouts: options } : {}) });
  return { transport, provider };
};

describe("Eip155Provider: request() argument validation", () => {
  it.each([
    { label: "undefined", args: undefined, expectData: false },
    { label: "null", args: null, expectData: true },
    { label: "array", args: [], expectData: true },
    { label: "string", args: "foo", expectData: true },
  ])("rejects non-object args ($label)", async ({ args, expectData }) => {
    const { provider } = createProvider();

    const error: any = await provider.request(args as any).catch((err) => err);
    expect(error).toMatchObject({ code: -32600, message: REQUEST_VALIDATION_MESSAGES.invalidArgs });

    if (expectData) {
      expect("data" in error).toBe(true);
      expect((error as any).data).toEqual(args);
    } else {
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
    const error = await provider.request(args as any).catch((err) => err);
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
    const error = await provider.request(args as any).catch((err) => err);
    expect(error).toMatchObject({ code: -32600, message: REQUEST_VALIDATION_MESSAGES.invalidParams, data: args });
  });
});

describe("Eip155Provider: request() state errors", () => {
  it("rejects when transport reports disconnected", async () => {
    const { transport, provider } = createProvider();

    transport.updateState({ connected: false });
    transport.setRequestHandler(async () => {
      throw evmProviderErrors.disconnected();
    });

    const error: any = await provider.request({ method: "eth_blockNumber" }).catch((err) => err);
    expect(error).toMatchObject({ code: 4900 });
    expect("data" in error).toBe(false);
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
      throw evmRpcErrors.internal({ message: "Request timed out" });
    });

    await expect(provider.request({ method: "eth_blockNumber" })).rejects.toMatchObject({
      code: -32603,
      message: "Request timed out",
    });
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
    expect(error).toMatchObject({ code: DISCONNECT_EVENT_CODE, message: DISCONNECT_EVENT_MESSAGE });
  });
});

describe("Eip155Provider: state retention across transport disconnect", () => {
  it("retains chainId and accounts cache across disconnect", async () => {
    const initialState: TransportState = {
      ...INITIAL_STATE,
      connected: true,
      chainId: "0x1",
      chainRef: "eip155:1",
      accounts: ["0xabc"],
    };
    const { transport, provider } = createProvider(initialState);

    transport.emit("disconnect");

    expect(provider.chainId).toBe("0x1");
    expect(provider.selectedAddress).toBe("0xabc");

    await expect(provider.request({ method: "eth_chainId" })).resolves.toBe("0x1");
    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual(["0xabc"]);
  });
});

describe("Eip155Provider: standard events", () => {
  it("emits connect once transport connects", () => {
    const { transport, provider } = createProvider({
      connected: false,
      chainId: null,
      chainRef: null,
      accounts: [],
      isUnlocked: null,
      meta: null,
    });
    const connectListener = vi.fn();
    provider.on("connect", connectListener);

    transport.updateState({ connected: true });
    transport.emit("connect", {
      chainId: "0x1",
      chainRef: "eip155:1",
      accounts: [],
      isUnlocked: true,
      meta: buildMeta(),
    });

    expect(connectListener).toHaveBeenCalledTimes(1);
    expect(connectListener).toHaveBeenCalledWith({ chainId: "0x1" });
  });

  it("emits accountsChanged and updates eth_accounts cache", async () => {
    const { transport, provider } = createProvider();
    const listener = vi.fn();
    provider.on("accountsChanged", listener);

    transport.emit("accountsChanged", ["0xabc", "0xdef"]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(["0xabc", "0xdef"]);
    expect(provider.selectedAddress).toBe("0xabc");
    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual(["0xabc", "0xdef"]);
  });

  it("emits chainChanged and keeps eth_chainId consistent", async () => {
    const { transport, provider } = createProvider();
    const chainChanged = vi.fn();
    provider.on("chainChanged", chainChanged);

    transport.emit("chainChanged", {
      chainId: "0x89",
      chainRef: "eip155:137",
      meta: buildMeta({ activeChain: "eip155:137", supportedChains: ["eip155:1", "eip155:137"] }),
    });

    expect(chainChanged).toHaveBeenCalledTimes(1);
    expect(chainChanged).toHaveBeenCalledWith("0x89");
    await expect(provider.request({ method: "eth_chainId" })).resolves.toBe("0x89");
  });

  it("emits networkChanged when numeric chain reference changes", () => {
    const { transport, provider } = createProvider();
    const networkChanged = vi.fn();
    provider.on("networkChanged", networkChanged);

    transport.emit("chainChanged", {
      chainId: "0x89",
      chainRef: "eip155:137",
      meta: buildMeta({ activeChain: "eip155:137" }),
    });

    expect(networkChanged).toHaveBeenCalledTimes(1);
    expect(networkChanged).toHaveBeenCalledWith("137");
  });

  it("emits unlockStateChanged and updates isUnlocked", () => {
    const { transport, provider } = createProvider();
    const unlockListener = vi.fn();
    provider.on("unlockStateChanged", unlockListener);

    transport.emit("unlockStateChanged", { isUnlocked: false });
    expect(provider.isUnlocked).toBe(false);
    expect(unlockListener).toHaveBeenCalledTimes(1);
    expect(unlockListener).toHaveBeenCalledWith({ isUnlocked: false });
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
