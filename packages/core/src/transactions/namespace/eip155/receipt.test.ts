import { describe, expect, it, vi } from "vitest";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import { TEST_TX_HASH } from "./__fixtures__/constants.js";
import { createReceiptContext } from "./__fixtures__/contexts.js";
import { createEip155RpcClient } from "./__mocks__/rpc.js";
import { createEip155ReceiptService } from "./receipt.js";
import type { Eip155TrackingContext } from "./types.js";

const BASE_CONTEXT: Eip155TrackingContext = {
  ...createReceiptContext(),
  submitted: {
    hash: TEST_TX_HASH,
    chainId: "0x1",
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    nonce: "0x3",
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

    await expect(service.inspectSubmittedTransaction(BASE_CONTEXT)).rejects.toMatchObject({
      code: "global.rpc.internal",
      message: expect.stringContaining("mismatched"),
    });
  });

  it("reports confirmed when blockNumber exists", async () => {
    const client = createEip155RpcClient({
      getTransactionReceipt: vi.fn(async () => ({
        blockNumber: "0x123",
      })) as unknown as Eip155RpcClient["getTransactionReceipt"],
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    const result = await service.inspectSubmittedTransaction(BASE_CONTEXT);
    expect(result).toEqual({
      chainStatus: "confirmed",
      receipt: { blockNumber: "0x123" },
    });
  });

  it("reports dropped when nonce is already consumed", async () => {
    const client = createEip155RpcClient({
      getTransactionCount: vi.fn(async (): Promise<`0x${string}`> => "0x5"),
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    const context: Eip155TrackingContext = {
      ...BASE_CONTEXT,
    };

    const result = await service.inspectSubmittedTransaction(context);
    expect(result).toEqual({
      chainStatus: "dropped",
      evidence: { reason: "replaced" },
    });
  });

  it("reports pending when nonce has not been consumed", async () => {
    const client = createEip155RpcClient({
      getTransactionCount: vi.fn(async (): Promise<`0x${string}`> => "0x3"),
    });

    const service = createEip155ReceiptService({
      rpcClientFactory: () => client,
    });

    const context: Eip155TrackingContext = {
      ...BASE_CONTEXT,
    };

    const result = await service.inspectSubmittedTransaction(context);
    expect(result).toEqual({
      chainStatus: "pending",
      evidence: null,
    });
  });
});
