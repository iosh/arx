import { ArxReasons } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import type { TransactionTrackingContext } from "../types.js";
import { TEST_TX_HASH } from "./__fixtures__/constants.js";
import { createReceiptContext } from "./__fixtures__/contexts.js";
import { createEip155RpcClient } from "./__mocks__/rpc.js";
import { createEip155ReceiptService } from "./receipt.js";

const BASE_CONTEXT: TransactionTrackingContext = {
  ...createReceiptContext(),
  submitted: {
    hash: TEST_TX_HASH,
    chainId: "0x1",
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    nonce: "0x3",
  },
  locator: {
    format: "eip155.tx_hash",
    value: TEST_TX_HASH,
  },
};

describe("createEip155ReceiptService", () => {
  it("throws when receipt hash mismatches", async () => {
    const client = createEip155RpcClient({
      getTransactionReceipt: vi.fn(async () => ({
        transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "0x1",
      })) as unknown as Eip155RpcClient["getTransactionReceipt"],
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    await expect(service.fetchReceipt(BASE_CONTEXT)).rejects.toMatchObject({
      reason: ArxReasons.RpcInternal,
      message: expect.stringContaining("mismatched"),
    });
  });

  it("resolves status as success when blockNumber exists", async () => {
    const client = createEip155RpcClient({
      getTransactionReceipt: vi.fn(async () => ({
        blockNumber: "0x123",
      })) as unknown as Eip155RpcClient["getTransactionReceipt"],
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    const result = await service.fetchReceipt(BASE_CONTEXT);
    expect(result?.status).toBe("success");
    expect(result?.receipt).toMatchObject({ blockNumber: "0x123" });
  });

  it("detects replacement when nonce is already consumed", async () => {
    const client = createEip155RpcClient({
      getTransactionCount: vi.fn(async (): Promise<`0x${string}`> => "0x5"),
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    const context: TransactionTrackingContext = {
      ...BASE_CONTEXT,
      request: {
        ...BASE_CONTEXT.request,
        payload: BASE_CONTEXT.request.payload,
      },
    };

    const result = await service.detectReplacement(context);
    expect(result).toEqual({ status: "replaced" });
  });

  it("detects replacement when nonce is available in submitted payload", async () => {
    const client = createEip155RpcClient({
      getTransactionCount: vi.fn(async (): Promise<`0x${string}`> => "0x5"),
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    const context: TransactionTrackingContext = {
      ...BASE_CONTEXT,
      request: {
        ...BASE_CONTEXT.request,
        payload: BASE_CONTEXT.request.payload,
      },
    };

    const result = await service.detectReplacement(context);
    expect(result).toEqual({ status: "replaced" });
  });
});
