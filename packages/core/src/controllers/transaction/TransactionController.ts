import type { AccountAddress, AccountController } from "../account/types.js";
import { type ApprovalController, type ApprovalStrategy, ApprovalTypes } from "../approval/types.js";
import type { NetworkController } from "../network/types.js";
import type {
  TransactionApprovalTask,
  TransactionApprovalTaskPayload,
  TransactionController,
  TransactionControllerOptions,
  TransactionMessenger,
  TransactionMeta,
  TransactionRequest,
  TransactionState,
} from "./types.js";

const TRANSACTION_STATE_TOPIC = "transaction:stateChanged";
const TRANSACTION_QUEUED_TOPIC = "transaction:queued";
const TRANSACTION_UPDATED_TOPIC = "transaction:updated";

const DEFAULT_REJECTION_MESSAGE = "Transaction rejected by stub";

const defaultIdGenerator = () => {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
};

const cloneRequest = (request: TransactionRequest): TransactionRequest => {
  if (request.namespace === "eip155") {
    return {
      ...request,
      payload: { ...request.payload },
    };
  }
  return {
    ...request,
    payload: { ...(request.payload as Record<string, unknown>) },
  };
};

const cloneMeta = (meta: TransactionMeta): TransactionMeta => ({
  ...meta,
  request: cloneRequest(meta.request),
});

const cloneState = (state: TransactionState): TransactionState => ({
  pending: state.pending.map(cloneMeta),
  history: state.history.map(cloneMeta),
});

const isSameState = (prev?: TransactionState, next?: TransactionState) => {
  if (!prev || !next) return false;
  if (prev.pending.length !== next.pending.length) return false;
  if (prev.history.length !== next.history.length) return false;

  return (
    prev.pending.every(
      (meta, index) => meta.id === next.pending[index]?.id && meta.updatedAt === next.pending[index]?.updatedAt,
    ) &&
    prev.history.every(
      (meta, index) => meta.id === next.history[index]?.id && meta.updatedAt === next.history[index]?.updatedAt,
    )
  );
};

export class InMemoryTransactionController implements TransactionController {
  #messenger: TransactionMessenger;
  #network: Pick<NetworkController, "getActiveChain">;
  #accounts: Pick<AccountController, "getActivePointer">;
  #approvals: Pick<ApprovalController, "requestApproval">;
  #generateId: () => string;
  #now: () => number;
  #autoApprove: boolean;
  #autoRejectMessage: string;
  #state: TransactionState;

