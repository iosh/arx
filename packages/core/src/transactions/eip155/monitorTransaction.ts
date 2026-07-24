import * as Hash from "ox/Hash";
import type { Hex } from "ox/Hex";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcResponseError, ChainJsonRpcUnavailableError } from "../../chainJsonRpc/errors.js";
import type { PendingTransactionInspection } from "../namespaceAdapter.js";
import type { Eip155PendingTransactionRecord } from "../persistence.js";
import type * as Eip155 from "./types.js";

type TransactionReceipt = Readonly<{
  blockHash: Hex;
  blockNumber: Hex;
  transactionIndex: Hex;
  gasUsed: Hex;
  effectiveGasPrice?: Hex;
  contractAddress: string | null;
  status: "0x0" | "0x1";
}>;

type NetworkTransaction = Readonly<{ hash: Hex }>;

const transactionHash = (record: Eip155PendingTransactionRecord): Hex => Hash.keccak256(record.recovery.rawTransaction);

const isChainJsonRpcFailure = (error: unknown): boolean =>
  error instanceof ChainJsonRpcResponseError || error instanceof ChainJsonRpcUnavailableError;

const confirmationFromReceipt = (receipt: TransactionReceipt): Eip155.TransactionConfirmation => ({
  blockHash: receipt.blockHash,
  blockNumber: receipt.blockNumber,
  transactionIndex: receipt.transactionIndex,
  gasUsed: receipt.gasUsed,
  ...(receipt.effectiveGasPrice === undefined ? {} : { effectiveGasPrice: receipt.effectiveGasPrice }),
  ...(receipt.contractAddress === null ? {} : { contractAddress: receipt.contractAddress }),
});

const inspectReceipt = async (
  chainJsonRpc: ChainJsonRpc,
  record: Eip155PendingTransactionRecord,
): Promise<PendingTransactionInspection> => {
  const receipt = await chainJsonRpc.request<TransactionReceipt | null>({
    chainRef: record.chainRef,
    method: "eth_getTransactionReceipt",
    params: [transactionHash(record)],
    replay: "allowed",
  });
  if (!receipt) return { status: "pending" };

  const confirmation = confirmationFromReceipt(receipt);
  return receipt.status === "0x1"
    ? { status: "terminal", state: { status: "confirmed", confirmation } }
    : {
        status: "terminal",
        state: { status: "failed", failure: { type: "execution", inclusion: confirmation } },
      };
};

export const createEip155TransactionMonitor = (params: {
  chainJsonRpc: ChainJsonRpc;
  broadcast(signed: Eip155.SignedTransaction): Promise<Eip155.BroadcastOutcome>;
}) => ({
  async inspectPending(record: Eip155PendingTransactionRecord): Promise<PendingTransactionInspection> {
    try {
      return await inspectReceipt(params.chainJsonRpc, record);
    } catch (error) {
      if (isChainJsonRpcFailure(error)) return { status: "unavailable" };
      throw error;
    }
  },

  async recoverPending(record: Eip155PendingTransactionRecord): Promise<PendingTransactionInspection> {
    try {
      const inspection = await inspectReceipt(params.chainJsonRpc, record);
      if (inspection.status !== "pending") return inspection;

      const visible = await params.chainJsonRpc.request<NetworkTransaction | null>({
        chainRef: record.chainRef,
        method: "eth_getTransactionByHash",
        params: [transactionHash(record)],
        replay: "allowed",
      });
      if (visible) return inspection;

      await params.broadcast(record);
      return inspection;
    } catch (error) {
      if (isChainJsonRpcFailure(error)) return { status: "unavailable" };
      throw error;
    }
  },
});
