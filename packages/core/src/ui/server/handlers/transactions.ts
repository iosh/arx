import { ArxReasons, arxError } from "@arx/errors";
import * as Value from "ox/Value";
import type { JsonValue } from "../../../transactions/aggregate/index.js";
import type { ListTransactionsQuery } from "../../../transactions/TransactionsService.js";
import type { TransactionRequest } from "../../../transactions/types.js";
import type { UiMethodParams } from "../../protocol/index.js";
import type {
  UiAccountsAccess,
  UiChainsAccess,
  UiHandlers,
  UiNamespaceBindingsAccess,
  UiSessionAccess,
  UiSurfaceIdentity,
  UiTransactionsAccess,
} from "../types.js";
import { assertUnlocked } from "./lib.js";

const buildListTransactionsQuery = (
  input: UiMethodParams<"ui.transactions.listHistory">,
): ListTransactionsQuery | undefined => {
  if (input === undefined) {
    return undefined;
  }

  return {
    ...(input.namespace !== undefined ? { namespace: input.namespace } : {}),
    ...(input.chainRef !== undefined ? { chainRef: input.chainRef } : {}),
    ...(input.accountKey !== undefined ? { accountKey: input.accountKey } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.before !== undefined ? { before: input.before } : {}),
  };
};

export const createTransactionsHandlers = (deps: {
  transactions: UiTransactionsAccess;
  chains: UiChainsAccess;
  accounts: Pick<UiAccountsAccess, "getActiveAccountForNamespace">;
  session: UiSessionAccess;
  namespaceBindings: UiNamespaceBindingsAccess;
  surface: UiSurfaceIdentity;
}): Pick<
  UiHandlers,
  | "ui.transactions.listHistory"
  | "ui.transactions.getDetail"
  | "ui.transactions.requestSendTransactionApproval"
  | "ui.transactions.rerunPrepare"
  | "ui.transactions.applyDraftEdit"
> => {
  return {
    "ui.transactions.listHistory": async (query) => {
      assertUnlocked(deps.session);
      return await deps.transactions.listTransactions(buildListTransactionsQuery(query));
    },
    "ui.transactions.getDetail": async ({ transactionId }) => {
      assertUnlocked(deps.session);
      return await deps.transactions.getTransaction(transactionId);
    },
    "ui.transactions.requestSendTransactionApproval": async ({ to, valueEther, chainRef }) => {
      assertUnlocked(deps.session);

      const resolvedChainRef = chainRef ?? deps.chains.getSelectedChainView().chainRef;
      const chain = deps.chains.requireAvailableChainMetadata(resolvedChainRef);
      const uiBindings = deps.namespaceBindings.getUi(chain.namespace);
      const sendSupported =
        Boolean(uiBindings?.createSendTransactionRequest) && deps.namespaceBindings.hasTransaction(chain.namespace);
      if (!sendSupported || !uiBindings?.createSendTransactionRequest) {
        throw arxError({
          reason: ArxReasons.ChainNotSupported,
          message: `Send transaction is not supported for namespace "${chain.namespace}" yet.`,
          data: { chainRef: resolvedChainRef, namespace: chain.namespace },
        });
      }

      const activeAccount = deps.accounts.getActiveAccountForNamespace({
        namespace: chain.namespace,
        chainRef: resolvedChainRef,
      });
      if (!activeAccount) {
        throw arxError({
          reason: ArxReasons.PermissionDenied,
          message: "No active account is available to send this transaction.",
          data: { chainRef: resolvedChainRef, namespace: chain.namespace },
        });
      }

      const trimmedValue = valueEther.trim();
      let wei: bigint;
      try {
        wei = Value.fromEther(trimmedValue);
      } catch (error) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: "Invalid amount",
          data: { valueEther: trimmedValue, error: error instanceof Error ? error.message : String(error) },
        });
      }

      const request: TransactionRequest = uiBindings.createSendTransactionRequest({
        chainRef: resolvedChainRef,
        to,
        valueWei: wei,
      });

      const approval = await deps.transactions.requestTransactionApproval({
        namespace: chain.namespace,
        chainRef: resolvedChainRef,
        origin: deps.surface.origin,
        source: "wallet",
        requestId: crypto.randomUUID(),
        accountKey: activeAccount.accountKey,
        approvalId: crypto.randomUUID(),
        request: {
          kind: `${chain.namespace}.wallet.native_transfer`,
          payload: request.payload as JsonValue,
        },
      });

      return { approvalId: approval.approval.approvalId };
    },
    "ui.transactions.rerunPrepare": async ({ transactionId }) => {
      assertUnlocked(deps.session);
      const approval = deps.transactions.getTransactionApprovalByTransactionId(transactionId);
      if (!approval) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: "Transaction approval was not found.",
          data: { transactionId },
        });
      }
      await deps.transactions.rerunApprovalPrepare({ approvalId: approval.approvalId });
      return null;
    },
    "ui.transactions.applyDraftEdit": async ({ transactionId, edit, mode }) => {
      assertUnlocked(deps.session);
      const approval = deps.transactions.getTransactionApprovalByTransactionId(transactionId);
      if (!approval) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: "Transaction approval was not found.",
          data: { transactionId },
        });
      }
      await deps.transactions.updateApprovalDraft({
        approvalId: approval.approvalId,
        edit,
        ...(mode ? { mode } : {}),
      });
      return null;
    },
  };
};
