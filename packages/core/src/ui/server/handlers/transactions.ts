import { ArxReasons, arxError } from "@arx/errors";
import * as Value from "ox/Value";
import type { TransactionRequest } from "../../../transactions/types.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";
import { assertUnlocked } from "./lib.js";

export const createTransactionsHandlers = (
  deps: Pick<UiRuntimeDeps, "transactions" | "chains" | "session" | "namespaceBindings" | "uiOrigin">,
  uiSessionId: string,
): Pick<UiHandlers, "ui.transactions.requestSendTransactionApproval"> => {
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

      const requestContext = {
        transport: "ui" as const,
        portId: "ui",
        sessionId: uiSessionId,
        requestId: crypto.randomUUID(),
        origin: deps.uiOrigin,
      };

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
