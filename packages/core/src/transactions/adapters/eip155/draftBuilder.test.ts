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

  it("records mismatch detail when payload from differs from active account", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    ctx.request.payload.from = BASE_TO;
    ctx.meta.request = ctx.request;

    const draft = await builder(ctx);
    const mismatch = draft.issues.find((item) => item.code === "transaction.draft.from_mismatch");

    expect(mismatch?.data).toEqual({
      payloadFrom: BASE_TO,
      activeFrom: BASE_FROM,
    });
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

  it("captures estimate input arguments for gas estimation", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0xa");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({
      maxFeePerGas: "0x59682f00",
      maxPriorityFeePerGas: "0x3b9aca00",
    });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    const draft = await builder(ctx);

    expect(draft.summary.estimateInput).toEqual({
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: "0xde0b6b3a7640000",
      data: "0x",
      nonce: "0xa",
    });
  });

  it("records invalid_hex when RPC fee data is malformed", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({
      maxFeePerGas: "123",
      maxPriorityFeePerGas: "0xGG",
    });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const draft = await builder(createContext());

    const issueCodes = draft.issues.map((item) => item.code);
    expect(issueCodes).toContain("transaction.draft.invalid_hex");
    expect(draft.summary.feeMode).toBe("unknown");
    expect(draft.summary.fee).toBeUndefined();
  });

  it("passes derived nonce to gas estimation when fetched from RPC", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0xb");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({
      maxFeePerGas: "0x59682f00",
      maxPriorityFeePerGas: "0x3b9aca00",
    });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    Reflect.deleteProperty(ctx.request.payload, "nonce");
    Reflect.deleteProperty(ctx.request.payload, "gas");

    const draft = await builder(ctx);

    expect(rpc.getTransactionCount).toHaveBeenCalledWith("0x1111111111111111111111111111111111111111", "pending");
    expect(rpc.estimateGas).toHaveBeenCalledWith([
      expect.objectContaining({
        nonce: "0xb",
      }),
    ]);
    expect(draft.summary.nonce).toBe("0xb");
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

  it("attaches rpc error metadata when nonce fetch fails", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockRejectedValue(new Error("RPC nonce failure"));
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
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
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x5");
    rpc.estimateGas.mockRejectedValue(new Error("boom"));
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    Reflect.deleteProperty(ctx.request.payload, "gas");

    const draft = await builder(ctx);
    const gasIssue = draft.issues.find((item) => item.code === "transaction.draft.gas_estimation_failed");

    expect(gasIssue?.data).toMatchObject({
      method: "eth_estimateGas",
      error: "boom",
    });
    expect(draft.summary.estimateInput).toMatchObject({
      from: BASE_FROM,
      to: BASE_TO,
    });
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

  it("forwards gasPrice to RPC gas estimation when provided", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x2");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    Reflect.deleteProperty(ctx.request.payload, "gas");
    ctx.request.payload.gasPrice = "0x2540be400"; // 10 gwei

    await builder(ctx);

    expect(rpc.estimateGas).toHaveBeenCalledWith([
      expect.objectContaining({
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        gasPrice: "0x2540be400",
      }),
    ]);
  });

  it("forwards eip1559 fees to RPC gas estimation when provided", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x3");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({
      maxFeePerGas: "0x59682f00",
      maxPriorityFeePerGas: "0x3b9aca00",
    });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
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

  it("normalizes provided hex fields to lowercase", async () => {
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => createRpcMock().client),
    });

    const ctx = createContext();
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

  it("summarizes eip1559 fee fields provided in payload", async () => {
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => createRpcMock().client),
    });

    const ctx = createContext();
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

  it("keeps feeMode unknown when fee fields conflict", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    ctx.request.payload.gasPrice = "0x3b9aca00";
    ctx.request.payload.maxFeePerGas = "0x59682f00";
    ctx.request.payload.maxPriorityFeePerGas = "0x3b9aca00";

    const draft = await builder(ctx);

    expect(draft.summary.feeMode).toBe("unknown");
    expect(draft.summary.fee).toBeUndefined();
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

  it("omits to field in callParams when deploying contracts", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x35000");
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    ctx.request.payload.to = null;
    ctx.request.payload.data = "0x60006000";

    const draft = await builder(ctx);

    expect(draft.summary.callParams).toMatchObject({
      from: "0x1111111111111111111111111111111111111111",
      data: "0x60006000",
      value: "0xde0b6b3a7640000",
    });
    expect(draft.summary.callParams).not.toHaveProperty("to");
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

  it("leaves maxCost fields undefined when gas data cannot be derived", async () => {
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => {
        throw new Error("rpc offline");
      }),
    });

    const ctx = createContext();
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

  it("reports issue when from is missing", async () => {
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => createRpcMock().client),
    });

    const request = createRequest();
    Reflect.deleteProperty(request.payload, "from");
    const ctx = createContext({
      request,
      meta: createMeta(request),
      from: undefined as unknown as string,
    });

    const draft = await builder(ctx);

    expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.from_missing");
  });

  it("does not run RPC lookups when from address is unavailable", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const request = createRequest();
    Reflect.deleteProperty(request.payload, "from");

    const ctx = createContext({
      from: null,
      request,
      meta: createMeta(request),
    });
    ctx.meta.from = null;

    const draft = await builder(ctx);

    expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.from_missing");
    expect(rpc.getTransactionCount).not.toHaveBeenCalled();
    expect(rpc.estimateGas).toHaveBeenCalledWith([
      {
        to: "0x2222222222222222222222222222222222222222",
        value: "0xde0b6b3a7640000",
        data: "0x",
      },
    ]);
    expect(draft.summary.callParams).not.toHaveProperty("from");
  });

  it("normalizes payload data field to lowercase hex", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    ctx.request.payload.data = "0xABCD";

    const draft = await builder(ctx);

    expect(draft.prepared.data).toBe("0xabcd");
    expect(draft.summary.data).toBe("0xabcd");
    expect(draft.summary.callParams).toMatchObject({
      data: "0xabcd",
    });
  });

  it("reports issue when to address is invalid", async () => {
    const rpc = createRpcMock();
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    ctx.request.payload.to = "0x123" as unknown as `0x${string}`;
    ctx.meta.request = ctx.request;

    const draft = await builder(ctx);

    expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.to_invalid");
  });

  it("flags invalid hex quantities and data", async () => {
    const rpc = createRpcMock();
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
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

  it("reports issue when from address is invalid", async () => {
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => createRpcMock().client),
    });

    const ctx = createContext();
    ctx.request.payload.from = "0xINVALID" as unknown as `0x${string}`;
    ctx.from = "0xINVALID" as unknown as string;
    ctx.meta.request = ctx.request;

    const draft = await builder(ctx);

    expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.from_invalid");
  });

  it("handles zero value and empty data", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    ctx.request.payload.value = "0x0";
    ctx.request.payload.data = "0x";
    ctx.meta.request = ctx.request;

    const draft = await builder(ctx);

    expect(draft.prepared.value).toBe("0x0");
    expect(draft.prepared.data).toBe("0x");
    expect(draft.issues).toHaveLength(0);
  });

  it("warns when chainId is missing", async () => {
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => createRpcMock().client),
    });

    const ctx = createContext();
    Reflect.deleteProperty(ctx.request.payload, "chainId");
    ctx.meta.request = ctx.request;

    const draft = await builder(ctx);

    expect(draft.warnings.map((item) => item.code)).toContain("transaction.draft.chain_id_missing");
    expect(draft.summary.expectedChainId).toBe("0x1");
    expect(draft.summary.chainId).toBeUndefined();
  });

  it("retains normalized chainId when payload matches expected chain", async () => {
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => createRpcMock().client),
      now: () => 42_000,
    });

    const ctx = createContext();
    ctx.request.payload.chainId = "0x1";
    ctx.meta.request = ctx.request;

    const draft = await builder(ctx);

    expect(draft.summary.chainId).toBe("0x1");
    expect(draft.summary.generatedAt).toBe(42_000);
    expect(draft.summary.expectedChainId).toBe("0x1");
  });

  it("omits expectedChainId when chain reference is non-numeric", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
      now: () => 123_456,
    });

    const request = createRequest();
    request.caip2 = "eip155:mainnet";
    request.payload.chainId = "0x1";

    const ctx = createContext({
      chainRef: "eip155:mainnet",
      request,
      meta: createMeta(request),
    });

    const draft = await builder(ctx);

    expect(draft.summary.namespace).toBe("eip155");
    expect(draft.summary.chainRef).toBe("eip155:mainnet");
    expect(draft.summary.expectedChainId).toBeUndefined();
    expect(draft.summary.generatedAt).toBe(123_456);
  });

  it("flags zero gas estimate from RPC", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x0");

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    Reflect.deleteProperty(ctx.request.payload, "gas");

    const draft = await builder(ctx);

    expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.gas_zero");
    expect(draft.summary.gas).toBe("0x0");
  });

  it("warns when gas estimate is suspiciously high", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5f5e100"); // 100,000,000

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    Reflect.deleteProperty(ctx.request.payload, "gas");

    const draft = await builder(ctx);

    expect(draft.warnings.map((item) => item.code)).toContain("transaction.draft.gas_suspicious");
    expect(draft.summary.gas).toBe("0x5f5e100");
    const warning = draft.warnings.find((item) => item.code === "transaction.draft.gas_suspicious");
    expect(warning?.data).toEqual({ estimate: "0x5f5e100" });
  });

  it("reports invalid hex when RPC nonce response is malformed", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("1");
    rpc.estimateGas.mockResolvedValue("0x5208");

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    Reflect.deleteProperty(ctx.request.payload, "nonce");

    const draft = await builder(ctx);

    expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.invalid_hex");
    expect(draft.summary.nonce).toBeUndefined();
  });

  it("reports invalid hex when RPC gas response is malformed", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("21000");

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    Reflect.deleteProperty(ctx.request.payload, "gas");

    const draft = await builder(ctx);

    expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.invalid_hex");
    expect(draft.summary.gas).toBeUndefined();
  });

  it("detects incomplete EIP-1559 fee pair", async () => {
    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => createRpcMock().client),
    });

    const ctx = createContext();
    ctx.request.payload.maxFeePerGas = "0x59682f00";
    Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

    const draft = await builder(ctx);

    expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.fee_pair_incomplete");
  });

  it("reports fee_estimation_empty when RPC returns no fee data", async () => {
    const rpc = createRpcMock();
    rpc.getFeeData.mockResolvedValue({});
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    Reflect.deleteProperty(ctx.request.payload, "gasPrice");
    Reflect.deleteProperty(ctx.request.payload, "maxFeePerGas");
    Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

    const draft = await builder(ctx);

    expect(draft.issues.map((item) => item.code)).toContain("transaction.draft.fee_estimation_empty");
  });

  it("includes rpc metadata on fee_estimation_empty issue", async () => {
    const rpc = createRpcMock();
    rpc.getFeeData.mockResolvedValue({});
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
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
    const rpc = createRpcMock();
    rpc.getFeeData.mockRejectedValue(new Error("fee rpc down"));
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
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

  it("falls back to legacy fee data when RPC only returns gasPrice", async () => {
    const rpc = createRpcMock();
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    Reflect.deleteProperty(ctx.request.payload, "gasPrice");
    Reflect.deleteProperty(ctx.request.payload, "maxFeePerGas");
    Reflect.deleteProperty(ctx.request.payload, "maxPriorityFeePerGas");

    const draft = await builder(ctx);

    expect(draft.summary.feeMode).toBe("legacy");
    expect(draft.prepared.gasPrice).toBe("0x3b9aca00");
  });

  it("exposes maxCostHex when total cost is available", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({
      maxFeePerGas: "0x59682f00",
      maxPriorityFeePerGas: "0x3b9aca00",
    });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const ctx = createContext();
    const draft = await builder(ctx);

    const valueHex = (ctx.request.payload.value ?? "0x0") as `0x${string}`;
    const expectedWei = (BigInt("0x5208") * BigInt("0x59682f00") + BigInt(valueHex)).toString(10);
    const expectedHex = `0x${BigInt(expectedWei).toString(16)}`;

    expect(draft.summary.maxCostWei).toBe(expectedWei);
    expect(draft.summary.maxCostHex).toBe(expectedHex);
  });

  it("fills from using active account when payload omits it", async () => {
    const rpc = createRpcMock();
    rpc.getTransactionCount.mockResolvedValue("0x1");
    rpc.estimateGas.mockResolvedValue("0x5208");
    rpc.getFeeData.mockResolvedValue({ gasPrice: "0x3b9aca00" });

    const builder = createEip155DraftBuilder({
      rpcClientFactory: vi.fn(() => rpc.client),
    });

    const request = createRequest();
    Reflect.deleteProperty(request.payload, "from");

    const activeFrom = "0x52908400098527886E0F7030069857D2E4169EE7" as const;
    const ctx = createContext({
      from: activeFrom,
      request,
      meta: createMeta(request),
    });
    ctx.meta.from = activeFrom;

    const draft = await builder(ctx);

    expect(draft.issues).toHaveLength(0);
    expect(draft.prepared.from).toBe("0x52908400098527886e0f7030069857d2e4169ee7");
    expect(draft.summary.from).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
    expect(rpc.getTransactionCount).toHaveBeenCalledWith("0x52908400098527886e0f7030069857d2e4169ee7", "pending");
  });
});
