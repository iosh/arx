import type {
  TransactionError,
  TransactionMeta,
  TransactionPayloadMap,
  TransactionReceipt,
  TransactionRequest,
  TransactionState,
  TransactionWarning,
} from "../../controllers/transaction/types.js";
import type { TransactionsSnapshot } from "../../storage/index.js";
import { TRANSACTIONS_SNAPSHOT_VERSION, TransactionsSnapshotSchema } from "../../storage/index.js";

type TransactionMetaInput = Omit<TransactionMeta, "receipt"> & {
  receipt?: TransactionReceipt | null | undefined;
};

type TransactionStateInput = {
  pending: TransactionMetaInput[];
  history: TransactionMetaInput[];
};

const cloneWarnings = (list: TransactionWarning[]): TransactionWarning[] => list.map((warning) => ({ ...warning }));

const cloneError = (error: TransactionError | null | undefined): TransactionError | null => {
  if (!error) {
    return null;
  }
  return { ...error };
};

const cloneReceipt = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneReceipt(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, cloneReceipt(entry)]),
    );
  }
  return value;
};
const clonePayload = (namespace: string, payload: TransactionRequest["payload"]): TransactionRequest["payload"] => {
  if (namespace === "eip155") {
    return { ...(payload as TransactionPayloadMap["eip155"]) };
  }
  if (payload && typeof payload === "object") {
    return { ...(payload as Record<string, unknown>) };
  }
  return payload;
};

const cloneRequest = (request: TransactionRequest): TransactionRequest => {
  const next: TransactionRequest = {
    namespace: request.namespace,
    payload: clonePayload(request.namespace, request.payload),
  };

  if (request.caip2 !== undefined) {
    next.caip2 = request.caip2;
  }

  return next;
};

const cloneMeta = (meta: TransactionMetaInput): TransactionMeta => ({
  ...meta,
  request: cloneRequest(meta.request),
  warnings: cloneWarnings(meta.warnings),
  issues: cloneWarnings(meta.issues),
  error: cloneError(meta.error),
  receipt: cloneReceipt(meta.receipt) as TransactionReceipt,
});

export const cloneTransactionState = (state: TransactionStateInput): TransactionState => ({
  pending: state.pending.map(cloneMeta),
  history: state.history.map(cloneMeta),
});

export const serializeTransactionState = (state: TransactionState, updatedAt: number): TransactionsSnapshot => ({
  version: TRANSACTIONS_SNAPSHOT_VERSION,
  updatedAt,
  payload: cloneTransactionState(state),
});

export type TransactionSnapshotHydration = {
  state: TransactionState;
  updatedAt: number;
};

export const deserializeTransactionSnapshot = (input: unknown): TransactionSnapshotHydration | null => {
  const parsed = TransactionsSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }

  return {
    state: cloneTransactionState(parsed.data.payload),
    updatedAt: parsed.data.updatedAt,
  };
};
