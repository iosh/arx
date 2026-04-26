import { describe, expect, it, vi } from "vitest";
import { TEST_ADDRESSES, TEST_CHAINS } from "./__fixtures__/constants.js";
import { createEip155Request, createPrepareContext } from "./__fixtures__/contexts.js";
import {
  createTestPrepareTransaction,
  requirePartialPrepared,
  requireReadyPrepared,
} from "./__fixtures__/prepareTransaction.js";
import { createEip155RpcClient, createEip155RpcMock } from "./__mocks__/rpc.js";

describe("prepareTransaction - validation", () => {
  describe("namespace validation", () => {
    it("rejects requests from non-eip155 namespace", async () => {
      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn() });
      const ctx = createPrepareContext({ namespace: "conflux" });

      await expect(prepareTransaction(ctx)).rejects.toThrow(/eip155/);
    });
  });

  describe("from address validation", () => {
    it("returns blocked when from is missing", async () => {
      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => createEip155RpcClient()),
      });

      const request = createEip155Request();
      Reflect.deleteProperty(request.payload, "from");
      const ctx = createPrepareContext({
        request,
        from: null,
      });

      const result = await prepareTransaction(ctx);
      expect(result.status).toBe("blocked");
      expect(result.status === "blocked" ? result.blocker.reason : null).toBe("transaction.prepare.from_missing");
    });

    it("returns blocked when from address is invalid", async () => {
      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => createEip155RpcClient()),
      });

      const ctx = createPrepareContext();
      ctx.request.payload.from = "0xINVALID" as unknown as `0x${string}`;
      ctx.from = "0xINVALID" as unknown as string;

      const result = await prepareTransaction(ctx);
      expect(result.status).toBe("blocked");
      expect(result.status === "blocked" ? result.blocker.reason : null).toBe("transaction.prepare.from_invalid");
    });

    it("records mismatch detail when payload from differs from active account", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });
      const ctx = createPrepareContext();
      ctx.request.payload.from = TEST_ADDRESSES.TO_B;

      const result = await prepareTransaction(ctx);

      expect(result.status).toBe("blocked");
      expect(result.status === "blocked" ? result.blocker.reason : null).toBe("transaction.prepare.from_mismatch");
      expect(result.status === "blocked" ? result.blocker.data : null).toEqual({
        payloadFrom: TEST_ADDRESSES.TO_B,
        activeFrom: TEST_ADDRESSES.FROM_A,
      });
    });

    it("fills from using active account when payload omits it", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const request = createEip155Request();
      Reflect.deleteProperty(request.payload, "from");

      const ctx = createPrepareContext({
        from: TEST_ADDRESSES.MIXED_CASE,
        request,
      });

      const result = await prepareTransaction(ctx);
      const prepared = requireReadyPrepared(result);

      expect(prepared.from).toBe(TEST_ADDRESSES.MIXED_CASE.toLowerCase());
      expect(rpc.getTransactionCount).toHaveBeenCalledWith(
        TEST_ADDRESSES.MIXED_CASE.toLowerCase(),
        expect.objectContaining({ blockTag: "pending" }),
      );
    });
  });

  describe("to address validation", () => {
    it("returns blocked when to address is invalid", async () => {
      const rpc = createEip155RpcMock();
      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext();
      ctx.request.payload.to = "0x123" as unknown as `0x${string}`;

      const result = await prepareTransaction(ctx);
      expect(result.status).toBe("blocked");
      expect(result.status === "blocked" ? result.blocker.reason : null).toBe("transaction.prepare.to_invalid");
    });
  });

  describe("chainId validation", () => {
    it("does not report chainId mismatch in prepare result", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => rpc.client),
      });

      const ctx = createPrepareContext({
        chainRef: TEST_CHAINS.MAINNET,
        from: TEST_ADDRESSES.FROM_A,
      });

      ctx.request.payload.from = TEST_ADDRESSES.TO_B;
      ctx.request.payload.chainId = "0x2";

      const result = await prepareTransaction(ctx);
      const prepared = requirePartialPrepared(result);

      expect(result.status).toBe("blocked");
      expect(result.status === "blocked" ? result.blocker.reason : null).toBe("transaction.prepare.from_mismatch");
      expect(prepared.chainId).toBeUndefined();
    });

    it("allows missing chainId without a generic warning", async () => {
      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => createEip155RpcClient()),
      });

      const ctx = createPrepareContext();
      Reflect.deleteProperty(ctx.request.payload, "chainId");

      const result = await prepareTransaction(ctx);

      expect(result.status).toBe("ready");
    });

    it("retains normalized chainId when payload matches expected chain", async () => {
      const prepareTransaction = createTestPrepareTransaction({
        rpcClientFactory: vi.fn(() => createEip155RpcClient()),
      });

      const ctx = createPrepareContext();
      ctx.request.payload.chainId = TEST_CHAINS.MAINNET_CHAIN_ID;

      const result = await prepareTransaction(ctx);
      const prepared = requireReadyPrepared(result);

      expect(prepared.chainId).toBe(TEST_CHAINS.MAINNET_CHAIN_ID);
    });

    it("omits expectedChainId when chain reference is non-numeric", async () => {
      const rpc = createEip155RpcMock();
      rpc.getTransactionCount.mockResolvedValue("0x1");
      rpc.estimateGas.mockResolvedValue("0x5208");

      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const request = createEip155Request();
      request.chainRef = "eip155:mainnet";
      request.payload.chainId = TEST_CHAINS.MAINNET_CHAIN_ID;

      const ctx = createPrepareContext({
        chainRef: "eip155:mainnet",
        request,
      });

      const result = await prepareTransaction(ctx);
      const prepared = requireReadyPrepared(result);

      expect(prepared.chainId).toBe(TEST_CHAINS.MAINNET_CHAIN_ID);
    });
  });

  describe("hex field validation", () => {
    it("flags invalid hex quantities and data", async () => {
      const rpc = createEip155RpcMock();
      const prepareTransaction = createTestPrepareTransaction({ rpcClientFactory: vi.fn(() => rpc.client) });

      const ctx = createPrepareContext();
      (ctx.request.payload as Record<string, unknown>).value = "1000";
      (ctx.request.payload as Record<string, unknown>).gas = "0xZZ";
      (ctx.request.payload as Record<string, unknown>).nonce = "0x1G";
      (ctx.request.payload as Record<string, unknown>).data = "0x123";

      const result = await prepareTransaction(ctx);

      expect(result.status).toBe("failed");
      expect(result.status === "failed" ? result.error.reason : null).toBe("transaction.prepare.invalid_hex");
    });
  });
});
