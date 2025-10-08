import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { AccountAddress, AccountController } from "../account/types.js";
import type { ApprovalController, ApprovalTask } from "../approval/types.js";
import type { Caip2ChainId, NetworkController } from "../network/types.js";

export type TransactionStatus = "pending" | "approved" | "submitted" | "failed";

export type Eip155TransactionPayload = {
  from?: AccountAddress;
  to?: AccountAddress | null;
  value?: `0x${string}`;
  data?: `0x${string}`;
  gas?: `0x${string}`;
  gasPrice?: `0x${string}`;
  maxFeePerGas?: `0x${string}`;
  maxPriorityFeePerGas?: `0x${string}`;
  nonce?: `0x${string}`;
};

export type TransactionPayloadMap = {
  eip155: Eip155TransactionPayload;
};

export type TransactionRequest<TNamespace extends string = keyof TransactionPayloadMap | string> = {
  namespace: TNamespace;
  caip2?: Caip2ChainId;
  payload: TNamespace extends keyof TransactionPayloadMap ? TransactionPayloadMap[TNamespace] : Record<string, unknown>;
};

export type TransactionMeta = {
  id: string;
  caip2: Caip2ChainId;
  origin: string;
  from: AccountAddress | null;
  request: TransactionRequest;
  status: TransactionStatus;
  createdAt: number;
  updatedAt: number;
};

export type TransactionState = {
  pending: TransactionMeta[];
  history: TransactionMeta[];
};

export type TransactionMessengerTopics = {
  "transaction:stateChanged": TransactionState;
  "transaction:queued": TransactionMeta;
  "transaction:updated": TransactionMeta;
};

export type TransactionMessenger = ControllerMessenger<TransactionMessengerTopics>;

export type TransactionApprovalTaskPayload = {
  caip2: Caip2ChainId;
  origin: string;
  request: TransactionRequest;
};

export type TransactionApprovalTask = ApprovalTask<TransactionApprovalTaskPayload>;

export type TransactionControllerOptions = {
  messenger: TransactionMessenger;
  network: Pick<NetworkController, "getState">;
  accounts: Pick<AccountController, "getPrimaryAccount">;
  approvals: Pick<ApprovalController, "requestApproval">;
  idGenerator?: () => string;
  now?: () => number;
  autoApprove?: boolean;
  autoRejectMessage?: string;
  initialState?: TransactionState;
};

export type TransactionController = {
  getState(): TransactionState;
  submitTransaction(origin: string, request: TransactionRequest): Promise<TransactionMeta>;
  approveTransaction(id: string): Promise<TransactionMeta | null>;
  rejectTransaction(id: string, reason?: Error): Promise<void>;
  onStateChanged(handler: (state: TransactionState) => void): () => void;
  onQueued(handler: (meta: TransactionMeta) => void): () => void;
  onUpdated(handler: (meta: TransactionMeta) => void): () => void;
  replaceState(state: TransactionState): void;
};
