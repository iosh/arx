import { describe, expect, it, vi } from "vitest";
import type { TransactionAdapterContext } from "../types.js";
import { TEST_TX_HASH } from "./__fixtures__/constants.js";
import { createReceiptContext } from "./__fixtures__/contexts.js";
import { createEip155RpcClient } from "./__mocks__/rpc.js";
import { createEip155ReceiptService } from "./receipt.js";

const BASE_CONTEXT = createReceiptContext();

describe("createEip155ReceiptService", () => {
  it("throws when receipt hash mismatches", async () => {
    const client = createEip155RpcClient({
      getTransactionReceipt: vi.fn(async () => ({
        transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "0x1",
      })),
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    await expect(service.fetchReceipt(BASE_CONTEXT, TEST_TX_HASH)).rejects.toMatchObject({
      code: -32603,
      message: expect.stringContaining("mismatched"),
    });
  });

  it("resolves status as success when blockNumber exists", async () => {
    const client = createEip155RpcClient({
      getTransactionReceipt: vi.fn(async () => ({
        blockNumber: "0x123",
      })),
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    const result = await service.fetchReceipt(BASE_CONTEXT, TEST_TX_HASH);
    expect(result?.status).toBe("success");
    expect(result?.receipt).toMatchObject({ blockNumber: "0x123" });
  });

  it("detects replacement when nonce is already consumed", async () => {
    const client = createEip155RpcClient({
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
