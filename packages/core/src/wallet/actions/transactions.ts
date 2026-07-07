import type { ActiveAccountView } from "../../accounts/runtime/types.js";
import { ChainNotSupportedError } from "../../chains/errors.js";
import type { ChainRef } from "../../chains/ids.js";
import type { WalletAccounts, WalletNetworks, WalletSession } from "../../engine/types.js";
import { PermissionDeniedError } from "../../permissions/errors.js";
import type { ListTransactionsQuery, WalletTransactionAccess } from "../../transactions/TransactionsService.js";
import type { TransactionRequest, WalletTransactionRequest } from "../../transactions/types.js";
import type {
  PrepareTransactionInput,
  SubmitTransactionInput,
  WalletApiTransactionDetailInput,
  WalletApiTransactionsInput,
} from "../api.js";
import { getSelectedWalletChainRefForNamespace } from "./chains.js";
import { assertSessionUnlocked } from "./session.js";

type TransactionHandlersDeps = {
  session: Pick<WalletSession, "isUnlocked">;
  accounts: Pick<WalletAccounts, "getActiveAccountForNamespace">;
  networks: Pick<WalletNetworks, "getSelectedChainRef" | "getActiveChainViewForNamespace" | "findAvailableChainView">;
  transactions: WalletTransactionAccess;
  caller: {
    origin: string;
  };
};

const resolveWalletTransactionChainRef = (
  deps: Pick<TransactionHandlersDeps, "networks">,
  walletRequest: WalletTransactionRequest,
): ChainRef => {
  const chainRef = getSelectedWalletChainRefForNamespace(deps.networks, walletRequest.namespace);
  const chain = deps.networks.findAvailableChainView({ chainRef });
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

const resolveWalletTransactionAccount = (
  deps: Pick<TransactionHandlersDeps, "accounts">,
  request: TransactionRequest,
): ActiveAccountView => {
  const activeAccount = deps.accounts.getActiveAccountForNamespace({
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

export const createTransactionHandlers = (deps: TransactionHandlersDeps) => ({
  listHistory: async (input?: WalletApiTransactionsInput) =>
    await deps.transactions.listTransactions(buildTransactionHistoryQuery(input)),

  getDetail: async (input: WalletApiTransactionDetailInput) =>
    await deps.transactions.getTransaction(input.transactionId),

  prepareTransaction: async (input: PrepareTransactionInput) => {
    assertSessionUnlocked(deps.session);
    const walletRequest = input.request;
    const chainRef = resolveWalletTransactionChainRef(deps, walletRequest);
    const transactionRequest = buildTransactionRequestFromWalletRequest(walletRequest, chainRef);
    const activeAccount = resolveWalletTransactionAccount(deps, transactionRequest);

    return await deps.transactions.prepareTransaction({
      namespace: transactionRequest.namespace,
      chainRef: transactionRequest.chainRef,
      origin: deps.caller.origin,
      source: "wallet-ui",
      accountId: activeAccount.accountId,
      request: {
        payload: transactionRequest.payload,
      },
      replacement: null,
    });
  },

  submitTransaction: async (input: SubmitTransactionInput) => {
    assertSessionUnlocked(deps.session);
    return await deps.transactions.submitTransaction({
      proposal: input.proposal,
    });
  },
});
