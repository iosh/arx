import { ArxReasons, arxError } from "@arx/errors";
import * as Hex from "ox/Hex";
import * as Value from "ox/Value";
import type { TransactionRequest } from "../../../transactions/types.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";
import { assertUnlocked } from "./lib.js";

export const createTransactionsHandlers = (
  deps: Pick<UiRuntimeDeps, "controllers" | "chainViews" | "session" | "uiOrigin">,
  uiSessionId: string,
): Pick<UiHandlers, "ui.transactions.requestSendTransactionApproval"> => {
  return {
    "ui.transactions.requestSendTransactionApproval": async ({ to, valueEther, chainRef }) => {
      assertUnlocked(deps.session);

      const resolvedChainRef = chainRef ?? deps.chainViews.getSelectedChainView().chainRef;

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

      const approvalId = crypto.randomUUID();
      const requestContext = {
        transport: "ui" as const,
        portId: "ui",
        sessionId: uiSessionId,
        requestId: approvalId,
        origin: deps.uiOrigin,
      };

      const request: TransactionRequest = {
        namespace: "eip155",
        chainRef: resolvedChainRef,
        payload: {
          to,
          value: Hex.fromNumber(wei),
        },
      };

      void deps.controllers.transactions
        .requestTransactionApproval(deps.uiOrigin, request, requestContext, { id: approvalId })
        .catch(() => {});

      return { approvalId };
    },
  };
};
