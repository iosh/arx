import { canonicalChainAddressFromAccountId } from "../../../accounts/addressing/accountId.js";
import type { AccountAddressingByNamespace } from "../../../accounts/addressing/addressing.js";
import type { ChainAddressingByNamespace } from "../../../chains/addressing.js";
import type { AccountSigningService } from "../../../keyring/accountSigning.js";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import type { TransactionJsonObject, TransactionRecord } from "../../persistence.js";
import type {
  TransactionFinalizationResult,
  TransactionInspection,
  TransactionNamespaceAdapter,
  TransactionSubmissionInput,
} from "../../transactionNamespace.js";
import type { SubmittedTransactionInspection } from "../types.js";
import { createEip155Broadcaster } from "./broadcaster.js";
import { createEip155ReceiptService } from "./receipt.js";
import { createEip155Signer } from "./signer.js";
import {
  createEip155ReplacementRequest,
  EIP155_INITIAL_INSPECTION_DELAY_MS,
  EIP155_PENDING_INSPECTION_DELAY_MS,
  EIP155_RETRY_BASE_DELAY_MS,
  EIP155_RETRY_MAX_DELAY_MS,
  finalizeEip155Submit,
} from "./transaction.js";
import type { Eip155SubmittedTransaction } from "./transactionTypes.js";
import type { Eip155FinalizeSubmitContext } from "./types.js";
import type { Eip155PreparedTransaction, Eip155UnsignedTransaction } from "./unsignedTransaction.js";

const asJsonObject = (value: object): TransactionJsonObject => value as unknown as TransactionJsonObject;

const eip155AddressForAccount = (
  accounts: AccountAddressingByNamespace,
  input: { chainRef: string; accountId: string },
): string =>
  canonicalChainAddressFromAccountId({
    chainRef: input.chainRef,
    accountId: input.accountId,
    accountAddressing: accounts,
  });

const toLocalActiveTransactions = (records: readonly TransactionRecord[]) =>
  records.flatMap((record) => {
    if (record.status !== "submitting" && record.status !== "submitted") return [];
    return [
      {
        transactionId: record.transactionId,
        status: record.status,
        approvedPayload: record.signingPayload as Eip155UnsignedTransaction,
        conflictKey: record.conflictKey ?? null,
      },
    ];
  });

const buildFinalizationContext = (input: {
  transactionId: string;
  submission: TransactionSubmissionInput;
  activeTransactions: readonly TransactionRecord[];
  accounts: AccountAddressingByNamespace;
}): Eip155FinalizeSubmitContext => {
  const { transactionId, submission, activeTransactions } = input;
  const preparedPayload = submission.finalizationPayload as Eip155PreparedTransaction;
  return {
    transactionId,
    namespace: "eip155",
    chainRef: submission.chainRef,
    origin: submission.origin,
    accountId: submission.accountId,
    from: eip155AddressForAccount(input.accounts, submission),
    request: { namespace: "eip155", chainRef: submission.chainRef, payload: preparedPayload },
    preparedPayload,
    replacement: submission.replacementTargetId
      ? { transactionId: submission.replacementTargetId, type: "speed_up" }
      : null,
    localActiveTransactions: toLocalActiveTransactions(activeTransactions),
  };
};

const toFinalizationResult = (
  finalized: Awaited<ReturnType<typeof finalizeEip155Submit>>,
): TransactionFinalizationResult => {
  if (finalized.status === "approved") {
    return {
      status: "ready",
      signingPayload: asJsonObject(finalized.approvedPayload),
      ...(finalized.conflictKey ? { conflictKey: finalized.conflictKey } : {}),
    };
  }
  return {
    status: "rejected",
    reason: finalized.status === "blocked" ? finalized.blocker : finalized.error,
  };
};