  constructor({
    messenger,
    network,
    accounts,
    approvals,
    idGenerator,
    now,
    autoApprove = false,
    autoRejectMessage = DEFAULT_REJECTION_MESSAGE,
    initialState,
  }: TransactionControllerOptions) {
    this.#messenger = messenger;
    this.#network = network;
    this.#accounts = accounts;
    this.#approvals = approvals;
    this.#generateId = idGenerator ?? defaultIdGenerator;
    this.#now = now ?? Date.now;
    this.#autoApprove = autoApprove;
    this.#autoRejectMessage = autoRejectMessage;
    this.#state = cloneState(initialState ?? { pending: [], history: [] });
    this.#publishState();
  }
  getState(): TransactionState {
    return cloneState(this.#state);
  }

  async submitTransaction(origin: string, request: TransactionRequest): Promise<TransactionMeta> {
    const activeChain = this.#network.getActiveChain();
    const resolvedCaip2 = request.caip2 ?? activeChain.chainRef;

    if (!activeChain) {
      throw new Error("Active chain is required for transactions");
    }

    const id = this.#generateId();

    const timestamp = this.#now();

    const fromAddress = this.#resolveFrom(request) ?? this.#accounts.getActivePointer()?.address ?? null;

    const meta: TransactionMeta = {
      id,
      caip2: resolvedCaip2,
      origin,
      from: fromAddress,
      request: cloneRequest({ ...request, caip2: resolvedCaip2 }),
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.#state = {
      pending: [...this.#state.pending, meta],
      history: [...this.#state.history],
    };

    this.#publishState();
    this.#publishQueued(meta);

    const task = this.#createApprovalTask(meta);
    const strategy: ApprovalStrategy<TransactionApprovalTaskPayload, TransactionMeta> = async () => {
      if (this.#autoApprove) {
        const approved = await this.approveTransaction(id);
        if (!approved) {
          throw new Error(`Transaction ${id} could not be approved`);
        }
        return approved;
      }

      await this.rejectTransaction(id, new Error(this.#autoRejectMessage));
      const rejection = Object.assign(new Error(this.#autoRejectMessage), {
        name: "TransactionRejectedError",
      });
      throw rejection;
    };

    return this.#approvals.requestApproval(task, strategy);
  }

  async approveTransaction(id: string): Promise<TransactionMeta | null> {
    const index = this.#state.pending.findIndex((meta) => meta.id === id);
    if (index === -1) {
      return null;
    }
    const now = this.#now();
    const current = this.#state.pending[index]!;
    const updated: TransactionMeta = {
      ...cloneMeta(current),
      status: "approved",
      updatedAt: now,
    };

    const nextPending = [...this.#state.pending];
    nextPending.splice(index, 1);
    const nextHistory = [...this.#state.history, updated];

    this.#state = { pending: nextPending, history: nextHistory };
    this.#publishState();
    this.#publishUpdated(updated);
    return updated;
  }

  async rejectTransaction(id: string, reason?: Error): Promise<void> {
    const index = this.#state.pending.findIndex((meta) => meta.id === id);
    if (index === -1) {
      return;
    }

    const now = this.#now();
    const current = this.#state.pending[index]!;
    const updated: TransactionMeta = {
      ...cloneMeta(current),
      status: "failed",
      updatedAt: now,
    };

    const nextPending = [...this.#state.pending];
    nextPending.splice(index, 1);
    const nextHistory = [...this.#state.history, updated];

    this.#state = { pending: nextPending, history: nextHistory };
    this.#publishState();
    this.#publishUpdated(updated);
  }

  onStateChanged(handler: (state: TransactionState) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATE_TOPIC, handler);
  }

  onUpdated(handler: (meta: TransactionMeta) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_UPDATED_TOPIC, handler);
  }

  onQueued(handler: (meta: TransactionMeta) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_QUEUED_TOPIC, handler);
  }

  replaceState(state: TransactionState): void {
    this.#state = cloneState(state);
    this.#publishState();
  }

  #createApprovalTask(meta: TransactionMeta): TransactionApprovalTask {
    return {
      id: meta.id,
      type: ApprovalTypes.SendTransaction,
      origin: meta.origin,
      namespace: meta.request.namespace,
      chainRef: meta.caip2,
      payload: {
        caip2: meta.caip2,
        origin: meta.origin,
        request: cloneRequest(meta.request),
      },
    };
  }

  #resolveFrom(request: TransactionRequest): AccountAddress | null {
    if (request.namespace === "eip155") {
      return (request.payload.from as AccountAddress) ?? null;
    }
    const payload = request.payload;
    if (typeof payload.from === "string") {
      return payload.from as AccountAddress;
    }
    return null;
  }

  #publishState() {
    this.#messenger.publish(TRANSACTION_STATE_TOPIC, cloneState(this.#state), {
      compare: isSameState,
    });
  }

  #publishQueued(meta: TransactionMeta) {
    this.#messenger.publish(TRANSACTION_QUEUED_TOPIC, cloneMeta(meta), {
      compare: (prev, next) => prev?.id === next?.id && prev?.updatedAt === next?.updatedAt,
    });
  }

  #publishUpdated(meta: TransactionMeta) {
    this.#messenger.publish(TRANSACTION_UPDATED_TOPIC, cloneMeta(meta), {
      compare: (prev, next) => prev?.id === next?.id && prev?.updatedAt === next?.updatedAt,
    });
  }
}
