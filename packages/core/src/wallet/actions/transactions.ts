import type { ActiveAccountView } from "../../accounts/runtime/types.js";
import { ChainNotSupportedError } from "../../chains/errors.js";
import type { ChainRef } from "../../chains/ids.js";
import { PermissionDeniedError } from "../../permissions/errors.js";
import type { ListTransactionsQuery } from "../../transactions/TransactionsService.js";
import type { TransactionRequest, WalletTransactionRequest } from "../../transactions/types.js";
import type {
  PrepareTransactionInput,
  SubmitTransactionInput,
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
  if (input.accountId !== undefined) {
    query.accountId = input.accountId;
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

export const prepareTransaction = async (context: WalletApiContext, input: PrepareTransactionInput) => {
  assertSessionUnlocked(context);
  const walletRequest = input.request;
  const chainRef = resolveWalletTransactionChainRef(context, walletRequest);
  const transactionRequest = buildTransactionRequestFromWalletRequest(walletRequest, chainRef);
  const activeAccount = resolveWalletTransactionAccount(context, transactionRequest);

  return await context.transactions.prepareTransaction({
    namespace: transactionRequest.namespace,
    chainRef: transactionRequest.chainRef,
    origin: context.caller.origin,
    source: "wallet-ui",
    accountId: activeAccount.accountId,
    request: {
      payload: transactionRequest.payload,
    },
    replacement: null,
  });
};

export const submitTransaction = async (context: WalletApiContext, input: SubmitTransactionInput) => {
  assertSessionUnlocked(context);
  return await context.transactions.submitTransaction({
    proposal: input.proposal,
  });
};
