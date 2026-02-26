import { type TransactionRecord, TransactionRecordSchema } from "../../../storage/records.js";
import { compactUndefined } from "../_shared/compactUndefined.js";
import { createSignal } from "../_shared/signal.js";
import type { TransactionsPort } from "./port.js";
import { assertTransactionStatusTransition } from "./stateMachine.js";
import type {
  CreatePendingTransactionParams,
  ListTransactionsParams,
  PatchTransactionParams,
  TransactionsChangedPayload,
  TransactionsService,
  TransitionTransactionParams,
} from "./types.js";

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
  const changed = createSignal<TransactionsChangedPayload>();

  const get = async (id: TransactionRecord["id"]) => {
    const record = await port.get(id);
    if (!record) return null;
    const parsed = TransactionRecordSchema.safeParse(record);
    return parsed.success ? parsed.data : null;
  };

  const list = async (params?: ListTransactionsParams) => {
    const records = await port.list({
      ...(params?.chainRef !== undefined ? { chainRef: params.chainRef } : {}),
      ...(params?.status !== undefined ? { status: params.status } : {}),
      ...(params?.limit !== undefined ? { limit: params.limit } : {}),
      ...(params?.beforeCreatedAt !== undefined ? { beforeCreatedAt: params.beforeCreatedAt } : {}),
    });

    const parsed = records.flatMap((r) => {
      const out = TransactionRecordSchema.safeParse(r);
      return out.success ? [out.data] : [];
    });
    parsed.sort((a, b) => b.createdAt - a.createdAt);
    return parsed;
  };

  const createPending = async (params: CreatePendingTransactionParams) => {
    const ts = params.createdAt ?? now();

    const record: TransactionRecord = TransactionRecordSchema.parse({
      id: params.id ?? crypto.randomUUID(),
      namespace: params.namespace,
      chainRef: params.chainRef,
      origin: params.origin,
      fromAccountId: params.fromAccountId,
      status: "pending",
      request: params.request,
      prepared: null,
      hash: null,
      userRejected: false,
      warnings: params.warnings ?? [],
      issues: params.issues ?? [],
      createdAt: ts,
      updatedAt: ts,
    });

    await port.upsert(record);
    changed.emit({ kind: "createPending", id: record.id });
    return record;
  };

  const patch = async (params: PatchTransactionParams) => {
    const existing = await port.get(params.id);
    if (!existing) return null;

    const currentParsed = TransactionRecordSchema.safeParse(existing);
    if (!currentParsed.success) return null;
    const current = currentParsed.data;
    const patchFields = params.patch === undefined ? undefined : compactUndefined(params.patch);

    const nextCandidate: TransactionRecord = {
      ...current,
      ...(patchFields ?? {}),
      updatedAt: now(),
    };

    const checked = TransactionRecordSchema.parse(nextCandidate);

    const updated = await port.updateIfStatus({
      id: checked.id,
      expectedStatus: current.status,
      next: checked,
    });

    if (!updated) return null;

    changed.emit({ kind: "patch", id: checked.id });
    return checked;
  };

  const transition = async (params: TransitionTransactionParams) => {
    const existing = await port.get(params.id);
    if (!existing) return null;

    const currentParsed = TransactionRecordSchema.safeParse(existing);
    if (!currentParsed.success) return null;
    const current = currentParsed.data;

    // CAS precheck: treat mismatches as expected concurrency conflicts.
    if (current.status !== params.fromStatus) {
      return null;
    }

    // Bug-level invariant: only allow transitions defined by the state machine.
    assertTransactionStatusTransition(params.fromStatus, params.toStatus);

    const patch = params.patch === undefined ? undefined : compactUndefined(params.patch);

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

    changed.emit({
      kind: "transition",
      id: checked.id,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
    });
    return checked;
  };

  const remove = async (id: TransactionRecord["id"]) => {
    await port.remove(id);
    changed.emit({ kind: "remove", id });
  };

  const failAllPending = async (params?: { reason?: string }) => {
    const reason = params?.reason ?? "session_restart";
    let cursor: number | undefined;
    let transitioned = 0;

    while (true) {
      const page = await list({
        status: "pending",
        limit: 200,
        ...(cursor !== undefined ? { beforeCreatedAt: cursor } : {}),
      });

      if (page.length === 0) break;

      for (const record of page) {
        const next = await transition({
          id: record.id,
          fromStatus: "pending",
          toStatus: "failed",
          patch: {
            userRejected: false,
            error: {
              name: "TransactionAbandonedError",
              message: "Transaction was abandoned due to session restart.",
              data: { reason },
            },
          },
        });
        if (next) transitioned += 1;
      }

      cursor = page.at(-1)?.createdAt;
      if (cursor === undefined) break;
    }

    return transitioned;
  };

  return {
    subscribeChanged: changed.subscribe,

    get,
    list,
    createPending,
    transition,
    patch,
    remove,
    failAllPending,
  };
};
