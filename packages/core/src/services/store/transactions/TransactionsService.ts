import { type TransactionRecord, TransactionRecordSchema } from "../../../storage/records.js";
import { compactUndefined } from "../_shared/compactUndefined.js";
import { createSignal } from "../_shared/signal.js";
import type { TransactionsPort } from "./port.js";
import { assertTransactionStatusTransition } from "./stateMachine.js";
import type {
  CreateBroadcastRecordParams,
  LinkRecordParams,
  ListTransactionsParams,
  TransactionsChangedPayload,
  TransactionsService,
  UpdateRecordStatusParams,
} from "./types.js";
import { TransactionRecordConflictError } from "./types.js";

export type CreateTransactionsServiceOptions = {
  port: TransactionsPort;
  now?: () => number;
};

const createBroadcastRecordIdConflictError = (id: TransactionRecord["id"]): TransactionRecordConflictError => {
  return new TransactionRecordConflictError({ kind: "id", id });
};

const matchesSubmittedPayload = (
  left: Pick<TransactionRecord, "submitted">,
  right: Pick<TransactionRecord, "submitted">,
) => JSON.stringify(left.submitted) === JSON.stringify(right.submitted);

const compareTransactionsNewestFirst = (left: TransactionRecord, right: TransactionRecord) => {
  return right.createdAt - left.createdAt || right.id.localeCompare(left.id);
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
      ...(params?.replacementIdentity !== undefined ? { replacementIdentity: params.replacementIdentity } : {}),
      ...(params?.limit !== undefined ? { limit: params.limit } : {}),
      ...(params?.before !== undefined ? { before: params.before } : {}),
    });

    const parsed = records.flatMap((r) => {
      const out = TransactionRecordSchema.safeParse(r);
      return out.success ? [out.data] : [];
    });
    parsed.sort(compareTransactionsNewestFirst);
    return parsed;
  };

  const findByReplacementIdentity = async (identity: NonNullable<TransactionRecord["replacementIdentity"]>) => {
    const records = await port.findByReplacementIdentity(identity);
    const parsed = records.flatMap((record) => {
      const out = TransactionRecordSchema.safeParse(record);
      return out.success ? [out.data] : [];
    });
    parsed.sort(compareTransactionsNewestFirst);
    return parsed;
  };

  const createBroadcastRecord = async (params: CreateBroadcastRecordParams) => {
    const ts = params.createdAt ?? now();

    const recordInput = compactUndefined({
      id: params.id ?? crypto.randomUUID(),
      chainRef: params.chainRef,
      origin: params.origin,
      fromAccountKey: params.fromAccountKey,
      status: "broadcast",
      submitted: structuredClone(params.submitted),
      receipt: params.receipt !== undefined ? structuredClone(params.receipt) : undefined,
      replacedId: params.replacedId,
      replacementIdentity: params.replacementIdentity,
      createdAt: ts,
      updatedAt: ts,
    });
    const record: TransactionRecord = TransactionRecordSchema.parse(recordInput);

    const existing = await port.get(record.id);
    if (existing) {
      const parsedExisting = TransactionRecordSchema.parse(existing);
      if (matchesSubmittedPayload(parsedExisting, record)) {
        return parsedExisting;
      }
      throw createBroadcastRecordIdConflictError(record.id);
    }

    try {
      await port.create(record);
    } catch (error) {
      const retryExisting = await port.get(record.id);
      if (retryExisting) {
        const parsedRetryExisting = TransactionRecordSchema.parse(retryExisting);
        if (matchesSubmittedPayload(parsedRetryExisting, record)) {
          return parsedRetryExisting;
        }
        throw createBroadcastRecordIdConflictError(record.id);
      }

      throw error;
    }
    changed.emit({ kind: "recordCreated", id: record.id, status: record.status });
    return record;
  };

  const updateRecordStatus = async (params: UpdateRecordStatusParams) => {
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

    const checked = TransactionRecordSchema.parse(nextCandidate);

    const updated = await port.updateIfStatus({
      id: checked.id,
      expectedStatus: params.fromStatus,
      next: checked,
    });

    if (!updated) return null;

    changed.emit({
      kind: "recordStatusUpdated",
      id: checked.id,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
    });
    return checked;
  };

  const linkRecord = async (params: LinkRecordParams) => {
    const existing = await port.get(params.id);
    if (!existing) return null;

    const currentParsed = TransactionRecordSchema.safeParse(existing);
    if (!currentParsed.success) return null;
    const current = currentParsed.data;

    if (current.status !== params.expectedStatus) {
      return null;
    }

    const patch = compactUndefined(params.patch);
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (keys.length === 0) {
      return current;
    }

    const nextCandidate: TransactionRecord = {
      ...current,
      ...patch,
      updatedAt: now(),
    };

    const checked = TransactionRecordSchema.parse(nextCandidate);
    const updated = await port.updateIfStatus({
      id: checked.id,
      expectedStatus: params.expectedStatus,
      next: checked,
    });
    if (!updated) return null;

    changed.emit({
      kind: "recordLinked",
      id: checked.id,
      status: checked.status,
      keys: keys as Array<keyof Pick<TransactionRecord, "receipt" | "replacedId" | "replacementIdentity">>,
    });
    return checked;
  };

  const remove = async (id: TransactionRecord["id"]) => {
    await port.remove(id);
    changed.emit({ kind: "remove", id });
  };

  return {
    subscribeChanged: changed.subscribe,

    get,
    list,
    findByReplacementIdentity,
    createBroadcastRecord,
    updateRecordStatus,
    linkRecord,
    remove,
  };
};
