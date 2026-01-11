import { describe, expect, it, vi } from "vitest";
import { Eip155Provider } from "../../provider/index.js";
import type { TransportState } from "../../types/transport.js";
import { buildMeta, StubTransport } from "./eip155.test.helpers.js";

const INITIAL_STATE: TransportState = {
  connected: true,
  chainId: "0x1",
  caip2: "eip155:1",
  accounts: [],
  isUnlocked: true,
  meta: buildMeta(),
};

const createProvider = (initialState: TransportState = INITIAL_STATE) => {
  const transport = new StubTransport(initialState);
  const provider = new Eip155Provider({ transport });
  return { transport, provider };
};

describe("Eip155Provider legacy API compatibility", () => {
  it("send(method, params) resolves a JSON-RPC response object", async () => {
    const { transport, provider } = createProvider();
    transport.setRequestHandler(async (args) => {
      expect(args).toEqual({ method: "eth_chainId" });
      return "0x1";
    });

    const response = (await (provider as any).send("eth_chainId")) as unknown;

    expect(response).toEqual({ id: undefined, jsonrpc: "2.0", result: "0x1" });
  });

  it("send(payload, callback) invokes callback with JSON-RPC response object", async () => {
    const { transport, provider } = createProvider();
    transport.setRequestHandler(async () => "0x1");

    const callback = vi.fn();
    const ret = (provider as any).send({ id: 1, jsonrpc: "2.0", method: "eth_chainId" }, callback);
    expect(ret).toBeUndefined();

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null, { id: 1, jsonrpc: "2.0", result: "0x1" });
  });

  it("sendAsync(payload, callback) supports batch payloads and returns per-item errors", async () => {
    const { transport, provider } = createProvider();
    transport.setRequestHandler(async ({ method }) => {
      if (method === "eth_chainId") return "0x1";
      throw new Error("boom");
    });

    const callback = vi.fn();
    (provider as any).sendAsync(
      [
        { id: "a", jsonrpc: "2.0", method: "eth_chainId" },
        { id: "b", jsonrpc: "2.0", method: "eth_unknownMethod" },
      ],
      callback,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(callback).toHaveBeenCalledTimes(1);
    const [error, responses] = callback.mock.calls[0] ?? [];
    expect(error).toBeNull();
    expect(responses).toHaveLength(2);
    expect(responses[0]).toEqual({ id: "a", jsonrpc: "2.0", result: "0x1" });
    expect(responses[1]).toMatchObject({ id: "b", jsonrpc: "2.0", error: { code: -32603 } });
  });

  it("send(payload) supports a minimal sync subset (eth_accounts/eth_coinbase/net_version)", () => {
    const { provider } = createProvider({
      ...INITIAL_STATE,
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    expect((provider as any).send({ id: 1, jsonrpc: "2.0", method: "eth_accounts" })).toEqual({
      id: 1,
      jsonrpc: "2.0",
      result: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    expect((provider as any).send({ id: 2, jsonrpc: "2.0", method: "eth_coinbase" })).toEqual({
      id: 2,
      jsonrpc: "2.0",
      result: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect((provider as any).send({ id: 3, jsonrpc: "2.0", method: "net_version" })).toEqual({
      id: 3,
      jsonrpc: "2.0",
      result: "1",
    });

    expect(() => (provider as any).send({ id: 4, jsonrpc: "2.0", method: "eth_chainId" })).toThrow(
      /Unsupported sync method/,
    );
  });
});
