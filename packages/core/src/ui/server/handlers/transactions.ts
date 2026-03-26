import { ArxReasons, arxError } from "@arx/errors";
import * as Value from "ox/Value";
import type { RequestContext } from "../../../rpc/requestContext.js";
import type { TransactionRequest } from "../../../transactions/types.js";
import type {
  UiChainsAccess,
  UiHandlers,
  UiNamespaceBindingsAccess,
  UiSessionAccess,
  UiSurfaceIdentity,
  UiTransactionsAccess,
} from "../types.js";
import { assertUnlocked } from "./lib.js";

const createUiRequestContext = (surface: UiSurfaceIdentity): RequestContext => ({
  transport: surface.transport,
  portId: surface.portId,
  sessionId: surface.surfaceId,
  requestId: crypto.randomUUID(),
  origin: surface.origin,
});

export const createTransactionsHandlers = (deps: {
  transactions: UiTransactionsAccess;
  chains: UiChainsAccess;
  session: UiSessionAccess;
  namespaceBindings: UiNamespaceBindingsAccess;
  surface: UiSurfaceIdentity;
}): Pick<UiHandlers, "ui.transactions.requestSendTransactionApproval"> => {
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

      const requestContext = createUiRequestContext(deps.surface);

      const request: TransactionRequest = uiBindings.createSendTransactionRequest({
        chainRef: resolvedChainRef,
        to,
        valueWei: wei,
      });

      const handoff = await deps.transactions.beginTransactionApproval(request, requestContext);

      return { approvalId: handoff.approvalId };
    },
  };
};
