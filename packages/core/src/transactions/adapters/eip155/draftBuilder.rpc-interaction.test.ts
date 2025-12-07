import { describe, expect, it, vi } from "vitest";
import { TEST_ADDRESSES, TEST_VALUES } from "./__fixtures__/constants.js";
import { createAdapterContext } from "./__fixtures__/contexts.js";
import { createTestDraftBuilder } from "./__fixtures__/draftBuilder.js";
import { createEip155RpcMock } from "./__mocks__/rpc.js";

describe("draftBuilder - RPC interaction", () => {
  describe("RPC data fetching", () => {
    it("fills nonce, gas, and EIP-1559 fees from RPC responses", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0xa");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({
        maxFeePerGas: "0x59682f00",
        maxPriorityFeePerGas: "0x3b9aca00",
      });

      const builder = createTestDraftBuilder({
        rpcClientFactory: vi.fn(() => rpc.client),
        now: () => 5_000,
      });

      const ctx = createAdapterContext();
      const draft = await builder(ctx);

      expect(draft.prepared.nonce).toBe("0xa");
      expect(draft.prepared.gas).toBe("0x5208");
      expect(draft.prepared.maxFeePerGas).toBe("0x59682f00");
      expect(draft.prepared.maxPriorityFeePerGas).toBe("0x3b9aca00");
      expect(draft.summary.feeMode).toBe("eip1559");

      const gasCost = BigInt("0x5208") * BigInt("0x59682f00");
      const valueWei = BigInt(TEST_VALUES.ONE_ETH);
      const expectedMaxCost = (gasCost + valueWei).toString(10);

      expect(draft.summary.maxCostWei).toBe(expectedMaxCost);
      expect(draft.summary.rpcAvailable).toBe(true);
      expect(draft.summary.callParams).toMatchObject({
        from: TEST_ADDRESSES.FROM_A,
        to: TEST_ADDRESSES.TO_B,
      });
    });

    it("passes derived nonce to gas estimation when fetched from RPC", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0xb");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({
        maxFeePerGas: "0x59682f00",
        maxPriorityFeePerGas: "0x3b9aca00",
      });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "nonce");
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const draft = await builder(ctx);

      expect(rpc.getTransactionCount).toHaveBeenCalledWith(TEST_ADDRESSES.FROM_A, "pending");
      expect(rpc.estimateGas).toHaveBeenCalledWith([
        expect.objectContaining({
          nonce: "0xb",
        }),
      ]);
      expect(draft.summary.nonce).toBe("0xb");
    });

    it("skips nonce/gas RPC calls when values already provided", async () => {
      const rpc = createEip155RpcMock();

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.nonce = "0xa";
      ctx.request.payload.gas = "0x5208";
      ctx.request.payload.gasPrice = "0x3b9aca00";

      await builder(ctx);

      expect(rpc.getTransactionCount).not.toHaveBeenCalled();
      expect(rpc.estimateGas).not.toHaveBeenCalled();
    });

    it("does not run RPC lookups when from address is unavailable", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext({ from: null });
      Reflect.deleteProperty(ctx.request.payload, "from");
      ctx.meta.from = null;
      ctx.meta.request = ctx.request;

      const draft = await builder(ctx);

      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.from_missing");
      expect(rpc.getTransactionCount).not.toHaveBeenCalled();
      expect(rpc.estimateGas).toHaveBeenCalledWith([
        {
          to: TEST_ADDRESSES.TO_B,
          value: TEST_VALUES.ONE_ETH,
          data: TEST_VALUES.EMPTY_DATA,
        },
      ]);
      expect(draft.summary.callParams).not.toHaveProperty("from");
    });
  });

  describe("RPC error handling", () => {
    it("records issues when RPC estimation fails", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockRejectedValue(new Error("nonce error"));
      rpc.estimateGas.mockRejectedValue(new Error("estimate error"));
      rpc.getFeeData.mockRejectedValue(new Error("fee error"));

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      const draft = await builder(ctx);

      expect(draft.issues.map((item) => item.code)).toEqual(
        expect.arrayContaining([
          "transaction.draft.nonce_failed",
          "transaction.draft.gas_estimation_failed",
          "transaction.draft.fee_estimation_failed",
        ]),
      );
      expect(draft.summary.rpcAvailable).toBe(true);
    });

    it("attaches rpc error metadata when nonce fetch fails", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockRejectedValue(new Error("RPC nonce failure"));
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "nonce");

      const draft = await builder(ctx);
      const nonceIssue = draft.issues.find((item) => item.code === "transaction.draft.nonce_failed");

      expect(nonceIssue).toBeTruthy();
      expect(nonceIssue?.data).toMatchObject({
        method: "eth_getTransactionCount",
        error: "RPC nonce failure",
      });
    });

    it("records estimate input even when gas estimation throws", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x5");
      rpc.estimateGas.mockRejectedValue(new Error("boom"));
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const draft = await builder(ctx);
      const gasIssue = draft.issues.find((item) => item.code === "transaction.draft.gas_estimation_failed");

      expect(gasIssue?.data).toMatchObject({
        method: "eth_estimateGas",
        error: "boom",
      });
      expect(draft.summary.estimateInput).toMatchObject({
        from: TEST_ADDRESSES.FROM_A,
        to: TEST_ADDRESSES.TO_B,
      });
    });

    it("flags rpc_unavailable when client factory throws", async () => {
      const builder = createTestDraftBuilder({
        rpcClientFactory: vi.fn(() => {
          throw new Error("boom");
        }),
      });

      const ctx = createAdapterContext();
      const draft = await builder(ctx);

      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.rpc_unavailable");
      expect(draft.summary.rpcAvailable).toBe(false);
    });

    it("reports invalid hex when RPC nonce response is malformed", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "nonce");

      const draft = await builder(ctx);

      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.invalid_hex");
      expect(draft.summary.nonce).toBeUndefined();
    });

    it("reports invalid hex when RPC gas response is malformed", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("21000");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const draft = await builder(ctx);

      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.invalid_hex");
      expect(draft.summary.gas).toBeUndefined();
    });

    it("records invalid_hex when RPC fee data is malformed", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({
        maxFeePerGas: "123",
        maxPriorityFeePerGas: "0xGG",
      });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const draft = await builder(createAdapterContext());

      const issueCodes = draft.issues.map((item) => item.code);
      expect(issueCodes).toContain("transaction.draft.invalid_hex");
      expect(draft.summary.feeMode).toBe("unknown");
      expect(draft.summary.fee).toBeUndefined();
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

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      const draft = await builder(ctx);

      expect(draft.summary.estimateInput).toEqual({
        from: TEST_ADDRESSES.FROM_A,
        to: TEST_ADDRESSES.TO_B,
        value: TEST_VALUES.ONE_ETH,
        data: TEST_VALUES.EMPTY_DATA,
        nonce: "0xa",
      });
    });

    it("flags zero gas estimate from RPC", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x0");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const draft = await builder(ctx);

      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.gas_zero");
      expect(draft.summary.gas).toBe("0x0");
    });

    it("warns when gas estimate is suspiciously high", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5f5e100");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");

      const draft = await builder(ctx);

      expect(draft.warnings.map((item) => item.code)).toContain("transaction.draft.gas_suspicious");
      expect(draft.summary.gas).toBe("0x5f5e100");
      const warning = draft.warnings.find((item) => item.code === "transaction.draft.gas_suspicious");
      expect(warning?.data).toEqual({ estimate: "0x5f5e100" });
    });
  });
});
