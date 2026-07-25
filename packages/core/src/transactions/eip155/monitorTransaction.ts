import * as Hash from "ox/Hash";
import type { Hex } from "ox/Hex";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcResponseError, ChainJsonRpcUnavailableError } from "../../chainJsonRpc/errors.js";
import * as HexQuantity from "../../utils/hex.js";
import type { PendingTransactionInspection, TerminalTransactionChange } from "../namespaceAdapter.js";
import type { Eip155PendingTransactionRecord } from "../persistence.js";
import type { TransactionId } from "../types.js";
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

const terminalStateFromReceipt = (receipt: TransactionReceipt): Eip155.TerminalTransactionState => {
  const confirmation = confirmationFromReceipt(receipt);
  return receipt.status === "0x1"
    ? { status: "confirmed", confirmation }
    : { status: "failed", failure: { type: "execution", inclusion: confirmation } };
};

const groupBySenderAndNonce = (
  records: readonly Eip155PendingTransactionRecord[],
): readonly (readonly Eip155PendingTransactionRecord[])[] => {
  const groups = new Map<string, Eip155PendingTransactionRecord[]>();

  for (const record of records) {
    const key = `${record.transaction.from}:${HexQuantity.toBigInt(record.transaction.nonce)}`;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  return [...groups.values()];
};

const terminalChangesForWinner = (
  records: readonly Eip155PendingTransactionRecord[],
  winner: Eip155PendingTransactionRecord,
  winnerState: Eip155.TerminalTransactionState,
): readonly TerminalTransactionChange[] =>
  records.map((record) => ({
    transactionId: record.transactionId,
    state:
      record.transactionId === winner.transactionId
        ? winnerState
        : { status: "replaced", replacement: { type: "local", transactionId: winner.transactionId } },
  }));

const inspectGroup = async (
  chainJsonRpc: ChainJsonRpc,
  records: readonly Eip155PendingTransactionRecord[],
): Promise<readonly TerminalTransactionChange[]> => {
  for (const record of records) {
    const receipt = await chainJsonRpc.request<TransactionReceipt | null>({
      chainRef: record.chainRef,
      method: "eth_getTransactionReceipt",
      params: [transactionHash(record)],
      replay: "allowed",
    });
    if (receipt) return terminalChangesForWinner(records, record, terminalStateFromReceipt(receipt));
  }

  return [];
};

const recoverGroup = async (
  params: {
    chainJsonRpc: ChainJsonRpc;
    broadcast(signed: Eip155.SignedTransaction): Promise<Eip155.BroadcastOutcome>;
  },
  records: readonly Eip155PendingTransactionRecord[],
  recoveryTransactionIds: ReadonlySet<TransactionId>,
): Promise<void> => {
  const replacedTransactionIds = new Set(
    records.flatMap((record) => (record.replacesTransactionId === undefined ? [] : [record.replacesTransactionId])),
  );

  for (const record of records) {
    if (replacedTransactionIds.has(record.transactionId) || !recoveryTransactionIds.has(record.transactionId)) {
      continue;
    }

    const visible = await params.chainJsonRpc.request<NetworkTransaction | null>({
      chainRef: record.chainRef,
      method: "eth_getTransactionByHash",
      params: [transactionHash(record)],
      replay: "allowed",
    });
    if (visible) continue;

    await params.broadcast({
      chainRef: record.chainRef,
      transaction: record.transaction,
      recovery: record.recovery,
    });
  }
};

export const createEip155TransactionMonitor = (params: {
  chainJsonRpc: ChainJsonRpc;
  broadcast(signed: Eip155.SignedTransaction): Promise<Eip155.BroadcastOutcome>;
}) => ({
  async inspectPending(records: readonly Eip155PendingTransactionRecord[]): Promise<PendingTransactionInspection> {
    try {
      const terminalChanges: TerminalTransactionChange[] = [];
      for (const group of groupBySenderAndNonce(records)) {
        terminalChanges.push(...(await inspectGroup(params.chainJsonRpc, group)));
      }

      return { status: "checked", terminalChanges };
    } catch (error) {
      if (isChainJsonRpcFailure(error)) return { status: "unavailable" };
      throw error;
    }
  },

  async recoverPending(
    records: readonly Eip155PendingTransactionRecord[],
    recoveryTransactionIds: readonly TransactionId[],
  ): Promise<PendingTransactionInspection> {
    try {
      const terminalChanges: TerminalTransactionChange[] = [];
      const recoveryIds = new Set(recoveryTransactionIds);
      for (const group of groupBySenderAndNonce(records)) {
        const groupTerminalChanges = await inspectGroup(params.chainJsonRpc, group);
        terminalChanges.push(...groupTerminalChanges);
        if (groupTerminalChanges.length === 0) await recoverGroup(params, group, recoveryIds);
      }

      return { status: "checked", terminalChanges };
    } catch (error) {
      if (isChainJsonRpcFailure(error)) return { status: "unavailable" };
      throw error;
    }
  },
});
