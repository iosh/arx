import type { Address } from "ox/Address";
import type { Hex } from "ox/Hex";
import type { Rpc as RpcTransactionReceipt } from "ox/TransactionReceipt";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcResponseError, ChainJsonRpcUnavailableError } from "../../chainJsonRpc/errors.js";
import type { ChainRef } from "../../networks/chainRef.js";
import type { CoreMutationQueue } from "../../persistence/mutationQueue.js";
import type { CoreTime } from "../../runtime/time.js";
import {
  type Eip155PendingTransactionRecord,
  type TransactionRecord,
  type TransactionsReader,
  transactionWrites,
} from "../persistence.js";
import type { TransactionsChanged } from "../Transactions.js";
import type { TransactionId } from "../types.js";
import { pendingTransactionHash } from "./transactionHash.js";
import type {
  BroadcastOutcome,
  SignedTransaction,
  TerminalTransactionState,
  TransactionConfirmation,
} from "./types.js";

const BLOCK_HEIGHT_POLL_INTERVAL_MS = 20_000;
const DROP_AFTER_NONCE_CONSUMED_CHECKS = 4;

type TrackedTransaction = {
  readonly record: Eip155PendingTransactionRecord;
  lastInspectedBlock?: Hex;
  lastCountedBlock?: bigint;
  nonceConsumedChecks: number;
  needsStartupRecovery: boolean;
};

type PendingNonceGroup = [TrackedTransaction, ...TrackedTransaction[]];

type TransactionReceipt = Pick<
  RpcTransactionReceipt,
  "blockHash" | "blockNumber" | "transactionIndex" | "gasUsed" | "contractAddress" | "status"
> &
  Partial<Pick<RpcTransactionReceipt, "effectiveGasPrice">>;

type IncludedReceipt = Readonly<{
  transactionId: TransactionId;
  receipt: TransactionReceipt;
}>;

type NonceGroupInspection = IncludedReceipt | Readonly<{ nextNonce: bigint }>;

type GroupUpdate = Readonly<{
  key: string;
  group: PendingNonceGroup;
  states: ReadonlyMap<Eip155PendingTransactionRecord, TerminalTransactionState>;
}>;

type TransactionMonitorOptions = Readonly<{
  chainJsonRpc: ChainJsonRpc;
  transactions: Pick<TransactionsReader, "get">;
  broadcast(signed: SignedTransaction): Promise<BroadcastOutcome>;
  mutations: CoreMutationQueue;
  time: CoreTime;
  publishChanged(change: TransactionsChanged): void;
}>;

const isRpcReadFailure = (error: unknown): error is ChainJsonRpcResponseError | ChainJsonRpcUnavailableError =>
  error instanceof ChainJsonRpcResponseError || error instanceof ChainJsonRpcUnavailableError;

export class TransactionMonitor {
  readonly #chainJsonRpc: ChainJsonRpc;
  readonly #transactions: TransactionMonitorOptions["transactions"];
  readonly #broadcast: TransactionMonitorOptions["broadcast"];
  readonly #mutations: CoreMutationQueue;
  readonly #time: CoreTime;
  readonly #publishChanged: (change: TransactionsChanged) => void;
  readonly #pending = new Map<TransactionId, TrackedTransaction>();
  readonly #checkingChains = new Set<ChainRef>();
  readonly #recoveringGroups = new Set<string>();

  #cancelTimer: (() => void) | undefined;

  constructor(options: TransactionMonitorOptions) {
    this.#chainJsonRpc = options.chainJsonRpc;
    this.#transactions = options.transactions;
    this.#broadcast = options.broadcast;
    this.#mutations = options.mutations;
    this.#time = options.time;
    this.#publishChanged = options.publishChanged;
  }

  restore(records: readonly Eip155PendingTransactionRecord[]): void {
    for (const record of records) {
      this.#pending.set(record.transactionId, { record, nonceConsumedChecks: 0, needsStartupRecovery: true });
    }

    this.#cancelScheduledInspection();
    this.#schedule(0);
  }

  track(record: Eip155PendingTransactionRecord): void {
    this.#pending.set(record.transactionId, { record, nonceConsumedChecks: 0, needsStartupRecovery: false });
    this.#schedule(0);
  }

