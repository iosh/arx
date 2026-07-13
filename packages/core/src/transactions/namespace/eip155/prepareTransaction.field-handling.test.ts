import { describe, expect, it } from "vitest";
import { TEST_ADDRESSES } from "./__fixtures__/constants.js";
import { createPrepareContext } from "./__fixtures__/contexts.js";
import { createTestPrepareTransaction, requireReadyPrepared } from "./__fixtures__/prepareTransaction.js";
import { createChainJsonRpcMock } from "./__mocks__/rpc.js";

const createPrepareRpc = (estimatedGas = "0x5208") =>
  createChainJsonRpcMock(({ method }) => {
    if (method === "eth_estimateGas") return estimatedGas;
    if (method === "eth_getBalance") return "0xffffffffffffffff";
    return null;
  });

describe("prepareTransaction - field handling", () => {
  it("normalizes provided hex fields to lowercase", async () => {
    const prepareTransaction = createTestPrepareTransaction();
    const ctx = createPrepareContext();
    ctx.request.payload.value = "0xDE0B6B3A7640000";
    ctx.request.payload.gas = "0x5208";
    ctx.request.payload.gasPrice = "0x3B9ACA00";
    ctx.request.payload.nonce = "0xA";

    const prepared = requireReadyPrepared(await prepareTransaction(ctx));

    expect(prepared).toMatchObject({
      value: "0xde0b6b3a7640000",
      gas: "0x5208",
      gasPrice: "0x3b9aca00",
      nonce: "0xa",
    });
  });

  it("normalizes transaction data before estimating gas", async () => {
    const rpc = createPrepareRpc();
    const prepareTransaction = createTestPrepareTransaction({ chainJsonRpc: rpc.client });
    const ctx = createPrepareContext();
    ctx.request.payload.data = "0xABCD";

    const prepared = requireReadyPrepared(await prepareTransaction(ctx));

    expect(prepared.data).toBe("0xabcd");
    expect(rpc.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "eth_estimateGas",
        params: [expect.objectContaining({ data: "0xabcd" })],
      }),
    );
  });

  it("preserves zero value and empty data", async () => {
    const prepareTransaction = createTestPrepareTransaction();
    const ctx = createPrepareContext();
    ctx.request.payload.value = "0x0";
    ctx.request.payload.data = "0x";

    const prepared = requireReadyPrepared(await prepareTransaction(ctx));

    expect(prepared.value).toBe("0x0");
    expect(prepared.data).toBe("0x");
  });

  it("omits the recipient when estimating a contract deployment", async () => {
    const rpc = createPrepareRpc("0x35000");
    const prepareTransaction = createTestPrepareTransaction({ chainJsonRpc: rpc.client });
    const ctx = createPrepareContext();
    ctx.request.payload.to = null;
    ctx.request.payload.data = "0x60006000";

    const prepared = requireReadyPrepared(await prepareTransaction(ctx));

    expect(prepared.to).toBeNull();
    expect(rpc.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "eth_estimateGas",
        params: [
          {
            from: TEST_ADDRESSES.FROM_A,
            data: "0x60006000",
            value: "0xde0b6b3a7640000",
          },
        ],
      }),
    );
  });
});
