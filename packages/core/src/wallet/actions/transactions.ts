import type { ActiveAccountView } from "../../accounts/runtime/types.js";
import { ChainNotSupportedError } from "../../chains/errors.js";
import type { ChainRef } from "../../chains/ids.js";
import { PermissionDeniedError } from "../../permissions/errors.js";
import type { JsonValue } from "../../transactions/aggregate/index.js";
import type { ListTransactionsQuery } from "../../transactions/TransactionsService.js";
import type { TransactionRequest, WalletTransactionRequest } from "../../transactions/types.js";
import type {
  ApplyTransactionDraftEditInput,
  RequestSendTransactionApprovalInput,
  RerunTransactionPrepareInput,
  WalletApiTransactionDetailInput,
  WalletApiTransactionsInput,
} from "../api.js";
import type { WalletApiContext } from "../context.js";
import { getSelectedWalletChainRefForNamespace } from "./chains.js";
import { assertSessionUnlocked } from "./session.js";

const resolveWalletTransactionChainRef = (
  context: WalletApiContext,
  walletRequest: WalletTransactionRequest,
): ChainRef => {
  const chainRef = getSelectedWalletChainRefForNamespace(context, walletRequest.namespace);
  const chain = context.networks.findAvailableChainView({ chainRef });
  if (!chain) {
    throw new ChainNotSupportedError({
      message: `Send transaction is not supported for chain "${chainRef}" yet.`,
    });
  }
  if (chain.namespace !== walletRequest.namespace) {
    throw new ChainNotSupportedError({
      message: `Wallet selected chain "${chainRef}" is not in namespace "${walletRequest.namespace}".`,
    });
  }

  return chain.chainRef;
};

const resolveWalletTransactionAccount = (context: WalletApiContext, request: TransactionRequest): ActiveAccountView => {
  const activeAccount = context.accounts.getActiveAccountForNamespace({
    namespace: request.namespace,
    chainRef: request.chainRef,
  });
  if (!activeAccount) {
    throw new PermissionDeniedError();
  }

  return activeAccount;
};

const buildTransactionRequestFromWalletRequest = (
  walletRequest: WalletTransactionRequest,
  chainRef: ChainRef,
): TransactionRequest => ({
  namespace: walletRequest.namespace,
  chainRef,
  payload: walletRequest.payload,
});

const buildTransactionHistoryQuery = (input?: WalletApiTransactionsInput): ListTransactionsQuery | undefined => {
  if (!input) {
    return undefined;
  }

  const query: ListTransactionsQuery = {};
  if (input.namespace !== undefined) {
    query.namespace = input.namespace;
  }
  if (input.chainRef !== undefined) {
    query.chainRef = input.chainRef;
  }
  if (input.accountKey !== undefined) {
    query.accountKey = input.accountKey;
  }
  if (input.status !== undefined) {
    query.status = input.status;
  }
  if (input.limit !== undefined) {
    query.limit = input.limit;
  }
  if (input.before !== undefined) {
    query.before = input.before;
  }

  return query;
};

export const listTransactionHistory = async (context: WalletApiContext, input?: WalletApiTransactionsInput) => {
  return await context.transactions.listTransactions(buildTransactionHistoryQuery(input));
};

export const getTransactionDetail = async (context: WalletApiContext, input: WalletApiTransactionDetailInput) => {
  return await context.transactions.getTransaction(input.transactionId);
};

export const requestSendTransactionApproval = async (
  context: WalletApiContext,
  input: RequestSendTransactionApprovalInput,
) => {
  assertSessionUnlocked(context);
  const walletRequest = input.request;
  const chainRef = resolveWalletTransactionChainRef(context, walletRequest);
  const transactionRequest = buildTransactionRequestFromWalletRequest(walletRequest, chainRef);
  const activeAccount = resolveWalletTransactionAccount(context, transactionRequest);

  const approval = await context.transactions.requestTransactionApproval({
    namespace: transactionRequest.namespace,
    chainRef: transactionRequest.chainRef,
    origin: context.caller.origin,
    source: "wallet-ui",
    requestId: context.createId(),
    accountKey: activeAccount.accountKey,
    approvalId: context.createId(),
    request: {
      payload: transactionRequest.payload as JsonValue,
    },
  });

  return { approvalId: approval.approval.approvalId };
};

export const rerunTransactionPrepare = async (context: WalletApiContext, input: RerunTransactionPrepareInput) => {
  assertSessionUnlocked(context);
  await context.transactions.rerunApprovalPrepare({ approvalId: input.approvalId });
  return null;
};

export const applyTransactionDraftEdit = async (context: WalletApiContext, input: ApplyTransactionDraftEditInput) => {
  assertSessionUnlocked(context);
  await context.transactions.updateApprovalDraft({
    approvalId: input.approvalId,
    edit: {
      namespace: input.edit.namespace,
      changes: [...input.edit.changes],
    },
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
  });
  return null;
};
