import { type TransactionRecord, TransactionRecordSchema } from "../../../storage/records.js";
import { compactUndefined } from "../_shared/compactUndefined.js";
import { createSignal } from "../_shared/signal.js";
import type { TransactionsPort } from "./port.js";
import { assertTransactionStatusTransition } from "./stateMachine.js";
import type {
  CreateSubmittedTransactionParams,
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

const createDuplicateTransactionIdError = (id: TransactionRecord["id"]) => {
  return new Error(`Duplicate transaction id "${id}"`);
};

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

  const createSubmitted = async (params: CreateSubmittedTransactionParams) => {
    const ts = params.createdAt ?? now();

    const recordInput = compactUndefined({
      id: params.id ?? crypto.randomUUID(),
      chainRef: params.chainRef,
      origin: params.origin,
      fromAccountKey: params.fromAccountKey,
      status: params.status,
      submitted: structuredClone(params.submitted),
      locator: structuredClone(params.locator),
      receipt: params.receipt !== undefined ? structuredClone(params.receipt) : undefined,
      replacedId: params.replacedId,
      createdAt: ts,
      updatedAt: ts,
    });
    const record: TransactionRecord = TransactionRecordSchema.parse(recordInput);

    const existing = await port.get(record.id);
    if (existing) {
      throw createDuplicateTransactionIdError(record.id);
    }

    const duplicateLocatorRecord = await port.findByChainRefAndLocator({
      chainRef: record.chainRef,
      locator: record.locator,
    });
    if (duplicateLocatorRecord) {
      throw new Error(`Duplicate transaction locator for chainRef ${record.chainRef}`);
    }

    await port.create(record);
    changed.emit({ kind: "createSubmitted", id: record.id });
    return record;
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

    const duplicateLocatorRecord = await port.findByChainRefAndLocator({
      chainRef: nextCandidate.chainRef,
      locator: nextCandidate.locator,
    });

    if (duplicateLocatorRecord && duplicateLocatorRecord.id !== nextCandidate.id) {
      throw new Error(`Duplicate transaction locator for chainRef ${nextCandidate.chainRef}`);
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

  const patchIfStatus = async (params: PatchTransactionParams) => {
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

    const duplicateLocatorRecord = await port.findByChainRefAndLocator({
      chainRef: nextCandidate.chainRef,
      locator: nextCandidate.locator,
    });

    if (duplicateLocatorRecord && duplicateLocatorRecord.id !== nextCandidate.id) {
      throw new Error(`Duplicate transaction locator for chainRef ${nextCandidate.chainRef}`);
    }

    const checked = TransactionRecordSchema.parse(nextCandidate);
    const updated = await port.updateIfStatus({
      id: checked.id,
      expectedStatus: params.expectedStatus,
      next: checked,
    });
    if (!updated) return null;

    changed.emit({
      kind: "patch",
      id: checked.id,
      status: checked.status,
      keys: keys as Array<keyof Pick<TransactionRecord, "locator" | "receipt" | "replacedId">>,
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
    createSubmitted,
    transition,
    patchIfStatus,
    remove,
  };
};
