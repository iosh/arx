import { describe, expect, it } from "vitest";
import { TEST_TX_HASH } from "./__fixtures__/constants.js";
import { createReceiptContext } from "./__fixtures__/contexts.js";
import { createChainJsonRpcMock } from "./__mocks__/rpc.js";
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
    const rpc = createChainJsonRpcMock(({ method }) =>
      method === "eth_getTransactionReceipt"
        ? {
            transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            status: "0x1",
          }
        : null,
    );

    const service = createEip155ReceiptService({
      chainJsonRpc: rpc.client,
    });

    await expect(service.inspectSubmittedTransaction(BASE_CONTEXT)).rejects.toMatchObject({
      code: "global.rpc.internal",
      message: expect.stringContaining("mismatched"),
    });
  });

  it("reports confirmed when blockNumber exists", async () => {
    const rpc = createChainJsonRpcMock(({ method }) =>
      method === "eth_getTransactionReceipt" ? { blockNumber: "0x123" } : null,
    );

    const service = createEip155ReceiptService({
      chainJsonRpc: rpc.client,
    });

    const result = await service.inspectSubmittedTransaction(BASE_CONTEXT);
    expect(result).toEqual({
      trackingStatus: "confirmed",
      receipt: { blockNumber: "0x123" },
    });
  });

  it("reports dropped when nonce is already consumed", async () => {
    const rpc = createChainJsonRpcMock(({ method }) => (method === "eth_getTransactionCount" ? "0x5" : null));

    const service = createEip155ReceiptService({
      chainJsonRpc: rpc.client,
    });

    const result = await service.inspectSubmittedTransaction(BASE_CONTEXT);
    expect(result).toEqual({
      trackingStatus: "dropped",
      evidence: { reason: "replaced" },
    });
  });

  it("reports pending when nonce has not been consumed", async () => {
    const rpc = createChainJsonRpcMock(({ method }) => (method === "eth_getTransactionCount" ? "0x3" : null));

    const service = createEip155ReceiptService({
      chainJsonRpc: rpc.client,
    });

    const result = await service.inspectSubmittedTransaction(BASE_CONTEXT);
    expect(result).toEqual({
      trackingStatus: "pending",
      evidence: null,
    });
  });
});
