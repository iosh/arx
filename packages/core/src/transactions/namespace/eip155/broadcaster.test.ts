import { describe, expect, it } from "vitest";
import type { SignedTransactionPayload } from "../types.js";
import { TEST_CHAINS } from "./__fixtures__/constants.js";
import { createBroadcasterContext } from "./__fixtures__/contexts.js";
import { createChainJsonRpcMock } from "./__mocks__/rpc.js";
import { createEip155Broadcaster } from "./broadcaster.js";

const BASE_CONTEXT = createBroadcasterContext();
const SIGNED: SignedTransactionPayload = { raw: "0xdeadbeef", hash: null };

describe("createEip155Broadcaster", () => {
  it("broadcasts once and returns a canonical transaction hash", async () => {
    const rpc = createChainJsonRpcMock(() => "0xABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890");
    const broadcaster = createEip155Broadcaster({ chainJsonRpc: rpc.client });

    const result = await broadcaster.broadcast(BASE_CONTEXT, SIGNED);

    expect(result.hash).toBe("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    expect(rpc.request).toHaveBeenCalledOnce();
    expect(rpc.request).toHaveBeenCalledWith({
      chainRef: TEST_CHAINS.MAINNET,
      method: "eth_sendRawTransaction",
      params: [SIGNED.raw],
      replay: "forbidden",
    });
  });

  it("rejects an invalid transaction hash", async () => {
    const rpc = createChainJsonRpcMock(() => "0x1234");
    const broadcaster = createEip155Broadcaster({ chainJsonRpc: rpc.client });

    await expect(broadcaster.broadcast(BASE_CONTEXT, SIGNED)).rejects.toMatchObject({
      code: "global.rpc.internal",
      message: "RPC node returned a transaction hash with invalid format.",
    });
  });

  it("rejects a non-string transaction hash", async () => {
    const rpc = createChainJsonRpcMock(() => 12345);
    const broadcaster = createEip155Broadcaster({ chainJsonRpc: rpc.client });

    await expect(broadcaster.broadcast(BASE_CONTEXT, SIGNED)).rejects.toMatchObject({
      code: "global.rpc.internal",
      message: "RPC node returned a non-string transaction hash.",
    });
  });

  it("preserves an RPC rejection", async () => {
    const rpcError = { code: -32000, message: "Transaction rejected" };
    const rpc = createChainJsonRpcMock(() => {
      throw rpcError;
    });
    const broadcaster = createEip155Broadcaster({ chainJsonRpc: rpc.client });

    await expect(broadcaster.broadcast(BASE_CONTEXT, SIGNED)).rejects.toBe(rpcError);
  });

  it("wraps an unexpected client error", async () => {
    const rpc = createChainJsonRpcMock(() => {
      throw new Error("boom");
    });
    const broadcaster = createEip155Broadcaster({ chainJsonRpc: rpc.client });

    await expect(broadcaster.broadcast(BASE_CONTEXT, SIGNED)).rejects.toMatchObject({
      code: "global.rpc.internal",
      message: "Broadcast failed due to an unexpected error.",
    });
  });
});
