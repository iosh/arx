import { EventEmitter } from "eventemitter3";
import { type TransactionRecord, TransactionRecordSchema } from "../../db/records.js";
import type { TransactionsPort } from "./port.js";
import { assertTransactionStatusTransition } from "./stateMachine.js";
import type {
  CreatePendingTransactionParams,
  ListTransactionsParams,
  TransactionsService,
  TransitionTransactionParams,
} from "./types.js";

type ChangedEvent = "changed";

export type CreateTransactionsServiceOptions = {
  port: TransactionsPort;
  now?: () => number;
};

const requiresHash = (status: TransactionRecord["status"]) => {
  return status === "broadcast" || status === "confirmed" || status === "replaced";
};

export const createTransactionsService = ({
  port,
  now = Date.now,
}: CreateTransactionsServiceOptions): TransactionsService => {
  const emitter = new EventEmitter<ChangedEvent>();

  const emitChanged = () => {
    emitter.emit("changed");
  };

  const get = async (id: TransactionRecord["id"]) => {
    const record = await port.get(id);
    return record ? TransactionRecordSchema.parse(record) : null;
  };

  const list = async (params?: ListTransactionsParams) => {
    const records = await port.list({
      ...(params?.chainRef !== undefined ? { chainRef: params.chainRef } : {}),
      ...(params?.status !== undefined ? { status: params.status } : {}),
      ...(params?.limit !== undefined ? { limit: params.limit } : {}),
      ...(params?.beforeCreatedAt !== undefined ? { beforeCreatedAt: params.beforeCreatedAt } : {}),
    });

    const parsed = records.map((r) => TransactionRecordSchema.parse(r));
    parsed.sort((a, b) => b.createdAt - a.createdAt);
    return parsed;
  };

  const createPending = async (params: CreatePendingTransactionParams) => {
    const ts = now();

    const record: TransactionRecord = TransactionRecordSchema.parse({
      id: crypto.randomUUID(),
      namespace: params.namespace,
      chainRef: params.chainRef,
      origin: params.origin,
      fromAccountId: params.fromAccountId,
      status: "pending",
      request: params.request,
      hash: null,
      userRejected: false,
      warnings: params.warnings ?? [],
      issues: params.issues ?? [],
      createdAt: ts,
      updatedAt: ts,
    });

    await port.upsert(record);
    emitChanged();
    return record;
  };

  const transition = async (params: TransitionTransactionParams) => {
    const existing = await port.get(params.id);
    if (!existing) return null;

    const current = TransactionRecordSchema.parse(existing);

    // CAS precheck: treat mismatches as expected concurrency conflicts.
    if (current.status !== params.fromStatus) {
      return null;
    }

    // Bug-level invariant: only allow transitions defined by the state machine.
    assertTransactionStatusTransition(params.fromStatus, params.toStatus);

    const patch =
      params.patch === undefined
        ? undefined
        : (Object.fromEntries(Object.entries(params.patch).filter(([, v]) => v !== undefined)) as typeof params.patch);

    const nextCandidate: TransactionRecord = {
      ...current,
      ...(patch ?? {}),
      status: params.toStatus,
      updatedAt: now(),
    };

    if (requiresHash(nextCandidate.status) && nextCandidate.hash === null) {
      throw new Error(`Transaction hash is required when status is ${nextCandidate.status}`);
    }

    if (nextCandidate.hash !== null) {
      const dupe = await port.findByChainRefAndHash({
        chainRef: nextCandidate.chainRef,
        hash: nextCandidate.hash,
      });

      if (dupe && dupe.id !== nextCandidate.id) {
        throw new Error(`Duplicate transaction hash for chainRef ${nextCandidate.chainRef}`);
      }
    }

    const checked = TransactionRecordSchema.parse(nextCandidate);

    const updated = await port.updateIfStatus({
      id: checked.id,
      expectedStatus: params.fromStatus,
      next: checked,
    });

    if (!updated) return null;

    emitChanged();
    return checked;
  };

  const remove = async (id: TransactionRecord["id"]) => {
    await port.remove(id);
    emitChanged();
  };

  return {
    on(event, handler) {
      if (event !== "changed") return;
      emitter.on("changed", handler);
    },
    off(event, handler) {
      if (event !== "changed") return;
      emitter.off("changed", handler);
    },

    get,
    list,
    createPending,
    transition,
    remove,
  };
};
