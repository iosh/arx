import type { Hex } from "ox/Hex";
import type { ChainRef } from "../../chains/ids.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { AccountAddress, AccountController } from "../account/types.js";
import type { ApprovalController, ApprovalTask } from "../approval/types.js";
import type { NetworkController } from "../network/types.js";
export type TransactionStatus = "pending" | "approved" | "signed" | "broadcast" | "confirmed" | "failed" | "replaced";

export type TransactionWarning = {
  code: string;
  message: string;
  data?: unknown;
};

export type TransactionIssue = TransactionWarning;

export type TransactionError = {
  name: string;
  message: string;
  code?: number | undefined;
  data?: unknown;
};

export type TransactionReceipt = Record<string, unknown>;

export type TransactionDraftPreview = {
  summary: Record<string, unknown>;
  issues: TransactionIssue[];
  warnings: TransactionWarning[];
};
export type TransactionApprovalChainMetadata = {
  chainRef: ChainRef;
  namespace: string;
  name: string;
  shortName?: string | null;
  chainId?: Hex | null;
  nativeCurrency?: {
    symbol: string;
    decimals: number;
  } | null;
};

export type TransactionStatusChange = {
  id: string;
  previousStatus: TransactionStatus;
  nextStatus: TransactionStatus;
  meta: TransactionMeta;
};

export type Eip155TransactionPayload = {
  chainId?: Hex;
  from?: AccountAddress;
  to?: AccountAddress | null;
  value?: Hex;
  data?: Hex;
  gas?: Hex;
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
  nonce?: Hex;
};

export type TransactionApprovalDecodedPayload = Record<string, unknown>;

export type TransactionPayloadMap = {
  eip155: Eip155TransactionPayload;
};

export type TransactionRequest<TNamespace extends string = keyof TransactionPayloadMap | string> = {
  namespace: TNamespace;
  chainRef?: ChainRef | undefined;
  payload: TNamespace extends keyof TransactionPayloadMap ? TransactionPayloadMap[TNamespace] : Record<string, unknown>;
};

export type TransactionMeta = {
  id: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  request: TransactionRequest;
  status: TransactionStatus;
  hash: string | null;
  receipt: TransactionReceipt | null;
  error: TransactionError | null;
  userRejected: boolean;
  warnings: TransactionWarning[];
  issues: TransactionIssue[];
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
  "transaction:statusChanged": TransactionStatusChange;
};

export type TransactionMessenger = ControllerMessenger<TransactionMessengerTopics>;

export type TransactionApprovalTaskPayload = {
  chainRef: ChainRef;
  origin: string;
  chain?: TransactionApprovalChainMetadata | null;
  from: AccountAddress | null;
  request: TransactionRequest;
  draft?: TransactionDraftPreview | null;
  prepared?: Record<string, unknown> | null;
  decoded?: TransactionApprovalDecodedPayload | null;
  warnings: TransactionWarning[];
  issues: TransactionIssue[];
};

export type TransactionApprovalTask = ApprovalTask<TransactionApprovalTaskPayload>;

export type TransactionControllerOptions = {
  messenger: TransactionMessenger;
  network: Pick<NetworkController, "getActiveChain" | "getChain">;
  accounts: Pick<AccountController, "getActivePointer">;
  approvals: Pick<ApprovalController, "requestApproval">;
  registry: TransactionAdapterRegistry;
  idGenerator?: () => string;
  now?: () => number;
  initialState?: TransactionState;
  tracker?: ReceiptTracker;
};

export type TransactionController = {
  getState(): TransactionState;
  getMeta(id: string): TransactionMeta | undefined;
  submitTransaction(origin: string, request: TransactionRequest): Promise<TransactionMeta>;
  approveTransaction(id: string): Promise<TransactionMeta | null>;
  rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void>;
  processTransaction(id: string): Promise<void>;
  resumePending(): Promise<void>;
  replaceState(state: TransactionState): void;
  hydrate(state: TransactionState): void;
  onStateChanged(handler: (state: TransactionState) => void): () => void;
  onQueued(handler: (meta: TransactionMeta) => void): () => void;
  onStatusChanged(handler: (change: TransactionStatusChange) => void): () => void;
};
