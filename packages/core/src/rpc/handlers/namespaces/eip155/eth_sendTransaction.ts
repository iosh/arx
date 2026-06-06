import { ArxReasons, arxError } from "@arx/errors";
import type { JsonValue } from "../../../../transactions/aggregate/index.js";
import type { Eip155SubmittedTransaction } from "../../../../transactions/index.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { toParamsArray } from "../utils.js";
import {
  defineEip155AuthorizedAccountApprovalMethod,
  requireProviderRequestHandle,
  requireRequestContext,
} from "./shared.js";
import { buildEip155TransactionRequest } from "./transactionRequest.js";

type EthSendTransactionParams = readonly [unknown, ...unknown[]];

const ETH_SEND_TRANSACTION_REQUEST_KIND = "eip155.rpc.eth_sendTransaction";

export const ethSendTransactionDefinition = defineEip155AuthorizedAccountApprovalMethod({
  requestKind: RpcRequestKinds.TransactionSubmission,
  locked: lockedQueue(),
  parseParams: (params) => {
    const paramsArray = toParamsArray(params);

    if (paramsArray.length === 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "eth_sendTransaction requires at least one transaction parameter",
        data: { params },
      });
    }

    return paramsArray as unknown as EthSendTransactionParams;
  },
  buildAuthorizedExecution: ({ params, invocation }) => {
    const txRequest = buildEip155TransactionRequest(params, invocation.chainRef);
    return {
      address: txRequest.payload.from,
      prepared: txRequest,
    };
  },
  executeAuthorizedRequest: async ({ origin, prepared, account, services, executionContext }) => {
    const requestContext = requireRequestContext(executionContext, "eth_sendTransaction");
    const providerRequestHandle = requireProviderRequestHandle(executionContext, "eth_sendTransaction");

    const approval = await providerRequestHandle.attachBlockingApproval(({ approvalId }) =>
      services.transactions.requestTransactionApproval({
        namespace: "eip155",
        chainRef: prepared.chainRef,
        origin,
        source: "dapp",
        requestId: requestContext.requestId,
        accountKey: account.accountKey,
        approvalId,
        request: {
          kind: ETH_SEND_TRANSACTION_REQUEST_KIND,
          payload: prepared.payload as JsonValue,
        },
      }),
    );

    const outcome = await services.transactions.waitForTransactionSubmissionOutcome({
      transactionId: approval.transaction.id,
      signal: providerRequestHandle.signal,
    });
    if (outcome.kind === "terminal") {
      const reason = outcome.transaction.terminalReason;
      if (outcome.transaction.status === "rejected" && reason?.kind === "user_rejected") {
        throw arxError({
          reason: ArxReasons.ApprovalRejected,
          message: reason.message,
          data: { origin, id: outcome.transaction.id, terminalReason: reason },
        });
      }
      if (outcome.transaction.status === "cancelled" && reason?.code === "provider.caller_disconnected") {
        throw arxError({
          reason: ArxReasons.TransportDisconnected,
          message: reason.message,
          data: { origin, id: outcome.transaction.id, terminalReason: reason },
        });
      }
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: reason?.message ?? "Transaction submission failed",
        data: { origin, id: outcome.transaction.id, terminalReason: reason ?? undefined },
      });
    }

    const submitted = outcome.submitted as Eip155SubmittedTransaction;
    return submitted.hash;
  },
});
