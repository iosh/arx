import type { Accounts } from "../accounts/Accounts.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import { NetworkNotFoundError } from "../networks/errors.js";
import type { NetworksReader } from "../networks/types.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { Eip155TransactionPreparer } from "./eip155/prepareTransaction.js";
import type { PreparedTransaction, PrepareTransactionInput } from "./preparedTransaction.js";
import type { Transaction, TransactionId, TransactionPage, TransactionQuery } from "./types.js";

export type TransactionsChanged = Readonly<{
  type: "transactionsChanged";
  transactionIds: readonly TransactionId[];
}>;

export type Transactions = Readonly<{
  prepare(input: PrepareTransactionInput): Promise<PreparedTransaction>;
  get(transactionId: TransactionId): Promise<Transaction | null>;
  list(query: TransactionQuery): Promise<TransactionPage>;
}>;

type TransactionsOptions = Readonly<{
  readers: Pick<CorePersistenceReaders, "transactions">;
  accounts: Pick<Accounts, "getAccount" | "getAddress">;
  networks: Pick<NetworksReader, "get">;
  prepareEip155Transaction: Eip155TransactionPreparer;
}>;

export const createTransactions = (params: TransactionsOptions): Transactions => ({
  async prepare(input) {
    if (!params.accounts.getAccount(input.accountId)) throw new AccountNotFoundError(input.accountId);
    if (!params.networks.get(input.chainRef)) throw new NetworkNotFoundError(input.chainRef);

    const { canonicalAddress } = params.accounts.getAddress({
      chainRef: input.chainRef,
      accountId: input.accountId,
    });
    const transaction = await params.prepareEip155Transaction({
      chainRef: input.chainRef,
      from: canonicalAddress,
      transaction: input.transaction,
    });

    return {
      namespace: input.namespace,
      chainRef: input.chainRef,
      accountId: input.accountId,
      initiator: input.initiator,
      transaction,
    };
  },

  get: (transactionId) => params.readers.transactions.get(transactionId),
  list: (query) => params.readers.transactions.list(query),
});
