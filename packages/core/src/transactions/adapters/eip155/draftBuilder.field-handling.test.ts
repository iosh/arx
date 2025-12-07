import { describe, expect, it, vi } from "vitest";
import { TEST_ADDRESSES } from "./__fixtures__/constants.js";
import { createAdapterContext } from "./__fixtures__/contexts.js";
import { createTestDraftBuilder } from "./__fixtures__/draftBuilder.js";
import { createEip155RpcMock } from "./__mocks__/rpc.js";

describe("draftBuilder - field handling", () => {
  describe("hex normalization", () => {
    it("normalizes provided hex fields to lowercase", async () => {
      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => createEip155RpcMock().client) });

      const ctx = createAdapterContext();
      ctx.request.payload.value = "0xDE0B6B3A7640000";
      ctx.request.payload.gas = "0x5208";
      ctx.request.payload.gasPrice = "0x3B9ACA00";
      ctx.request.payload.nonce = "0xA";

      const draft = await builder(ctx);

      expect(draft.prepared.value).toBe("0xde0b6b3a7640000");
      expect(draft.prepared.gas).toBe("0x5208");
      expect(draft.prepared.gasPrice).toBe("0x3b9aca00");
      expect(draft.prepared.nonce).toBe("0xa");
      expect(draft.summary.valueHex).toBe("0xde0b6b3a7640000");
      expect(draft.summary.valueWei).toBe("1000000000000000000");
    });

    it("normalizes payload data field to lowercase hex", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.data = "0xABCD";

      const draft = await builder(ctx);

      expect(draft.prepared.data).toBe("0xabcd");
      expect(draft.summary.data).toBe("0xabcd");
      expect(draft.summary.callParams).toMatchObject({
        data: "0xabcd",
      });
    });
  });

  describe("zero and empty values", () => {
    it("handles zero value and empty data", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.value = "0x0";
      ctx.request.payload.data = "0x";
      ctx.meta.request = ctx.request;

      const draft = await builder(ctx);

      expect(draft.prepared.value).toBe("0x0");
      expect(draft.prepared.data).toBe("0x");
      expect(draft.issues).toHaveLength(0);
    });
  });

  describe("contract deployment", () => {
    it("supports contract deployment payloads", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x30000");

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.to = null;
      ctx.request.payload.data = "0x60006000";

      const draft = await builder(ctx);

      expect(draft.prepared.to).toBeNull();
      expect(draft.summary.to).toBeNull();
    });

    it("omits to field in callParams when deploying contracts", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x35000");
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.to = null;
      ctx.request.payload.data = "0x60006000";

      const draft = await builder(ctx);

      expect(draft.summary.callParams).toMatchObject({
        from: TEST_ADDRESSES.FROM_A,
        data: "0x60006000",
        value: "0xde0b6b3a7640000",
      });
      expect(draft.summary.callParams).not.toHaveProperty("to");
    });
  });
});
