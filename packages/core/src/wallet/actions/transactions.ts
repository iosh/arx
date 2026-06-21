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
import { WalletApiTransactionsSchemas } from "../schemas/transactions.js";
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

const buildTransactionHistoryQuery = (input: WalletApiTransactionsInput): ListTransactionsQuery | undefined => {
  const params = WalletApiTransactionsSchemas.listHistory.parse(input);
  if (!params) {
    return undefined;
  }

  const query: ListTransactionsQuery = {};
  if (params.namespace !== undefined) {
    query.namespace = params.namespace;
  }
  if (params.chainRef !== undefined) {
    query.chainRef = params.chainRef;
  }
  if (params.accountKey !== undefined) {
    query.accountKey = params.accountKey;
  }
  if (params.status !== undefined) {
    query.status = params.status;
  }
  if (params.limit !== undefined) {
    query.limit = params.limit;
  }
  if (params.before !== undefined) {
    query.before = params.before;
  }

  return query;
};

export const listTransactionHistory = async (context: WalletApiContext, input?: WalletApiTransactionsInput) => {
  return await context.transactions.listTransactions(buildTransactionHistoryQuery(input));
};

export const getTransactionDetail = async (context: WalletApiContext, input: WalletApiTransactionDetailInput) => {
  const params = WalletApiTransactionsSchemas.getDetail.parse(input);
  return await context.transactions.getTransaction(params.transactionId);
};

export const requestSendTransactionApproval = async (
  context: WalletApiContext,
  input: RequestSendTransactionApprovalInput,
) => {
  assertSessionUnlocked(context);
  const { request: walletRequest } = WalletApiTransactionsSchemas.requestSendTransactionApproval.parse(input);
  const chainRef = resolveWalletTransactionChainRef(context, walletRequest);
  const transactionRequest = buildTransactionRequestFromWalletRequest(walletRequest, chainRef);
  const activeAccount = resolveWalletTransactionAccount(context, transactionRequest);

  const approval = await context.transactions.requestTransactionApproval({
    namespace: transactionRequest.namespace,
    chainRef: transactionRequest.chainRef,
    origin: context.surface.origin,
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
  const params = WalletApiTransactionsSchemas.rerunPrepare.parse(input);
  await context.transactions.rerunApprovalPrepare({ approvalId: params.approvalId });
  return null;
};

export const applyTransactionDraftEdit = async (context: WalletApiContext, input: ApplyTransactionDraftEditInput) => {
  assertSessionUnlocked(context);
  const params = WalletApiTransactionsSchemas.applyDraftEdit.parse(input);
  await context.transactions.updateApprovalDraft({
    approvalId: params.approvalId,
    edit: {
      namespace: params.edit.namespace,
      changes: [...params.edit.changes],
    },
    ...(params.mode !== undefined ? { mode: params.mode } : {}),
  });
  return null;
};