  untrack(transactionId: TransactionId): void {
    this.#pending.delete(transactionId);
    if (this.#pending.size === 0) this.#cancelScheduledInspection();
  }

  #schedule(delayMs: number): void {
    if (this.#pending.size === 0 || this.#cancelTimer) return;

    this.#cancelTimer = this.#time.schedule(delayMs, () => {
      this.#cancelTimer = undefined;
      this.#checkPendingChains();
      this.#schedule(BLOCK_HEIGHT_POLL_INTERVAL_MS);
    });
  }

  #cancelScheduledInspection(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
  }

  #checkPendingChains(): void {
    const chains = new Set<ChainRef>();
    for (const { record } of this.#pending.values()) chains.add(record.chainRef);
    for (const chainRef of chains) {
      if (!this.#checkingChains.has(chainRef)) void this.#inspectChain(chainRef);
    }
  }

  #pendingGroups(chainRef: ChainRef): Map<string, PendingNonceGroup> {
    const groups = new Map<string, PendingNonceGroup>();
    for (const tracked of this.#pending.values()) {
      if (tracked.record.chainRef !== chainRef) continue;

      const { from, nonce } = tracked.record.transaction;
      const key = `${chainRef}/${from}/${BigInt(nonce)}`;
      const group = groups.get(key);
      if (group) group.push(tracked);
      else groups.set(key, [tracked]);
    }
    return groups;
  }

  async #inspectChain(chainRef: ChainRef): Promise<void> {
    this.#checkingChains.add(chainRef);
    try {
      const blockNumber = await this.#chainJsonRpc.request<Hex>({ chainRef, method: "eth_blockNumber" });
      const updates: GroupUpdate[] = [];
      const recoveryGroups = new Map<string, PendingNonceGroup>();
      const nextNonceRequests = new Map<Address, Promise<Hex>>();

      for (const [key, group] of this.#pendingGroups(chainRef)) {
        const needsRecovery = group.some(({ needsStartupRecovery }) => needsStartupRecovery);
        const recoveryDue = needsRecovery && !this.#recoveringGroups.has(key);
        if (!recoveryDue && group.every(({ lastInspectedBlock }) => lastInspectedBlock === blockNumber)) continue;

        try {
          const inspection = await this.#inspectNonceGroup(chainRef, group, blockNumber, nextNonceRequests);
          const states = this.#applyInspection(group, blockNumber, inspection);
          if (states.size > 0) updates.push({ key, group, states });
          else if (group.some(({ needsStartupRecovery }) => needsStartupRecovery)) recoveryGroups.set(key, group);
        } catch (error) {
          if (!isRpcReadFailure(error)) throw error;
        }
      }

      if (updates.length > 0) await this.#commitTerminalRecords(chainRef, updates);

      for (const [key, group] of recoveryGroups) {
        void this.#recoverNonceGroup(chainRef, key, group);
      }
    } catch (error) {
      if (!isRpcReadFailure(error)) {
        console.error("[arx:transactions] Failed to inspect pending transactions", chainRef, error);
      }
    } finally {
      this.#checkingChains.delete(chainRef);
    }
  }

  async #inspectNonceGroup(
    chainRef: ChainRef,
    group: PendingNonceGroup,
    blockNumber: Hex,
    nextNonceRequests: Map<Address, Promise<Hex>>,
  ): Promise<NonceGroupInspection> {
    const included = await this.#findReceipt(chainRef, group);
    if (included) return included;

    const { from } = group[0].record.transaction;
    let nextNonceRequest = nextNonceRequests.get(from);
    if (nextNonceRequest === undefined) {
      nextNonceRequest = this.#chainJsonRpc.request<Hex>({
        chainRef,
        method: "eth_getTransactionCount",
        params: [from, blockNumber],
      });
      nextNonceRequests.set(from, nextNonceRequest);
    }
    return { nextNonce: BigInt(await nextNonceRequest) };
  }

  #applyInspection(group: PendingNonceGroup, blockNumber: Hex, inspection: NonceGroupInspection) {
    const states = new Map<Eip155PendingTransactionRecord, TerminalTransactionState>();
    if ("receipt" in inspection) {
      const { receipt, transactionId } = inspection;
      const includedState = stateFromReceipt(receipt);
      const replacedState = { status: "replaced", replacement: { type: "local", transactionId } } as const;
      for (const tracked of group) {
        const { record } = tracked;
        if (tracked.needsStartupRecovery) {
          tracked.needsStartupRecovery = false;
          // Allow another inspection at this height if the receipt cannot be persisted.
          delete tracked.lastInspectedBlock;
        }
        states.set(record, record.transactionId === transactionId ? includedState : replacedState);
      }
      return states;
    }

    const nonceConsumed = inspection.nextNonce > BigInt(group[0].record.transaction.nonce);
    const height = BigInt(blockNumber);
    for (const tracked of group) {
      if (nonceConsumed) {
        tracked.needsStartupRecovery = false;
        if (
          tracked.nonceConsumedChecks < DROP_AFTER_NONCE_CONSUMED_CHECKS &&
          (tracked.lastCountedBlock === undefined || height > tracked.lastCountedBlock)
        ) {
          tracked.nonceConsumedChecks++;
          tracked.lastCountedBlock = height;
        }
        if (tracked.nonceConsumedChecks >= DROP_AFTER_NONCE_CONSUMED_CHECKS) {
          states.set(tracked.record, { status: "dropped" });
          continue;
        }
      }
      tracked.lastInspectedBlock = blockNumber;
    }
    return states;
  }

  async #findReceipt(chainRef: ChainRef, group: PendingNonceGroup): Promise<IncludedReceipt | undefined> {
    let readError: ChainJsonRpcResponseError | ChainJsonRpcUnavailableError | undefined;
    for (const { record } of group) {
      let receipt: TransactionReceipt | null;
      try {
        receipt = await this.#chainJsonRpc.request<TransactionReceipt | null>({
          chainRef,
          method: "eth_getTransactionReceipt",
          params: [pendingTransactionHash(record)],
        });
      } catch (error) {
        if (!isRpcReadFailure(error)) throw error;
        readError = error;
        continue;
      }
      if (receipt !== null) return { receipt, transactionId: record.transactionId };
    }
    if (readError) throw readError;
    return undefined;
  }

  async #recoverNonceGroup(chainRef: ChainRef, key: string, group: PendingNonceGroup): Promise<void> {
    if (this.#recoveringGroups.has(key)) return;

    this.#recoveringGroups.add(key);
    try {
      const candidate = await this.#findRecoveryCandidate(group);
      if (!samePendingGroup(group, this.#pendingGroups(chainRef).get(key))) return;
      if (!candidate?.needsStartupRecovery) {
        for (const tracked of group) tracked.needsStartupRecovery = false;
        return;
      }

      const { record } = candidate;
      const hash = pendingTransactionHash(record);
      const transactionOnNode = await this.#chainJsonRpc.request<{ hash: Hex } | null>({
        chainRef,
        method: "eth_getTransactionByHash",
        params: [hash],
      });
      if (!candidate.needsStartupRecovery || !samePendingGroup(group, this.#pendingGroups(chainRef).get(key))) return;

      for (const tracked of group) tracked.needsStartupRecovery = false;
      if (transactionOnNode !== null) return;

      const { transaction, recovery } = record;
      const outcome = await this.#broadcast({ chainRef, hash, transaction, recovery });
      if (outcome.status === "rejected") {
        console.warn("[arx:transactions] Startup broadcast rejected", {
          chainRef,
          transactionId: record.transactionId,
          code: outcome.failure.code,
          message: outcome.failure.message,
        });
      }
    } catch (error) {
      if (!isRpcReadFailure(error)) {
        console.error("[arx:transactions] Startup recovery failed", key, error);
      }
    } finally {
      this.#recoveringGroups.delete(key);
    }
  }

  async #findRecoveryCandidate(group: PendingNonceGroup): Promise<TrackedTransaction | undefined> {
    if (group.length === 1) return group[0];

    const pendingById = new Map(group.map(({ record }) => [record.transactionId, record]));
    const replacedIds = new Set<TransactionId>();
    for (const { record } of group) {
      let parentId = record.replacesTransactionId;
      while (parentId !== undefined && !replacedIds.has(parentId)) {
        replacedIds.add(parentId);
        // A failed intermediate replacement is still part of the recorded intent.
        const parent = pendingById.get(parentId) ?? (await this.#transactions.get(parentId));
        parentId = parent?.replacesTransactionId;
      }
    }

    const candidates = group.filter(({ record }) => !replacedIds.has(record.transactionId));
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  async #commitTerminalRecords(chainRef: ChainRef, updates: readonly GroupUpdate[]): Promise<void> {
    return await this.#mutations.run(async (commit) => {
      const currentGroups = this.#pendingGroups(chainRef);
      const now = this.#time.now();
      const updatedRecords: TransactionRecord[] = [];
      for (const { key, group, states } of updates) {
        if (!samePendingGroup(group, currentGroups.get(key))) continue;
        for (const [record, state] of states) {
          const { recovery: _recovery, ...transaction } = record;
          updatedRecords.push({ ...transaction, hash: pendingTransactionHash(record), state, updatedAt: now });
        }
      }
      if (updatedRecords.length === 0) return;
      await commit(updatedRecords.map(transactionWrites.put));

      const transactionIds = updatedRecords.map(({ transactionId }) => transactionId);
      for (const id of transactionIds) this.untrack(id);
      this.#publishChanged({ type: "transactionsChanged", transactionIds });
    });
  }
}

const samePendingGroup = (checked: PendingNonceGroup, current: PendingNonceGroup | undefined): boolean =>
  checked.length === current?.length && checked.every((tracked, index) => tracked === current[index]);

const stateFromReceipt = (receipt: TransactionReceipt): TerminalTransactionState => {
  const confirmation: TransactionConfirmation = {
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber,
    transactionIndex: receipt.transactionIndex,
    gasUsed: receipt.gasUsed,
    ...(receipt.effectiveGasPrice === undefined ? {} : { effectiveGasPrice: receipt.effectiveGasPrice }),
    ...(receipt.contractAddress ? { contractAddress: receipt.contractAddress } : {}),
  };
  return receipt.status === "0x1"
    ? { status: "confirmed", confirmation }
    : { status: "failed", failure: { type: "execution", inclusion: confirmation } };
};
