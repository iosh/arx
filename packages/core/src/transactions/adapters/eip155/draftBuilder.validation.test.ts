import { describe, expect, it, vi } from "vitest";
import { TEST_ADDRESSES, TEST_CHAINS } from "./__fixtures__/constants.js";
import { createAdapterContext, createEip155Request, createTransactionMeta } from "./__fixtures__/contexts.js";
import { createTestDraftBuilder } from "./__fixtures__/draftBuilder.js";
import { createEip155RpcMock } from "./__mocks__/rpc.js";

describe("draftBuilder - validation", () => {
  describe("namespace validation", () => {
    it("rejects requests from non-eip155 namespace", async () => {
      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn() });
      const ctx = createAdapterContext({ namespace: "conflux" });

      await expect(builder(ctx)).rejects.toThrow(/eip155/);
    });
  });

  describe("from address validation", () => {
    it("reports issue when from is missing", async () => {
      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => createEip155RpcMock().client) });

      const request = createEip155Request();
      Reflect.deleteProperty(request.payload, "from");
      const ctx = createAdapterContext({
        request,
        meta: createTransactionMeta(request),
        from: undefined as unknown as string,
      });

      const draft = await builder(ctx);
      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.from_missing");
    });

    it("reports issue when from address is invalid", async () => {
      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => createEip155RpcMock().client) });

      const ctx = createAdapterContext();
      ctx.request.payload.from = "0xINVALID" as unknown as `0x${string}`;
      ctx.from = "0xINVALID" as unknown as string;
      ctx.meta.request = ctx.request;

      const draft = await builder(ctx);
      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.from_invalid");
    });

    it("records mismatch detail when payload from differs from active account", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });
      const ctx = createAdapterContext();
      ctx.request.payload.from = TEST_ADDRESSES.TO_B;
      ctx.meta.request = ctx.request;

      const draft = await builder(ctx);
      const mismatch = draft.issues.find((item) => item.code === "transaction.draft.from_mismatch");

      expect(mismatch?.data).toEqual({
        payloadFrom: TEST_ADDRESSES.TO_B,
        activeFrom: TEST_ADDRESSES.FROM_A,
      });
    });

    it("fills from using active account when payload omits it", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const request = createEip155Request();
      Reflect.deleteProperty(request.payload, "from");

      const ctx = createAdapterContext({
        from: TEST_ADDRESSES.MIXED_CASE,
        request,
        meta: createTransactionMeta(request),
      });
      ctx.meta.from = TEST_ADDRESSES.MIXED_CASE;

      const draft = await builder(ctx);

      expect(draft.issues).toHaveLength(0);
      expect(draft.prepared.from).toBe(TEST_ADDRESSES.MIXED_CASE.toLowerCase());
      expect(draft.summary.from).toBe(TEST_ADDRESSES.MIXED_CASE);
      expect(rpc.getTransactionCount).toHaveBeenCalledWith(TEST_ADDRESSES.MIXED_CASE.toLowerCase(), "pending");
    });
  });

  describe("to address validation", () => {
    it("reports issue when to address is invalid", async () => {
      const rpc = createEip155RpcMock();
      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      ctx.request.payload.to = "0x123" as unknown as `0x${string}`;
      ctx.meta.request = ctx.request;

      const draft = await builder(ctx);
      expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.to_invalid");
    });
  });

  describe("chainId validation", () => {
    it("flags chainId mismatch and from mismatch in issues", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

      const builder = createTestDraftBuilder({
        rpcClientFactory: vi.fn(() => rpc.client),
        now: () => 2_000,
      });

      const ctx = createAdapterContext({
        chainRef: TEST_CHAINS.MAINNET,
        from: TEST_ADDRESSES.FROM_A,
      });

      ctx.request.payload.from = TEST_ADDRESSES.TO_B;
      ctx.request.payload.chainId = "0x2";
      ctx.meta.request = ctx.request;

      const draft = await builder(ctx);
      expect(draft.issues.map((item) => item.code)).toEqual(
        expect.arrayContaining(["transaction.draft.from_mismatch", "transaction.draft.chain_id_mismatch"]),
      );
      expect(draft.summary.expectedChainId).toBe(TEST_CHAINS.MAINNET_CHAIN_ID);
    });

    it("warns when chainId is missing", async () => {
      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => createEip155RpcMock().client) });

      const ctx = createAdapterContext();
      Reflect.deleteProperty(ctx.request.payload, "chainId");
      ctx.meta.request = ctx.request;

      const draft = await builder(ctx);

      expect(draft.warnings.map((item) => item.code)).toContain("transaction.draft.chain_id_missing");
      expect(draft.summary.expectedChainId).toBe(TEST_CHAINS.MAINNET_CHAIN_ID);
      expect(draft.summary.chainId).toBeUndefined();
    });

    it("retains normalized chainId when payload matches expected chain", async () => {
      const builder = createTestDraftBuilder({
        rpcClientFactory: vi.fn(() => createEip155RpcMock().client),
        now: () => 42_000,
      });

      const ctx = createAdapterContext();
      ctx.request.payload.chainId = TEST_CHAINS.MAINNET_CHAIN_ID;
      ctx.meta.request = ctx.request;

      const draft = await builder(ctx);

      expect(draft.summary.chainId).toBe(TEST_CHAINS.MAINNET_CHAIN_ID);
      expect(draft.summary.generatedAt).toBe(42_000);
      expect(draft.summary.expectedChainId).toBe(TEST_CHAINS.MAINNET_CHAIN_ID);
    });

    it("omits expectedChainId when chain reference is non-numeric", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");
      rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

      const builder = createTestDraftBuilder({
        rpcClientFactory: vi.fn(() => rpc.client),
        now: () => 123_456,
      });

      const request = createEip155Request();
      request.caip2 = "eip155:mainnet";
      request.payload.chainId = TEST_CHAINS.MAINNET_CHAIN_ID;

      const ctx = createAdapterContext({
        chainRef: "eip155:mainnet",
        request,
        meta: createTransactionMeta(request),
      });

      const draft = await builder(ctx);

      expect(draft.summary.namespace).toBe("eip155");
      expect(draft.summary.chainRef).toBe("eip155:mainnet");
      expect(draft.summary.expectedChainId).toBeUndefined();
      expect(draft.summary.generatedAt).toBe(123_456);
    });
  });

  describe("hex field validation", () => {
    it("flags invalid hex quantities and data", async () => {
      const rpc = createEip155RpcMock();
      const builder = createTestDraftBuilder({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createAdapterContext();
      (ctx.request.payload as Record<string, unknown>).value = "1000";
      (ctx.request.payload as Record<string, unknown>).gas = "0xZZ";
      (ctx.request.payload as Record<string, unknown>).nonce = "0x1G";
      (ctx.request.payload as Record<string, unknown>).data = "0x123";
      ctx.meta.request = ctx.request;

      const draft = await builder(ctx);
      const issueCodes = draft.issues.map((item) => item.code);

      expect(issueCodes.filter((code) => code === "transaction.draft.invalid_hex")).toHaveLength(3);
      expect(issueCodes).toContain("transaction.draft.invalid_data");
    });
  });
});