const toInspectionResult = (inspection: SubmittedTransactionInspection<"eip155">): TransactionInspection => {
  switch (inspection.trackingStatus) {
    case "pending":
      return { status: "pending", ...(inspection.evidence ? { evidence: inspection.evidence } : {}) };
    case "confirmed":
      return { status: "confirmed", confirmation: asJsonObject(inspection.receipt) };
    case "failed":
      return {
        status: "failed",
        reason: inspection.error,
        ...(inspection.receipt ? { evidence: asJsonObject(inspection.receipt) } : {}),
      };
    case "dropped":
      return { status: "dropped", ...(inspection.evidence ? { evidence: inspection.evidence } : {}) };
    case "expired":
      return { status: "expired", ...(inspection.evidence ? { evidence: inspection.evidence } : {}) };
  }
};

const retryInspectionDelay = (attempt: number): number => {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(EIP155_RETRY_MAX_DELAY_MS, EIP155_RETRY_BASE_DELAY_MS * 2 ** exponent);
};

export const createEip155TransactionAdapter = (params: {
  rpcClientFactory(chainRef: string): Eip155RpcClient;
  chains: ChainAddressingByNamespace;
  accounts: AccountAddressingByNamespace;
  accountSigning: AccountSigningService;
}): TransactionNamespaceAdapter => {
  const signer = createEip155Signer({ accountSigning: params.accountSigning });
  const broadcaster = createEip155Broadcaster({ rpcClientFactory: params.rpcClientFactory });
  const receipts = createEip155ReceiptService({ rpcClientFactory: params.rpcClientFactory });

  return {
    namespace: "eip155",
    getResourceKey: (input) => ({ kind: "eip155.account", value: `${input.chainRef}:${input.accountId}` }),
    finalize: async ({ transactionId, submission, activeTransactions }) => {
      const context = buildFinalizationContext({
        transactionId,
        submission,
        activeTransactions,
        accounts: params.accounts,
      });
      const finalized = await finalizeEip155Submit(context, { rpcClientFactory: params.rpcClientFactory });
      return toFinalizationResult(finalized);
    },
    createReplacementPayload: async ({ target, type }) => {
      const approved = target.signingPayload as Eip155UnsignedTransaction;
      const request = await createEip155ReplacementRequest(
        {
          namespace: "eip155",
          chainRef: target.chainRef,
          origin: target.origin,
          accountId: target.accountId,
          from: eip155AddressForAccount(params.accounts, target),
          type: type === "speed-up" ? "speed_up" : type,
          targetTransactionId: target.transactionId,
          targetRequest: { namespace: "eip155", chainRef: target.chainRef, payload: approved },
          targetApprovedPayload: approved,
        },
        { rpcClientFactory: params.rpcClientFactory },
      );
      return asJsonObject(request.payload);
    },
    sign: async ({ accountId, chainRef, signingPayload }) => {
      const approved = signingPayload as Eip155UnsignedTransaction;
      const signed = await signer.signTransaction(
        {
          namespace: "eip155",
          chainRef,
          origin: "wallet",
          from: eip155AddressForAccount(params.accounts, { chainRef, accountId }),
          request: { namespace: "eip155", chainRef, payload: approved },
        },
        approved,
      );
      return { raw: signed.raw };
    },
    broadcast: async ({ chainRef, signingPayload, signedPayload }) => {
      const approved = signingPayload as Eip155UnsignedTransaction;
      const sent = await broadcaster.broadcast(
        {
          namespace: "eip155",
          chainRef,
          origin: "wallet",
          from: approved.from,
          request: { namespace: "eip155", chainRef, payload: approved },
        },
        { raw: String(signedPayload.raw) },
      );
      return {
        status: "submitted",
        networkSubmission: asJsonObject({ hash: sent.hash, ...approved }),
      };
    },
    inspect: async (record) => {
      const submitted = record.networkSubmission as Eip155SubmittedTransaction;
      const inspection = await receipts.inspectSubmittedTransaction({
        recordId: record.transactionId,
        namespace: "eip155",
        chainRef: record.chainRef,
        origin: record.origin,
        from: submitted.from,
        submitted,
      });
      return toInspectionResult(inspection);
    },
    getInitialInspectionDelay: () => EIP155_INITIAL_INSPECTION_DELAY_MS,
    getPendingInspectionDelay: () => EIP155_PENDING_INSPECTION_DELAY_MS,
    getRetryInspectionDelay: ({ attempt }) => retryInspectionDelay(attempt),
  };
};
