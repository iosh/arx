import { describe, expect, it, vi } from "vitest";
import { TEST_ADDRESSES } from "./__fixtures__/constants.js";
import { createPrepareContext } from "./__fixtures__/contexts.js";
import { createTestPrepareTransaction, requireReadyPrepared } from "./__fixtures__/prepareTransaction.js";
import { createEip155RpcMock } from "./__mocks__/rpc.js";

describe("prepareTransaction - field handling", () => {
  describe("hex normalization", () => {
    it("normalizes provided hex fields to lowercase", async () => {
      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => createEip155RpcMock().client),
      });

      const ctx = createPrepareContext();
      ctx.request.payload.value = "0xDE0B6B3A7640000";
      ctx.request.payload.gas = "0x5208";
      ctx.request.payload.gasPrice = "0x3B9ACA00";
      ctx.request.payload.nonce = "0xA";

      const result = await prepareTransaction(ctx);
      const prepared = requireReadyPrepared(result);

      expect(prepared.value).toBe("0xde0b6b3a7640000");
      expect(prepared.gas).toBe("0x5208");
      expect(prepared.gasPrice).toBe("0x3b9aca00");
      expect(prepared.nonce).toBe("0xa");
      expect(BigInt(prepared.value as `0x${string}`).toString(10)).toBe("1000000000000000000");
    });

    it("normalizes payload data field to lowercase hex", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext();
      ctx.request.payload.data = "0xABCD";

      const result = await prepareTransaction(ctx);
      const prepared = requireReadyPrepared(result);

      expect(prepared.data).toBe("0xabcd");
      expect(rpc.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ data: "0xabcd" }));
    });
  });

  describe("zero and empty values", () => {
    it("handles zero value and empty data", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext();
      ctx.request.payload.value = "0x0";
      ctx.request.payload.data = "0x";

      const result = await prepareTransaction(ctx);
      const prepared = requireReadyPrepared(result);

      expect(prepared.value).toBe("0x0");
      expect(prepared.data).toBe("0x");
    });
  });

  describe("contract deployment", () => {
    it("supports contract deployment payloads", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x30000");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext();
      ctx.request.payload.to = null;
      ctx.request.payload.data = "0x60006000";

      const result = await prepareTransaction(ctx);
      const prepared = requireReadyPrepared(result);

      expect(prepared.to).toBeNull();
    });

    it("omits to field in callParams when deploying contracts", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x35000");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext();
      ctx.request.payload.to = null;
      ctx.request.payload.data = "0x60006000";

      await prepareTransaction(ctx);

      expect(rpc.estimateGas).toHaveBeenCalledWith(
        expect.objectContaining({
          from: TEST_ADDRESSES.FROM_A,
          data: "0x60006000",
          value: "0xde0b6b3a7640000",
        }),
      );

      const firstCallArgs = rpc.estimateGas.mock.calls[0]?.[0];
      expect(firstCallArgs).not.toHaveProperty("to");
    });
  });
});
