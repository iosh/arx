import { describe, expect, it, vi } from "vitest";
import { TEST_ADDRESSES, TEST_VALUES } from "./__fixtures__/constants.js";
import { createPrepareContext } from "./__fixtures__/contexts.js";
import {
  createTestPrepareTransaction,
  requirePartialPrepared,
  requireReadyPrepared,
} from "./__fixtures__/prepareTransaction.js";
import { createChainJsonRpcMock } from "./__mocks__/rpc.js";

const createSuccessfulRpc = () =>
  createChainJsonRpcMock(({ method }) => {
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_getBalance") return "0xffffffffffffffff";
    return null;
  });

describe("prepareTransaction - RPC interaction", () => {
  it("returns blocked when the balance is below the maximum cost", async () => {
    const rpc = createChainJsonRpcMock(({ method }) => (method === "eth_getBalance" ? "0x0" : null));
    const prepareTransaction = createTestPrepareTransaction({ chainJsonRpc: rpc.client });
    const ctx = createPrepareContext();
    ctx.request.payload.nonce = "0x1";
    ctx.request.payload.gas = "0x5208";
    ctx.request.payload.gasPrice = "0x1";
    ctx.request.payload.value = "0x0";

    const result = await prepareTransaction(ctx);

    expect(rpc.request).toHaveBeenCalledWith({
      chainRef: ctx.chainRef,
      method: "eth_getBalance",
      params: [TEST_ADDRESSES.FROM_A, "latest"],
    });
    expect(result).toMatchObject({
      status: "blocked",
      blocker: { code: "transaction.prepare.insufficient_funds" },
    });
  });

  it("fills gas and fees while leaving nonce for finalization", async () => {
    const rpc = createSuccessfulRpc();
    const feeOracle = {
      suggestFees: vi.fn(async () => ({
        mode: "eip1559" as const,
        maxFeePerGas: "0x59682f00" as const,
        maxPriorityFeePerGas: "0x3b9aca00" as const,
        source: "eth_maxPriorityFeePerGas+eth_getBlockByNumber" as const,
      })),
    };
    const prepareTransaction = createTestPrepareTransaction({
      chainJsonRpc: rpc.client,
      feeOracleFactory: vi.fn(() => feeOracle),
    });
    const ctx = createPrepareContext();

    const prepared = requireReadyPrepared(await prepareTransaction(ctx));

    expect(prepared).toMatchObject({
      gas: "0x5208",
      maxFeePerGas: "0x59682f00",
      maxPriorityFeePerGas: "0x3b9aca00",
    });
    expect(prepared.nonce).toBeUndefined();
    expect(rpc.request).toHaveBeenCalledWith({
      chainRef: ctx.chainRef,
      method: "eth_estimateGas",
      params: [
        {
          from: TEST_ADDRESSES.FROM_A,
          to: TEST_ADDRESSES.TO_B,
          value: TEST_VALUES.ONE_ETH,
          data: TEST_VALUES.EMPTY_DATA,
        },
      ],
    });
  });

  it("does not estimate gas when it is already provided", async () => {
    const rpc = createSuccessfulRpc();
    const prepareTransaction = createTestPrepareTransaction({ chainJsonRpc: rpc.client });
    const ctx = createPrepareContext();
    ctx.request.payload.nonce = "0xa";
    ctx.request.payload.gas = "0x5208";
    ctx.request.payload.gasPrice = "0x3b9aca00";

    await prepareTransaction(ctx);

    expect(rpc.request.mock.calls.map(([request]) => request.method)).not.toContain("eth_estimateGas");
  });

  it("returns gas estimation error details", async () => {
    const rpc = createChainJsonRpcMock(({ method }) => {
      if (method === "eth_estimateGas") throw new Error("boom");
      return null;
    });
    const prepareTransaction = createTestPrepareTransaction({ chainJsonRpc: rpc.client });

    const result = await prepareTransaction(createPrepareContext());

    expect(result).toMatchObject({
      status: "failed",
      error: {
        code: "transaction.prepare.gas_estimation_failed",
        details: { method: "eth_estimateGas", error: "boom" },
      },
    });
  });

  it("rejects a malformed gas estimate", async () => {
    const rpc = createChainJsonRpcMock(({ method }) => {
      if (method === "eth_estimateGas") return "21000";
      if (method === "eth_getBalance") return "0xffffffffffffffff";
      return null;
    });
    const prepareTransaction = createTestPrepareTransaction({ chainJsonRpc: rpc.client });
    const ctx = createPrepareContext();
    Reflect.deleteProperty(ctx.request.payload, "gas");

    const result = await prepareTransaction(ctx);

    expect(result).toMatchObject({ status: "failed", error: { code: "transaction.prepare.invalid_hex" } });
    expect(requirePartialPrepared(result).gas).toBeUndefined();
  });

  it("blocks a zero gas estimate", async () => {
    const rpc = createChainJsonRpcMock(({ method }) => (method === "eth_estimateGas" ? "0x0" : null));
    const prepareTransaction = createTestPrepareTransaction({ chainJsonRpc: rpc.client });
    const ctx = createPrepareContext();
    Reflect.deleteProperty(ctx.request.payload, "gas");

    const result = await prepareTransaction(ctx);

    expect(result).toMatchObject({ status: "blocked", blocker: { code: "transaction.prepare.gas_zero" } });
    expect(requirePartialPrepared(result).gas).toBe("0x0");
  });
});
