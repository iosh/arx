import { describe, expect, it, vi } from "vitest";
import { TEST_ADDRESSES, TEST_VALUES } from "./__fixtures__/constants.js";
import { createAdapterContext } from "./__fixtures__/contexts.js";
import { createTestPrepareTransaction } from "./__fixtures__/prepareTransaction.js";
import { createEip155RpcMock } from "./__mocks__/rpc.js";

describe("prepareTransaction - RPC interaction", () => {
  describe("RPC data fetching", () => {
    it("adds insufficient_funds issue when balance is lower than max cost", async () => {
      const rpc = createEip155RpcMock();
      rpc.getBalance.mockResolvedValue("0x0");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
      });

      const ctx = createAdapterContext();
      // Provide values so preparation can check balance without extra RPC lookups.
      ctx.request.payload.nonce = "0x1";
      ctx.request.payload.gas = "0x5208";
      ctx.request.payload.gasPrice = "0x1";
      ctx.request.payload.value = "0x0";

      const prepared = await prepareTransaction(ctx);

      expect(rpc.getBalance).toHaveBeenCalledWith(TEST_ADDRESSES.FROM_A, "latest");
      expect(prepared.issues.map((item) => item.code)).toContain("transaction.prepare.insufficient_funds");
    });

    it("fills nonce, gas, and EIP-1559 fees from RPC responses", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0xa");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({
        maxFeePerGas: "0x59682f00",
        maxPriorityFeePerGas: "0x3b9aca00",
      });
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
      });

      const ctx = createAdapterContext();
      const prepared = await prepareTransaction(ctx);

      expect(prepared.prepared.nonce).toBe("0xa");
      expect(prepared.prepared.gas).toBe("0x5208");
      expect(prepared.prepared.maxFeePerGas).toBe("0x59682f00");
      expect(prepared.prepared.maxPriorityFeePerGas).toBe("0x3b9aca00");
    });

    it("fetches nonce from RPC when it is missing", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0xb");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({
        maxFeePerGas: "0x59682f00",
        maxPriorityFeePerGas: "0x3b9aca00",
      });
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "nonce");
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const prepared = await prepareTransaction(ctx);

      expect(rpc.getTransactionCount).toHaveBeenCalledWith(TEST_ADDRESSES.FROM_A, "pending");
      expect(prepared.prepared.nonce).toBe("0xb");
    });

    it("skips nonce/gas RPC calls when values already provided", async () => {
      const rpc = createEip155RpcMock();
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
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

      const ctx = createAdapterContext({ from: null });
      Reflect.deleteProperty(ctx.request.payload, "from");
      ctx.meta.from = null;
      ctx.meta.request = ctx.request;

      const prepared = await prepareTransaction(ctx);

      expect(prepared.issues.map((item) => item.code)).toContain("transaction.prepare.from_missing");
      expect(rpc.getTransactionCount).not.toHaveBeenCalled();
      expect(rpc.estimateGas).toHaveBeenCalledWith([
        {
          to: TEST_ADDRESSES.TO_B,
          value: TEST_VALUES.ONE_ETH,
          data: TEST_VALUES.EMPTY_DATA,
        },
      ]);
    });
  });

  describe("RPC error handling", () => {
    it("records issues when RPC estimation fails", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockRejectedValue(new Error("nonce error"));
      rpc.estimateGas.mockRejectedValue(new Error("estimate error"));
      rpc.getFeeData.mockRejectedValue(new Error("fee error"));
      rpc.getBalance.mockRejectedValue(new Error("balance error"));

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      const prepared = await prepareTransaction(ctx);

      expect(prepared.issues.map((item) => item.code)).toEqual(
        expect.arrayContaining([
          "transaction.prepare.nonce_failed",
          "transaction.prepare.gas_estimation_failed",
          "transaction.prepare.fee_estimation_failed",
        ]),
      );
    });

    it("attaches rpc error metadata when nonce fetch fails", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockRejectedValue(new Error("RPC nonce failure"));
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "nonce");

      const prepared = await prepareTransaction(ctx);
      const nonceIssue = prepared.issues.find((item) => item.code === "transaction.prepare.nonce_failed");

      expect(nonceIssue).toBeTruthy();
      expect(nonceIssue?.data).toMatchObject({
        method: "eth_getTransactionCount",
        error: "RPC nonce failure",
      });
    });

    it("attaches rpc error metadata when gas estimation fails", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x5");
      rpc.estimateGas.mockRejectedValue(new Error("boom"));
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const prepared = await prepareTransaction(ctx);
      const gasIssue = prepared.issues.find((item) => item.code === "transaction.prepare.gas_estimation_failed");

      expect(gasIssue?.data).toMatchObject({
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

      const ctx = createAdapterContext();
      const prepared = await prepareTransaction(ctx);

      expect(prepared.issues.map((item) => item.code)).toContain("transaction.prepare.rpc_unavailable");
    });

    it("reports invalid hex when RPC nonce response is malformed", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "nonce");

      const prepared = await prepareTransaction(ctx);

      expect(prepared.issues.map((item) => item.code)).toContain("transaction.prepare.invalid_hex");
      expect(prepared.prepared.nonce).toBeUndefined();
    });

    it("reports invalid hex when RPC gas response is malformed", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("21000");
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const prepared = await prepareTransaction(ctx);

      expect(prepared.issues.map((item) => item.code)).toContain("transaction.prepare.invalid_hex");
      expect(prepared.prepared.gas).toBeUndefined();
    });

    it("records invalid_hex when RPC fee data is malformed", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({
        maxFeePerGas: "123",
        maxPriorityFeePerGas: "0xGG",
      });
      rpc.getBalance.mockResolvedValue("0xffffffffffffffff");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const prepared = await prepareTransaction(createAdapterContext());

      const issueCodes = prepared.issues.map((item) => item.code);
      expect(issueCodes).toContain("transaction.prepare.invalid_hex");
    });
  });

  describe("gas estimation", () => {
    it("captures estimate input arguments for gas estimation", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0xa");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({
        maxFeePerGas: "0x59682f00",
        maxPriorityFeePerGas: "0x3b9aca00",
      });

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      await prepareTransaction(ctx);

      expect(rpc.estimateGas).toHaveBeenCalledWith([
        {
          from: TEST_ADDRESSES.FROM_A,
          to: TEST_ADDRESSES.TO_B,
          value: TEST_VALUES.ONE_ETH,
          data: TEST_VALUES.EMPTY_DATA,
        },
      ]);
    });

    it("flags zero gas estimate from RPC", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x0");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const prepared = await prepareTransaction(ctx);

      expect(prepared.issues.map((item) => item.code)).toContain("transaction.prepare.gas_zero");
      expect(prepared.prepared.gas).toBe("0x0");
    });

    it("warns when gas estimate is suspiciously high", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5f5e100");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const prepared = await prepareTransaction(ctx);

      expect(prepared.warnings.map((item) => item.code)).toContain("transaction.prepare.gas_suspicious");
      expect(prepared.prepared.gas).toBe("0x5f5e100");
      const warning = prepared.warnings.find((item) => item.code === "transaction.prepare.gas_suspicious");
      expect(warning?.data).toEqual({ estimate: "0x5f5e100" });
    });
  });
});
