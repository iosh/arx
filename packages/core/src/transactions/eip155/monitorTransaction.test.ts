import { describe, expect, it, vi } from "vitest";
import type { ChainJsonRpc, ChainJsonRpcRequest } from "../../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcUnavailableError } from "../../chainJsonRpc/errors.js";
import type { Eip155PendingTransactionRecord } from "../persistence.js";
import { createEip155TransactionMonitor } from "./monitorTransaction.js";

const CHAIN_REF = "eip155:1";
const RAW_TRANSACTION = "0xdeadbeef" as const;

const pendingRecord: Eip155PendingTransactionRecord = {
  transactionId: "transaction-1",
  namespace: "eip155",
  chainRef: CHAIN_REF,
  accountId: "eip155:0000000000000000000000000000000000000001",
  initiator: { type: "wallet" },
  transaction: {
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    nonce: "0x1",
    fee: { type: "legacy", gasPrice: "0x1" },
  },
  state: { status: "pending" },
  recovery: { rawTransaction: RAW_TRANSACTION },
  createdAt: 1,
  updatedAt: 1,
};

const createRpc = (handler: (input: ChainJsonRpcRequest) => unknown | Promise<unknown>) => {
  const request = vi.fn(async (input: ChainJsonRpcRequest) => await handler(input));
  const chainJsonRpc: ChainJsonRpc = {
    request: async <TResult>(input) => (await request(input)) as TResult,
  };

  return { chainJsonRpc, request };
};

const receipt = (status: "0x0" | "0x1") => ({
  blockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  blockNumber: "0x1",
  transactionIndex: "0x0",
  gasUsed: "0x5208",
  effectiveGasPrice: "0x2",
  contractAddress: null,
  status,
});

describe("EIP-155 transaction monitoring", () => {
  it("distinguishes unavailable, confirmed, and execution-failed receipt checks", async () => {
    const responses = [
      new ChainJsonRpcUnavailableError({ chainRef: CHAIN_REF, method: "eth_getTransactionReceipt", attempts: 1 }),
      receipt("0x1"),
      receipt("0x0"),
    ];
    const { chainJsonRpc, request } = createRpc(() => {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    });
    const monitor = createEip155TransactionMonitor({
      chainJsonRpc,
      broadcast: async () => ({ status: "accepted", transactionHash: "0x1" }),
    });

    await expect(monitor.inspectPending(pendingRecord)).resolves.toEqual({ status: "unavailable" });
    await expect(monitor.inspectPending(pendingRecord)).resolves.toMatchObject({
      status: "terminal",
      state: {
        status: "confirmed",
        confirmation: { effectiveGasPrice: "0x2" },
      },
    });
    await expect(monitor.inspectPending(pendingRecord)).resolves.toMatchObject({
      status: "terminal",
      state: { status: "failed", failure: { type: "execution" } },
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.every(([input]) => input.replay === "allowed")).toBe(true);
  });

  it("rebroadcasts an unseen restored transaction through the existing raw broadcast path", async () => {
    const { chainJsonRpc, request } = createRpc(({ method }) => {
      if (method === "eth_getTransactionReceipt") return null;
      if (method === "eth_getTransactionByHash") return null;
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const broadcast = vi.fn(async () => ({
      status: "rejected" as const,
      failure: { type: "broadcast" as const, code: -32_000, message: "already known" },
    }));
    const monitor = createEip155TransactionMonitor({ chainJsonRpc, broadcast });

    await expect(monitor.recoverPending(pendingRecord)).resolves.toEqual({ status: "pending" });
    expect(broadcast).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ recovery: { rawTransaction: RAW_TRANSACTION } }));
    expect(request.mock.calls.map(([input]) => input.method)).toEqual([
      "eth_getTransactionReceipt",
      "eth_getTransactionByHash",
    ]);
  });
});
