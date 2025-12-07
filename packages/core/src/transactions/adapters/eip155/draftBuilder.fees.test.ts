import { describe, expect, it, vi } from "vitest";
import { createAdapterContext } from "./__fixtures__/contexts.js";
import { createTestDraftBuilder } from "./__fixtures__/draftBuilder.js";
import { createEip155RpcMock } from "./__mocks__/rpc.js";

describe("draftBuilder - fees", () => {
  describe("legacy fees", () => {
    it("uses legacy gasPrice when provided", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.gasPrice = "0x3b9aca00";

      const draft = await builder(ctx);

      expect(draft.summary.feeMode).toBe("legacy");
      expect(draft.prepared.gasPrice).toBe("0x3b9aca00");
      expect(rpc.getFeeData).not.toHaveBeenCalled();
    });

    it("forwards gasPrice to RPC gas estimation when provided", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x2");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");
      ctx.request.payload.gasPrice = "0x2540be400";

      await builder(ctx);

      expect(rpc.estimateGas).toHaveBeenCalledWith([
        expect.objectContaining({
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          gasPrice: "0x2540be400",
        }),
      ]);
    });

    it("falls back to legacy fee data when RPC only returns gasPrice", async () => {
      const rpc = createEip155RpcMock();
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gasPrice");
      Reflect.deleteProperty(ctx.request.payload, "maxFeePerGas");
      Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

      const draft = await builder(ctx);

      expect(draft.summary.feeMode).toBe("legacy");
      expect(draft.prepared.gasPrice).toBe("0x3b9aca00");
    });
  });

  describe("EIP-1559 fees", () => {
    it("forwards eip1559 fees to RPC gas estimation when provided", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x3");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({
        maxFeePerGas: "0x59682f00",
        maxPriorityFeePerGas: "0x3b9aca00",
      });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");
      Reflect.deleteProperty(ctx.request.payload, "gasPrice");
      ctx.request.payload.maxFeePerGas = "0x59682f00";
      ctx.request.payload.maxPriorityFeePerGas = "0x3b9aca00";

      await builder(ctx);

      expect(rpc.estimateGas).toHaveBeenCalledWith([
        expect.objectContaining({
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          maxFeePerGas: "0x59682f00",
          maxPriorityFeePerGas: "0x3b9aca00",
        }),
      ]);
    });

    it("summarizes eip1559 fee fields provided in payload", async () => {
      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => createEip155RpcMock().client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gasPrice");
      ctx.request.payload.maxFeePerGas = "0x59682F00";
      ctx.request.payload.maxPriorityFeePerGas = "0x3B9ACA00";

      const draft = await builder(ctx);

      expect(draft.summary.feeMode).toBe("eip1559");
      expect(draft.summary.fee).toEqual({
        mode: "eip1559",
        maxFeePerGas: "0x59682f00",
        maxPriorityFeePerGas: "0x3b9aca00",
      });
      expect(draft.prepared.maxFeePerGas).toBe("0x59682f00");
      expect(draft.prepared.maxPriorityFeePerGas).toBe("0x3b9aca00");
    });

    it("detects incomplete EIP-1559 fee pair", async () => {
      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => createEip155RpcMock().client) });

      const ctx = createAdapterContext();
      ctx.request.payload.maxFeePerGas = "0x59682f00";
      Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

      const draft = await builder(ctx);

      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.fee_pair_incomplete");
    });
  });

  describe("fee conflicts", () => {
    it("detects fee conflict when mixing gasPrice with EIP-1559 fields", async () => {
      const rpc = createEip155RpcMock();

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.gasPrice = "0x3b9aca00";
      ctx.request.payload.maxFeePerGas = "0x59682f00";

      const draft = await builder(ctx);

      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.fee_conflict");
    });

    it("keeps feeMode unknown when fee fields conflict", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.gasPrice = "0x3b9aca00";
      ctx.request.payload.maxFeePerGas = "0x59682f00";
      ctx.request.payload.maxPriorityFeePerGas = "0x3b9aca00";

      const draft = await builder(ctx);

      expect(draft.summary.feeMode).toBe("unknown");
      expect(draft.summary.fee).toBeUndefined();
      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.fee_conflict");
    });
  });

  describe("fee estimation errors", () => {
    it("reports fee_estimation_empty when RPC returns no fee data", async () => {
      const rpc = createEip155RpcMock();
      rpc.getFeeData.mockResolvedValue({});
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gasPrice");
      Reflect.deleteProperty(ctx.request.payload, "maxFeePerGas");
      Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

      const draft = await builder(ctx);

      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.fee_estimation_empty");
    });

    it("includes rpc metadata on fee_estimation_empty issue", async () => {
      const rpc = createEip155RpcMock();
      rpc.getFeeData.mockResolvedValue({});
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gasPrice");
      Reflect.deleteProperty(ctx.request.payload, "maxFeePerGas");
      Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

      const draft = await builder(ctx);
      const issue = draft.issues.find((item) => item.code === "transaction.draft.fee_estimation_empty");

      expect(issue?.data).toEqual({
        method: "eth_getBlockByNumber | eth_gasPrice",
      });
      expect(draft.summary.feeMode).toBe("unknown");
    });

    it("attaches rpc error details when fee estimation fails", async () => {
      const rpc = createEip155RpcMock();
      rpc.getFeeData.mockRejectedValue(new Error("fee rpc down"));
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gasPrice");
      Reflect.deleteProperty(ctx.request.payload, "maxFeePerGas");
      Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

      const draft = await builder(ctx);
      const issue = draft.issues.find((item) => item.code === "transaction.draft.fee_estimation_failed");

      expect(issue?.data).toMatchObject({
        method: "eth_feeHistory | eth_gasPrice",
        error: "fee rpc down",
      });
      expect(draft.summary.fee).toBeUndefined();
      expect(draft.summary.feeMode).toBe("unknown");
    });
  });

  describe("cost calculation", () => {
    it("calculates maxCostWei including value transfers", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.value = "0xde0b6b3a7640000";

      const draft = await builder(ctx);
      const expected = (BigInt("0x5208") * BigInt("0x3b9aca00") + BigInt("0xde0b6b3a7640000")).toString(10);

      expect(draft.summary.maxCostWei).toBe(expected);
    });

    it("exposes maxCostHex when total cost is available", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({
        maxFeePerGas: "0x59682f00",
        maxPriorityFeePerGas: "0x3b9aca00",
      });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      const draft = await builder(ctx);

      const valueHex = (ctx.request.payload.value ?? "0x0") as `0x${string}`;
      const expectedWei = (BigInt("0x5208") * BigInt("0x59682f00") + BigInt(valueHex)).toString(10);
      const expectedHex = `0x${BigInt(expectedWei).toString(16)}`;

      expect(draft.summary.maxCostWei).toBe(expectedWei);
      expect(draft.summary.maxCostHex).toBe(expectedHex);
    });

    it("leaves maxCost fields undefined when gas data cannot be derived", async () => {
      const builder = createTestDraftBuilder({
        rpcClientFactory: vi.fn(() => {
          throw new Error("rpc offline");
        }),
      });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "gas");
      Reflect.deleteProperty(ctx.request.payload, "gasPrice");
      Reflect.deleteProperty(ctx.request.payload, "maxFeePerGas");
      Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");
      Reflect.deleteProperty(ctx.request.payload, "value");

      const draft = await builder(ctx);

      expect(draft.summary.maxCostWei).toBeUndefined();
      expect(draft.summary.maxCostHex).toBeUndefined();
      expect(draft.summary.rpcAvailable).toBe(false);
      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.rpc_unavailable");
    });
  });
});
