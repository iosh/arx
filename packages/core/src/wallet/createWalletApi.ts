import type { AccountAddressingByNamespace } from "../accounts/addressing/addressing.js";
import type { ApprovalDetails } from "../approvals/approvalDetails.js";
import type {
  WalletAccounts,
  WalletApprovals,
  WalletAttention,
  WalletNetworks,
  WalletSession,
} from "../engine/types.js";
import {
  createMethodApiProxy,
  createMethodExecutor,
  type MethodCall,
  type MethodExecutor,
  type MethodHandlerTree,
} from "../invoke/methods.js";
import type { NamespaceRuntimeServices } from "../namespaces/index.js";
import type { WalletTransactionAccess } from "../transactions/TransactionsService.js";
import { createAccountsHandlers } from "./actions/accounts.js";
import { createApprovalsHandlers } from "./actions/approvals.js";
import { createAttentionHandlers } from "./actions/attention.js";
import { createBalancesHandlers } from "./actions/balances.js";
import { createNetworksHandlers } from "./actions/chains.js";
import { createKeyringsHandlers } from "./actions/keyrings.js";
import { createSessionHandlers } from "./actions/session.js";
import { createSetupHandlers } from "./actions/setup.js";
import type { WalletSetupWorkflow } from "./actions/setupWorkflow.js";
import { createTransactionHandlers } from "./actions/transactions.js";
import type { WalletApi } from "./api.js";

export type WalletMethodExecutor = MethodExecutor;
export type WalletMethodHandlers = MethodHandlerTree<WalletApi>;

export type CreateWalletMethodHandlersDeps = Readonly<{
  session: WalletSession;
  accounts: WalletAccounts;
  networks: WalletNetworks;
  approvals: WalletApprovals;
  approvalDetails: ApprovalDetails;
  attention: Pick<WalletAttention, "getSnapshot">;
  accountAddressing: AccountAddressingByNamespace;
  caller: {
    origin: string;
  };
  namespaceRuntime: NamespaceRuntimeServices;
  transactions: WalletTransactionAccess;
  setupWorkflow: WalletSetupWorkflow;
}>;

export const createWalletMethodHandlers = (deps: CreateWalletMethodHandlersDeps): WalletMethodHandlers =>
  ({
    session: createSessionHandlers(deps.session),
    setup: createSetupHandlers({
      session: deps.session,
      accounts: deps.accounts,
      networks: deps.networks,
      setupWorkflow: deps.setupWorkflow,
    }),
    accounts: createAccountsHandlers({
      accounts: deps.accounts,
      networks: deps.networks,
    }),
    networks: createNetworksHandlers(deps.networks),
    balances: createBalancesHandlers({
      session: deps.session,
      accounts: deps.accounts,
      networks: deps.networks,
      namespaceRuntime: deps.namespaceRuntime,
    }),
    attention: createAttentionHandlers(deps.attention),
    approvals: createApprovalsHandlers({
      approvals: deps.approvals,
      approvalDetails: deps.approvalDetails,
    }),
    keyrings: createKeyringsHandlers({
      session: deps.session,
      accounts: deps.accounts,
      networks: deps.networks,
      accountAddressing: deps.accountAddressing,
    }),
    transactions: createTransactionHandlers({
      session: deps.session,
      accounts: deps.accounts,
      networks: deps.networks,
      transactions: deps.transactions,
      caller: deps.caller,
    }),
  }) as const satisfies MethodHandlerTree<WalletApi>;

export const createWalletMethodExecutor = (handlers: WalletMethodHandlers): WalletMethodExecutor =>
  createMethodExecutor<WalletApi>({ handlers });

export const createWalletApiFromExecutor = (executor: MethodExecutor): WalletApi => {
  const call: MethodCall = async <TResult>(path: string, input?: unknown): Promise<TResult> => {
    return (await executor.executePath(path, input)) as TResult;
  };
  return createMethodApiProxy<WalletApi>(call);
};

export const createWalletApi = (handlers: WalletMethodHandlers): WalletApi =>
  createWalletApiFromExecutor(createWalletMethodExecutor(handlers));
