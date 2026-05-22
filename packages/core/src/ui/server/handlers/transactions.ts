import { ArxReasons, arxError } from "@arx/errors";
import * as Value from "ox/Value";
import type { ApprovalRequester } from "../../../controllers/approval/types.js";
import type { TransactionIntent } from "../../../transactions/intent/index.js";
import type { TransactionCaller, TransactionRequest } from "../../../transactions/types.js";
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

const createUiApprovalRequester = (surface: UiSurfaceIdentity): ApprovalRequester => ({
  origin: surface.origin,
  initiator: "wallet_ui",
  requestId: crypto.randomUUID(),
});

const createUiTransactionCaller = (surface: UiSurfaceIdentity): TransactionCaller => ({
  origin: surface.origin,
});

export const createTransactionsHandlers = (deps: {
  transactions: UiTransactionsAccess;
  chains: UiChainsAccess;
  accounts: Pick<UiAccountsAccess, "getActiveAccountForNamespace">;
  session: UiSessionAccess;
  namespaceBindings: UiNamespaceBindingsAccess;
  surface: UiSurfaceIdentity;
}): Pick<
  UiHandlers,
  "ui.transactions.requestSendTransactionApproval" | "ui.transactions.rerunPrepare" | "ui.transactions.applyDraftEdit"
> => {
  return {
    "ui.transactions.requestSendTransactionApproval": async ({ to, valueEther, chainRef }) => {
      assertUnlocked(deps.session);

      const resolvedChainRef = chainRef ?? deps.chains.getSelectedChainView().chainRef;
      const chain = deps.chains.requireAvailableChainMetadata(resolvedChainRef);
      const uiBindings = deps.namespaceBindings.getUi(chain.namespace);
      const sendSupported =
        Boolean(uiBindings?.createSendTransactionRequest) &&
        deps.namespaceBindings.hasTransaction(chain.namespace) &&
        deps.namespaceBindings.hasTransactionReceiptTracking(chain.namespace);
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

      const caller = createUiTransactionCaller(deps.surface);
      const requester = createUiApprovalRequester(deps.surface);

      const request: TransactionRequest = uiBindings.createSendTransactionRequest({
        chainRef: resolvedChainRef,
        to,
        valueWei: wei,
      });
      const intent: TransactionIntent = {
        namespace: chain.namespace,
        chainRef: resolvedChainRef,
        account: {
          accountKey: activeAccount.accountKey,
          accountAddress: activeAccount.canonicalAddress,
        },
        request,
      };

      const proposal = await deps.transactions.commands.createProposal(intent, {
        caller,
      });

      const approval = await deps.transactions.commands.requestApproval(proposal.transactionId, {
        requester,
      });

      return { approvalId: approval.approvalId };
    },
    "ui.transactions.rerunPrepare": async ({ transactionId }) => {
      assertUnlocked(deps.session);
      await deps.transactions.commands.recomputePrepare(transactionId);
      return null;
    },
    "ui.transactions.applyDraftEdit": async ({ transactionId, edit, mode }) => {
      assertUnlocked(deps.session);
      await deps.transactions.commands.editRequest({
        transactionId,
        edit,
        ...(mode ? { mode } : {}),
      });
      return null;
    },
  };
};
