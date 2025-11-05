import { describe, expect, it, vi } from "vitest";
import type { Eip155RpcCapabilities } from "../../../rpc/clients/eip155/eip155.js";
import type { TransactionAdapterContext } from "../types.js";
import { createEip155ReceiptService } from "./receipt.js";

const HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

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
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      nonce: "0x3",
      value: "0x0",
      data: "0x",
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
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        nonce: "0x3",
        value: "0x0",
        data: "0x",
      },
    },
    status: "broadcast",
    hash: HASH,
    receipt: null,
    error: null,
    userRejected: false,
    warnings: [],
    issues: [],
    createdAt: 1_000,
    updatedAt: 1_000,
  },
};

const createClient = (overrides: Partial<Eip155RpcCapabilities>): Eip155RpcCapabilities => {
  return {
    estimateGas: vi.fn(async () => "0x0"),
    getTransactionCount: vi.fn(async () => "0x0"),
    getFeeData: vi.fn(async () => ({})),
    getTransactionReceipt: vi.fn(async () => null),
    sendRawTransaction: vi.fn(async () => "0x0"),
    ...overrides,
  };
};

describe("createEip155ReceiptService", () => {
  it("throws when receipt hash mismatches", async () => {
    const client = createClient({
      getTransactionReceipt: vi.fn(async () => ({
        transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "0x1",
      })),
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    await expect(service.fetchReceipt(BASE_CONTEXT, HASH)).rejects.toMatchObject({
      code: -32603,
      message: expect.stringContaining("mismatched"),
    });
  });

  it("resolves status as success when blockNumber exists", async () => {
    const client = createClient({
      getTransactionReceipt: vi.fn(async () => ({
        blockNumber: "0x123",
      })),
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    const result = await service.fetchReceipt(BASE_CONTEXT, HASH);
    expect(result?.status).toBe("success");
    expect(result?.receipt).toMatchObject({ blockNumber: "0x123" });
  });

  it("detects replacement when nonce is already consumed", async () => {
    const client = createClient({
      getTransactionCount: vi.fn(async () => "0x5"),
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    const context: TransactionAdapterContext = {
      ...BASE_CONTEXT,
      request: {
        ...BASE_CONTEXT.request,
        payload: {
          ...(BASE_CONTEXT.request.payload as Record<string, unknown>),
          nonce: "0x3",
        },
      },
    };

    const result = await service.detectReplacement(context);
    expect(result).toEqual({ status: "replaced", hash: null });
  });
});
