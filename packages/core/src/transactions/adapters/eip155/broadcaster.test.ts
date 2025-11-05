import { describe, expect, it, vi } from "vitest";
import type { SignedTransactionPayload, TransactionAdapterContext } from "../types.js";
import { createEip155Broadcaster } from "./broadcaster.js";

const BASE_CONTEXT: TransactionAdapterContext = {
  namespace: "eip155",
  chainRef: "eip155:1",
  origin: "https://dapp.example",
  from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  request: {
    namespace: "eip155",
    caip2: "eip155:1",
    payload: {
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  },
  meta: {
    id: "tx-1",
    namespace: "eip155",
    caip2: "eip155:1",
    origin: "https://dapp.example",
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    request: {
      namespace: "eip155",
      caip2: "eip155:1",
      payload: {
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    },
    status: "approved",
    hash: null,
    receipt: null,
    error: null,
    userRejected: false,
    warnings: [],
    issues: [],
    createdAt: 1_000,
    updatedAt: 1_000,
  },
};

const SIGNED: SignedTransactionPayload = {
  raw: "0xdeadbeef",
  hash: null,
};

const createFactory = (sendRawTransactionImpl: (raw: string) => Promise<string>) => {
  return vi.fn(() => ({
    estimateGas: vi.fn(),
    getTransactionCount: vi.fn(),
    getFeeData: vi.fn(),
    getTransactionReceipt: vi.fn(),
    sendRawTransaction: vi.fn(sendRawTransactionImpl),
  }));
};

describe("createEip155Broadcaster", () => {
  it("returns normalised hash on success", async () => {
    const factory = createFactory(async () => "0xABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890");
    const broadcaster = createEip155Broadcaster({ rpcClientFactory: factory });

    const result = await broadcaster.broadcast(BASE_CONTEXT, SIGNED);

    expect(result.hash).toBe("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    expect(factory).toHaveBeenCalledWith("eip155:1");
  });

  it("throws internal error when hash is missing", async () => {
    const factory = createFactory(async () => "0x1234");
    const broadcaster = createEip155Broadcaster({ rpcClientFactory: factory });

    await expect(broadcaster.broadcast(BASE_CONTEXT, SIGNED)).rejects.toMatchObject({
      code: -32603,
      message: "RPC node returned a transaction hash with invalid format.",
    });
  });

  it("wraps factory failures in internal error", async () => {
    const factory = vi.fn(() => {
      throw new Error("no client");
    });
    const broadcaster = createEip155Broadcaster({ rpcClientFactory: factory });

    await expect(broadcaster.broadcast(BASE_CONTEXT, SIGNED)).rejects.toMatchObject({
      code: -32603,
      message: "Failed to create RPC client for the active chain.",
      data: expect.objectContaining({ chainRef: "eip155:1" }),
    });
  });

  it("rethrows RPC errors with numeric code", async () => {
    const rpcError = { code: 4001, message: "User rejected" };
    const factory = createFactory(async () => {
      throw rpcError;
    });
    const broadcaster = createEip155Broadcaster({ rpcClientFactory: factory });

    await expect(broadcaster.broadcast(BASE_CONTEXT, SIGNED)).rejects.toBe(rpcError);
  });

  it("wraps unexpected errors from RPC call", async () => {
    const factory = createFactory(async () => {
      throw new Error("boom");
    });
    const broadcaster = createEip155Broadcaster({ rpcClientFactory: factory });

    await expect(broadcaster.broadcast(BASE_CONTEXT, SIGNED)).rejects.toMatchObject({
      code: -32603,
      message: "Broadcast failed due to an unexpected error.",
      data: expect.objectContaining({ origin: "https://dapp.example" }),
    });
  });

  it("throws internal error when hash is not a string", async () => {
    const factory = createFactory(async () => 12345 as unknown as string);
    const broadcaster = createEip155Broadcaster({ rpcClientFactory: factory });

    await expect(broadcaster.broadcast(BASE_CONTEXT, SIGNED)).rejects.toMatchObject({
      code: -32603,
      message: "RPC node returned a non-string transaction hash.",
    });
  });

  it("throws internal error when hash is null", async () => {
    const factory = createFactory(async () => null as unknown as string);
    const broadcaster = createEip155Broadcaster({ rpcClientFactory: factory });

    await expect(broadcaster.broadcast(BASE_CONTEXT, SIGNED)).rejects.toMatchObject({
      code: -32603,
      message: "RPC node returned a non-string transaction hash.",
    });
  });

  it("normalises uppercase hash to lowercase", async () => {
    const factory = createFactory(async () => "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD");
    const broadcaster = createEip155Broadcaster({ rpcClientFactory: factory });

    const result = await broadcaster.broadcast(BASE_CONTEXT, SIGNED);

    expect(result.hash).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  });
});
