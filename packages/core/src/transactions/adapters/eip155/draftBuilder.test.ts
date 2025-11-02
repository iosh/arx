import { describe, expect, it, vi } from "vitest";
import type { Eip155TransactionPayload, TransactionMeta } from "../../../controllers/transaction/types.js";
import type { Eip155RpcCapabilities } from "../../../rpc/clients/eip155/eip155.js";
import type { TransactionAdapterContext } from "../types.js";
import { createEip155DraftBuilder } from "./draftBuilder.js";

const BASE_FROM = "0x1111111111111111111111111111111111111111" as const;
const BASE_TO = "0x2222222222222222222222222222222222222222" as const;

const createRequest = (): TransactionAdapterContext["request"] => ({
  namespace: "eip155",
  caip2: "eip155:1",
  payload: {
    from: BASE_FROM,
    to: BASE_TO,
    value: "0xde0b6b3a7640000",
    data: "0x",
    chainId: "0x1",
  } satisfies Eip155TransactionPayload,
});

const createMeta = (request: TransactionAdapterContext["request"]): TransactionMeta => ({
  id: "tx-1",
  namespace: "eip155",
  caip2: "eip155:1",
  origin: "https://dapp.example",
  from: BASE_FROM,
  request,
  status: "pending",
  hash: null,
  receipt: null,
  error: null,
  userRejected: false,
  warnings: [],
  issues: [],
  createdAt: 1_000,
  updatedAt: 1_000,
});

const createContext = (overrides: Partial<TransactionAdapterContext> = {}): TransactionAdapterContext => {
  const request = overrides.request ?? createRequest();
  const meta = overrides.meta ?? createMeta(request);

  return {
    namespace: "eip155",
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    from: BASE_FROM,
    meta,
    request,
    ...overrides,
  };
};

const createRpcMock = () => {
  const estimateGas = vi.fn();
  const getTransactionCount = vi.fn();
  const getFeeData = vi.fn();
  const getTransactionReceipt = vi.fn();
  const sendRawTransaction = vi.fn();

  const client: Eip155RpcCapabilities = {
    estimateGas: estimateGas as unknown as Eip155RpcCapabilities["estimateGas"],
    getTransactionCount: getTransactionCount as unknown as Eip155RpcCapabilities["getTransactionCount"],
    getFeeData: getFeeData as unknown as Eip155RpcCapabilities["getFeeData"],
    getTransactionReceipt: getTransactionReceipt as unknown as Eip155RpcCapabilities["getTransactionReceipt"],
    sendRawTransaction: sendRawTransaction as unknown as Eip155RpcCapabilities["sendRawTransaction"],
  };

  return { client, estimateGas, getTransactionCount, getFeeData, getTransactionReceipt, sendRawTransaction };
};
describe("createEip155DraftBuilder", () => {
  it("rejects requests from non-eip155 namespace", async () => {
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(),
    });

    const ctx = createContext({ namespace: "conflux" });
    await expect(builder(ctx)).rejects.toThrow(/eip155/);
  });

  it("flags chainId mismatch and from mismatch in issues", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc),
      now: () => 2_000,
    });

    const ctx = createContext({
      chainRef: "eip155:1",
      from: BASE_FROM,
    });

    ctx.request.payload.from = BASE_TO; // trigger from mismatch
    ctx.request.payload.chainId = "0x2"; // trigger chainId mismatch
    ctx.meta.request = ctx.request;

    const draft = await builder(ctx);
    expect(draft.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["transaction.draft.from_mismatch", "transaction.draft.chain_id_mismatch"]),
    );
    expect(draft.summary.expectedChainId).toBe("0x1");
  });

  it("fills nonce, gas, and EIP-1559 fees from RPC responses", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0xa");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({
      maxFeePerGas: "0x59682f00",
      maxPriorityFeePerGas: "0x3b9aca00",
    });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc),
      now: () => 5_000,
    });

    const ctx = createContext();
    const draft = await builder(ctx);

    expect(draft.prepared.nonce).toBe("0xa");
    expect(draft.prepared.gas).toBe("0x5208");
    expect(draft.prepared.maxFeePerGas).toBe("0x59682f00");
    expect(draft.prepared.maxPriorityFeePerGas).toBe("0x3b9aca00");
    expect(draft.summary.feeMode).toBe("eip1559");

    const gasCost = BigInt("0x5208") * BigInt("0x59682f00");
    const rawValue = (ctx.request.payload.value ?? "0x0") as `0x${string}`;
    const valueWei = BigInt(rawValue);
    const expectedMaxCost = (gasCost + valueWei).toString(10);

    expect(draft.summary.maxCostWei).toBe(expectedMaxCost);

    expect(draft.summary.rpcAvailable).toBe(true);
    expect(draft.summary.callParams).toMatchObject({
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
    });
  });

  it("records issues when RPC estimation fails", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockRejectedValue(new Error("nonce error"));
    rpc.estimateGas.mockRejectedValue(new Error("estimate error"));
    rpc.getFeeData.mockRejectedValue(new Error("fee error"));

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc),
    });

    const ctx = createContext();
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

  it("flags rpc_unavailable when client factory throws", async () => {
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => {
        throw new Error("boom");
      }),
    });

    const ctx = createContext();
    const draft = await builder(ctx);

    expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.rpc_unavailable");
    expect(draft.summary.rpcAvailable).toBe(false);
  });

  it("uses legacy gasPrice when provided", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    ctx.request.payload.gasPrice = "0x3b9aca00";

    const draft = await builder(ctx);

    expect(draft.summary.feeMode).toBe("legacy");
    expect(draft.prepared.gasPrice).toBe("0x3b9aca00");
    expect(rpc.getFeeData).not.toHaveBeenCalled();
  });

  it("detects fee conflict when mixing gasPrice with EIP-1559 fields", async () => {
    const rpc = createRpcMock();

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    ctx.request.payload.gasPrice = "0x3b9aca00";
    ctx.request.payload.maxFeePerGas = "0x59682f00";

    const draft = await builder(ctx);

    expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.fee_conflict");
  });

  it("supports contract deployment payloads", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x30000");

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    ctx.request.payload.to = null;
    ctx.request.payload.data = "0x60006000"; // example bytecode

    const draft = await builder(ctx);

    expect(draft.prepared.to).toBeNull();
    expect(draft.summary.to).toBeNull();
  });

  it("skips nonce/gas RPC calls when values already provided", async () => {
    const rpc = createRpcMock();

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    ctx.request.payload.nonce = "0xa";
    ctx.request.payload.gas = "0x5208";
    ctx.request.payload.gasPrice = "0x3b9aca00";

    await builder(ctx);

    expect(rpc.getTransactionCount).not.toHaveBeenCalled();
    expect(rpc.estimateGas).not.toHaveBeenCalled();
  });

  it("calculates maxCostWei including value transfers", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    ctx.request.payload.value = "0xde0b6b3a7640000";

    const draft = await builder(ctx);
    const expected = (BigInt("0x5208") * BigInt("0x3b9aca00") + BigInt("0xde0b6b3a7640000")).toString(10);

    expect(draft.summary.maxCostWei).toBe(expected);
  });
});
