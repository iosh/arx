import { describe, expect, it, vi } from "vitest";
import { createAdapterContext } from "./__fixtures__/contexts.js";
import { createTestPrepareTransaction } from "./__fixtures__/prepareTransaction.js";
import { createEip155RpcMock } from "./__mocks__/rpc.js";

describe("prepareTransaction - fees", () => {
  describe("legacy fees", () => {
    it("uses legacy gasPrice when provided", async () => {
      const rpc = createEip155RpcMock();
      const feeOracle = { suggestFees: vi.fn() };
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
        feeOracleFactory: vi.fn((_rpc) => feeOracle),
      });

      const ctx = createAdapterContext();
      ctx.request.payload.gasPrice = "0x3b9aca00";

      const prepared = await prepareTransaction(ctx);

      expect(prepared.prepared.gasPrice).toBe("0x3b9aca00");
      expect(feeOracle.suggestFees).not.toHaveBeenCalled();
    });

    it("forwards gasPrice to RPC gas estimation when provided", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x2");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");
      ctx.request.payload.gasPrice = "0x2540be400";

      await prepareTransaction(ctx);

      expect(rpc.estimateGas).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
        }),
      );
    });

    it("falls back to legacy fee data when RPC only returns gasPrice", async () => {
      const rpc = createEip155RpcMock();
      const feeOracle = { suggestFees: vi.fn() };
      feeOracle.suggestFees.mockResolvedValue({ mode: "legacy", gasPrice: "0x3b9aca00", source: "eth_gasPrice" });
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
        feeOracleFactory: vi.fn((_rpc) => feeOracle),
      });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gasPrice");
      Reflect.deleteProperty(ctx.request.payload, "maxFeePerGas");
      Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

      const prepared = await prepareTransaction(ctx);

      expect(prepared.prepared.gasPrice).toBe("0x3b9aca00");
    });
  });

  describe("EIP-1559 fees", () => {
    it("forwards eip1559 fees to RPC gas estimation when provided", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x3");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");
      Reflect.deleteProperty(ctx.request.payload, "gasPrice");
      ctx.request.payload.maxFeePerGas = "0x59682f00";
      ctx.request.payload.maxPriorityFeePerGas = "0x3b9aca00";

      await prepareTransaction(ctx);

      expect(rpc.estimateGas).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
        }),
      );
    });

    it("uses eip1559 fee fields provided in payload", async () => {
      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => createEip155RpcMock().client),
      });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gasPrice");
      ctx.request.payload.maxFeePerGas = "0x59682F00";
      ctx.request.payload.maxPriorityFeePerGas = "0x3B9ACA00";

      const prepared = await prepareTransaction(ctx);

      expect(prepared.prepared.maxFeePerGas).toBe("0x59682f00");
      expect(prepared.prepared.maxPriorityFeePerGas).toBe("0x3b9aca00");
    });

    it("detects incomplete EIP-1559 fee pair", async () => {
      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => createEip155RpcMock().client),
      });

      const ctx = createAdapterContext();
      ctx.request.payload.maxFeePerGas = "0x59682f00";
      Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

      const prepared = await prepareTransaction(ctx);

      expect(prepared.issues.map((item) => item.code)).toContain("transaction.prepare.fee_pair_incomplete");
    });
  });

  describe("fee conflicts", () => {
    it("detects fee conflict when mixing gasPrice with EIP-1559 fields", async () => {
      const rpc = createEip155RpcMock();

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.gasPrice = "0x3b9aca00";
      ctx.request.payload.maxFeePerGas = "0x59682f00";

      const prepared = await prepareTransaction(ctx);

      expect(prepared.issues.map((item) => item.code)).toContain("transaction.prepare.fee_conflict");
    });

    it("records a fee conflict issue when fee fields conflict", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.gasPrice = "0x3b9aca00";
      ctx.request.payload.maxFeePerGas = "0x59682f00";
      ctx.request.payload.maxPriorityFeePerGas = "0x3b9aca00";

      const prepared = await prepareTransaction(ctx);

      expect(prepared.issues.map((item) => item.code)).toContain("transaction.prepare.fee_conflict");
    });
  });

  describe("fee estimation errors", () => {
    it("attaches rpc error details when fee estimation fails", async () => {
      const rpc = createEip155RpcMock();
      const feeOracle = { suggestFees: vi.fn() };
      feeOracle.suggestFees.mockRejectedValue(new Error("fee rpc down"));
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
        feeOracleFactory: vi.fn((_rpc) => feeOracle),
      });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gasPrice");
      Reflect.deleteProperty(ctx.request.payload, "maxFeePerGas");
      Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

      const prepared = await prepareTransaction(ctx);
      const issue = prepared.issues.find((item) => item.code === "transaction.prepare.fee_estimation_failed");

      expect(issue?.data).toMatchObject({
        method: "feeOracle.suggestFees",
        error: "fee rpc down",
      });
    });
  });
});
