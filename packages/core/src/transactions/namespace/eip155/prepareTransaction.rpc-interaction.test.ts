import { describe, expect, it, vi } from "vitest";
import { TEST_ADDRESSES, TEST_VALUES } from "./__fixtures__/constants.js";
import { createPrepareContext } from "./__fixtures__/contexts.js";
import {
  createTestPrepareTransaction,
  requirePartialPrepared,
  requireReadyPrepared,
} from "./__fixtures__/prepareTransaction.js";
import { createEip155RpcMock } from "./__mocks__/rpc.js";

describe("prepareTransaction - RPC interaction", () => {
  describe("RPC data fetching", () => {
    it("returns blocked when balance is lower than max cost", async () => {
      const rpc = createEip155RpcMock();
      rpc.getBalance.mockResolvedValue("0x0");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
      });

      const ctx = createPrepareContext();
      // Provide values so preparation can check balance without extra RPC lookups.
      ctx.request.payload.nonce = "0x1";
      ctx.request.payload.gas = "0x5208";
      ctx.request.payload.gasPrice = "0x1";
      ctx.request.payload.value = "0x0";

      const result = await prepareTransaction(ctx);

      expect(rpc.getBalance).toHaveBeenCalledWith(
        TEST_ADDRESSES.FROM_A,
        expect.objectContaining({ blockTag: "latest" }),
      );
      expect(result.status).toBe("blocked");
      expect(result.status === "blocked" ? result.blocker.reason : null).toBe("transaction.prepare.insufficient_funds");
    });

    it("fills nonce, gas, and EIP-1559 fees from RPC responses", async () => {
      const rpc = createEip155RpcMock();
      const feeOracle = { suggestFees: vi.fn() };
      rpc.getTransactionCount.mockResolvedValue("0xa");
      rpc.estimateGas.mockResolvedValue("0x5208");
      feeOracle.suggestFees.mockResolvedValue({
        mode: "eip1559",
        maxFeePerGas: "0x59682f00",
        maxPriorityFeePerGas: "0x3b9aca00",
        source: "eth_maxPriorityFeePerGas+eth_getBlockByNumber",
      });
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
        feeOracleFactory: vi.fn((_rpc) => feeOracle),
      });

      const ctx = createPrepareContext();
      const result = await prepareTransaction(ctx);
      const prepared = requireReadyPrepared(result);

      expect(prepared.nonce).toBe("0xa");
      expect(prepared.gas).toBe("0x5208");
      expect(prepared.maxFeePerGas).toBe("0x59682f00");
      expect(prepared.maxPriorityFeePerGas).toBe("0x3b9aca00");
    });

    it("fetches nonce from RPC when it is missing", async () => {
      const rpc = createEip155RpcMock();
      const feeOracle = { suggestFees: vi.fn() };
      rpc.getTransactionCount.mockResolvedValue("0xb");
      rpc.estimateGas.mockResolvedValue("0x5208");
      feeOracle.suggestFees.mockResolvedValue({
        mode: "eip1559",
        maxFeePerGas: "0x59682f00",
        maxPriorityFeePerGas: "0x3b9aca00",
        source: "eth_maxPriorityFeePerGas+eth_getBlockByNumber",
      });
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
        feeOracleFactory: vi.fn((_rpc) => feeOracle),
      });

      const ctx = createPrepareContext();
      Reflect.deleteProperty(ctx.request.payload, "nonce");
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const result = await prepareTransaction(ctx);
      const prepared = requireReadyPrepared(result);

      expect(rpc.getTransactionCount).toHaveBeenCalledWith(
        TEST_ADDRESSES.FROM_A,
        expect.objectContaining({ blockTag: "pending" }),
      );
      expect(prepared.nonce).toBe("0xb");
    });

    it("skips nonce/gas RPC calls when values already provided", async () => {
      const rpc = createEip155RpcMock();
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext();
      ctx.request.payload.nonce = "0xa";
      ctx.request.payload.gas = "0x5208";
      ctx.request.payload.gasPrice = "0x3b9aca00";

      await prepareTransaction(ctx);

      expect(rpc.getTransactionCount).not.toHaveBeenCalled();
      expect(rpc.estimateGas).not.toHaveBeenCalled();
    });

    it("does not run RPC lookups when from address is unavailable", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext({ from: null });
      Reflect.deleteProperty(ctx.request.payload, "from");

      const result = await prepareTransaction(ctx);

      expect(result.status).toBe("blocked");
      expect(result.status === "blocked" ? result.blocker.reason : null).toBe("transaction.prepare.from_missing");
      expect(rpc.getTransactionCount).not.toHaveBeenCalled();
      expect(rpc.estimateGas).not.toHaveBeenCalled();
    });
  });

  describe("RPC error handling", () => {
    it("returns failed when RPC nonce fetch fails first", async () => {
      const rpc = createEip155RpcMock();
      const feeOracle = { suggestFees: vi.fn() };
      rpc.getTransactionCount.mockRejectedValue(new Error("nonce error"));
      rpc.estimateGas.mockRejectedValue(new Error("estimate error"));
      feeOracle.suggestFees.mockRejectedValue(new Error("fee error"));
      rpc.getBalance.mockRejectedValue(new Error("balance error"));

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
        feeOracleFactory: vi.fn((_rpc) => feeOracle),
      });

      const ctx = createPrepareContext();
      const result = await prepareTransaction(ctx);

      expect(result.status).toBe("failed");
      expect(result.status === "failed" ? result.error.reason : null).toBe("transaction.prepare.nonce_failed");
    });

    it("attaches rpc error metadata when nonce fetch fails", async () => {
      const rpc = createEip155RpcMock();
      const feeOracle = { suggestFees: vi.fn() };
      rpc.getTransactionCount.mockRejectedValue(new Error("RPC nonce failure"));
      rpc.estimateGas.mockResolvedValue("0x5208");
      feeOracle.suggestFees.mockResolvedValue({ mode: "legacy", gasPrice: "0x3b9aca00", source: "eth_gasPrice" });
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
        feeOracleFactory: vi.fn((_rpc) => feeOracle),
      });

      const ctx = createPrepareContext();
      Reflect.deleteProperty(ctx.request.payload, "nonce");

      const result = await prepareTransaction(ctx);

      expect(result.status).toBe("failed");
      expect(result.status === "failed" ? result.error.reason : null).toBe("transaction.prepare.nonce_failed");
      expect(result.status === "failed" ? result.error.data : null).toMatchObject({
        method: "eth_getTransactionCount",
        error: "RPC nonce failure",
      });
    });

    it("attaches rpc error metadata when gas estimation fails", async () => {
      const rpc = createEip155RpcMock();
      const feeOracle = { suggestFees: vi.fn() };
      rpc.getTransactionCount.mockResolvedValue("0x5");
      rpc.estimateGas.mockRejectedValue(new Error("boom"));
      feeOracle.suggestFees.mockResolvedValue({ mode: "legacy", gasPrice: "0x3b9aca00", source: "eth_gasPrice" });
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
        feeOracleFactory: vi.fn((_rpc) => feeOracle),
      });

      const ctx = createPrepareContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const result = await prepareTransaction(ctx);

      expect(result.status).toBe("failed");
      expect(result.status === "failed" ? result.error.reason : null).toBe("transaction.prepare.gas_estimation_failed");
      expect(result.status === "failed" ? result.error.data : null).toMatchObject({
        method: "eth_estimateGas",
        error: "boom",
      });
    });

    it("flags rpc_unavailable when client factory throws", async () => {
      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => {
          throw new Error("boom");
        }),
      });

      const ctx = createPrepareContext();
      const result = await prepareTransaction(ctx);

      expect(result.status).toBe("failed");
      expect(result.status === "failed" ? result.error.reason : null).toBe("transaction.prepare.rpc_unavailable");
    });

    it("reports invalid hex when RPC nonce response is malformed", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext();
      Reflect.deleteProperty(ctx.request.payload, "nonce");

      const result = await prepareTransaction(ctx);
      const prepared = requirePartialPrepared(result);

      expect(result.status).toBe("failed");
      expect(result.status === "failed" ? result.error.reason : null).toBe("transaction.prepare.invalid_hex");
      expect(prepared.nonce).toBeUndefined();
    });

    it("reports invalid hex when RPC gas response is malformed", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("21000");
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const result = await prepareTransaction(ctx);
      const prepared = requirePartialPrepared(result);

      expect(result.status).toBe("failed");
      expect(result.status === "failed" ? result.error.reason : null).toBe("transaction.prepare.invalid_hex");
      expect(prepared.gas).toBeUndefined();
    });

    it("records invalid_hex when RPC fee data is malformed", async () => {
      const rpc = createEip155RpcMock();
      const feeOracle = { suggestFees: vi.fn() };
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      feeOracle.suggestFees.mockResolvedValue({
        mode: "eip1559",
        maxFeePerGas: "123",
        maxPriorityFeePerGas: "0xGG",
        source: "eth_maxPriorityFeePerGas+eth_getBlockByNumber",
      });
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
        feeOracleFactory: vi.fn((_rpc) => feeOracle),
      });

      const result = await prepareTransaction(createPrepareContext());

      expect(result.status).toBe("failed");
      expect(result.status === "failed" ? result.error.reason : null).toBe("transaction.prepare.invalid_hex");
    });
  });

  describe("gas estimation", () => {
    it("captures estimate input arguments for gas estimation", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0xa");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext();
      await prepareTransaction(ctx);

      expect(rpc.estimateGas).toHaveBeenCalledWith({
        from: TEST_ADDRESSES.FROM_A,
        to: TEST_ADDRESSES.TO_B,
        value: TEST_VALUES.ONE_ETH,
        data: TEST_VALUES.EMPTY_DATA,
      });
    });

    it("flags zero gas estimate from RPC", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x0");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const result = await prepareTransaction(ctx);
      const prepared = requirePartialPrepared(result);

      expect(result.status).toBe("blocked");
      expect(result.status === "blocked" ? result.blocker.reason : null).toBe("transaction.prepare.gas_zero");
      expect(prepared.gas).toBe("0x0");
    });
  });
});
