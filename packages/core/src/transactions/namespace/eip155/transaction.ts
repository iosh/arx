import * as Hex from "ox/Hex";
import type { ChainAddressingByNamespace } from "../../../chains/addressing.js";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import type { Eip155TransactionRequest } from "../../types.js";
import type { NamespaceTransaction } from "../types.js";
import { applyEip155TransactionDraftEdit } from "./applyDraftEdit.js";
import { buildEip155ApprovalReview } from "./approvalReview.js";
import type { Eip155Broadcaster } from "./broadcaster.js";
import { createEip155PrepareTransaction } from "./prepareTransaction.js";
import { createEip155ReceiptService } from "./receipt.js";
import { deriveEip155TransactionRequestForChain } from "./request.js";
import type { Eip155Signer } from "./signer.js";
import type { Eip155SubmittedTransaction } from "./transactionTypes.js";
import type {
  Eip155ApprovalFinalizeContext,
  Eip155ApprovalFinalizeResult,
  Eip155ApprovalReviewContext,
  Eip155DraftEditContext,
  Eip155PrepareContext,
} from "./types.js";
import { buildEip155TransactionConflictKey, type Eip155UnsignedTransaction } from "./unsignedTransaction.js";
import { createEip155RequestValidator } from "./validateRequest.js";

type AdapterDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcClient;
  chains: ChainAddressingByNamespace;
  signer: Pick<Eip155Signer, "signTransaction">;
  broadcaster: Pick<Eip155Broadcaster, "broadcast">;
};

const EIP155_INITIAL_INSPECTION_DELAY_MS = 3_000;
const EIP155_PENDING_INSPECTION_DELAY_MS = 12_000;
const EIP155_RETRY_BASE_DELAY_MS = 5_000;
const EIP155_RETRY_MAX_DELAY_MS = 60_000;

const requireEip155Request = (request: {
  namespace: string;
  payload?: unknown;
  chainRef: string;
}): Eip155TransactionRequest => {
  if (request.namespace !== "eip155") {
    throw new Error(`EIP-155 transaction received namespace "${request.namespace}"`);
  }
  if (!request.payload || typeof request.payload !== "object" || Array.isArray(request.payload)) {
    throw new Error("EIP-155 transaction request requires an object payload");
  }
  return {
    namespace: "eip155",
    chainRef: request.chainRef,
    payload: request.payload as Eip155TransactionRequest["payload"],
  };
};

const buildEip155SubmittedTransaction = (params: {
  hash: `0x${string}`;
  transaction: Eip155UnsignedTransaction;
}): Eip155SubmittedTransaction => {
  const { type: _type, ...submittedFields } = params.transaction;

  return params.transaction.type === "legacy"
    ? {
        hash: params.hash,
        ...submittedFields,
        gasPrice: params.transaction.gasPrice,
      }
    : {
        hash: params.hash,
        ...submittedFields,
        maxFeePerGas: params.transaction.maxFeePerGas,
        maxPriorityFeePerGas: params.transaction.maxPriorityFeePerGas,
      };
};

const toBroadcastArtifactPayload = (signed: { raw: string }) => ({
  raw: signed.raw,
});

const readSignedTransactionPayload = (broadcastArtifact: { kind: string; payload: Record<string, unknown> }) => {
  const raw = broadcastArtifact.payload.raw;
  if (typeof raw !== "string" || !raw.startsWith("0x")) {
    throw new Error(`EIP-155 broadcast artifact "${broadcastArtifact.kind}" is missing a raw transaction payload.`);
  }

  return {
    raw,
  };
};

const isWalletManagedNonce = (context: Eip155ApprovalFinalizeContext): boolean =>
  context.request.payload.nonce === undefined;

const hasAllowedReplacementTarget = (context: Eip155ApprovalFinalizeContext): boolean => {
  const replacement = context.replacement;
  if (!replacement) {
    return false;
  }

  const replaced = context.localActiveTransactions.find(
    (transaction) => transaction.transactionId === replacement.transactionId,
  );
  if (!replaced || replaced.status !== "submitted") {
    return false;
  }

  return replaced.approvedPayload.nonce === context.approvedPayload.nonce;
};

const findBlockingLocalNonceConflicts = (context: Eip155ApprovalFinalizeContext): string[] => {
  return context.localActiveTransactions
    .filter((transaction) => transaction.approvedPayload.nonce === context.approvedPayload.nonce)
    .filter((transaction) => {
      const replacement = context.replacement;
      return !(
        replacement &&
        replacement.transactionId === transaction.transactionId &&
        transaction.status === "submitted"
      );
    })
    .map((transaction) => transaction.transactionId);
};

const deriveLocalNextNonce = (context: Eip155ApprovalFinalizeContext): `0x${string}` | null => {
  let maxNonce: bigint | null = null;

  for (const transaction of context.localActiveTransactions) {
    const nonce = transaction.approvedPayload.nonce;
    const numericNonce = Hex.toBigInt(nonce);
    maxNonce = maxNonce === null || numericNonce > maxNonce ? numericNonce : maxNonce;
  }

  return maxNonce === null ? null : (Hex.fromNumber(maxNonce + 1n) as `0x${string}`);
};

const finalizeEip155Approval = async (
  context: Eip155ApprovalFinalizeContext,
  deps: Pick<AdapterDeps, "rpcClientFactory">,
): Promise<Eip155ApprovalFinalizeResult> => {
  const rpc = deps.rpcClientFactory(context.chainRef);
  const pendingNonce = await rpc.getTransactionCount(context.from, { blockTag: "pending" });

  if (isWalletManagedNonce(context)) {
    const localNextNonce = deriveLocalNextNonce(context);
    const finalNonce =
      localNextNonce === null || Hex.toBigInt(localNextNonce) <= Hex.toBigInt(pendingNonce)
        ? pendingNonce
        : localNextNonce;
    const approvedPayload: Eip155UnsignedTransaction = {
      ...context.approvedPayload,
      nonce: finalNonce,
    };
    return {
      status: "approved",
      approvedPayload,
      conflictKey: buildEip155TransactionConflictKey({
        chainRef: context.chainRef,
        accountId: context.accountId,
        nonce: approvedPayload.nonce,
      }),
      expiresAt: null,
    };
  }

  const approvedNonce = BigInt(context.approvedPayload.nonce);
  const latestPendingNonce = BigInt(pendingNonce);
  const blockingLocalConflicts = findBlockingLocalNonceConflicts(context);
  if (blockingLocalConflicts.length > 0) {
    return {
      status: "approval_stale",
      stale: {
        reason: "transaction.approval_stale",
        message: "Transaction approval is stale and must be refreshed.",
        data: {
          currentNonce: context.approvedPayload.nonce,
          conflictingTransactionIds: blockingLocalConflicts,
        },
      },
    };
  }

  if (approvedNonce < latestPendingNonce && !hasAllowedReplacementTarget(context)) {
    return {
      status: "approval_stale",
      stale: {
        reason: "transaction.approval_stale",
        message: "Transaction approval is stale and must be refreshed.",
        data: {
          currentNonce: context.approvedPayload.nonce,
          pendingNonce,
        },
      },
    };
  }

  return {
    status: "approved",
    approvedPayload: context.approvedPayload,
    conflictKey: buildEip155TransactionConflictKey({
      chainRef: context.chainRef,
      accountId: context.accountId,
      nonce: context.approvedPayload.nonce,
    }),
    expiresAt: null,
  };
};

export const createEip155Transaction = (deps: AdapterDeps): NamespaceTransaction<"eip155"> => {
  const validateRequest = createEip155RequestValidator({ chains: deps.chains });
  const prepareTransaction = createEip155PrepareTransaction({
    rpcClientFactory: deps.rpcClientFactory,
    chains: deps.chains,
  });
  const receiptService = createEip155ReceiptService({ rpcClientFactory: deps.rpcClientFactory });

  return {
    request: {
      deriveForChain(request, chainRef) {
        return deriveEip155TransactionRequestForChain(requireEip155Request(request), chainRef);
      },
      validateRequest,
    },
    proposal: {
      prepare: (context: Eip155PrepareContext) => prepareTransaction(context),
      buildReview: (context: Eip155ApprovalReviewContext) => buildEip155ApprovalReview(context),
      applyDraftEdit: (context: Eip155DraftEditContext) => applyEip155TransactionDraftEdit(context),
      deriveApprovalResourceKey(context) {
        return {
          kind: "eip155.account_nonce",
          value: `${context.chainRef}:${context.accountId}`,
        };
      },
      finalizeApproval: (context: Eip155ApprovalFinalizeContext) => finalizeEip155Approval(context, deps),
      deriveConflictKey(context) {
        return buildEip155TransactionConflictKey({
          chainRef: context.chainRef,
          accountId: context.accountId,
          nonce: context.approvedPayload.nonce,
        });
      },
    },
    submission: {
      async createBroadcastArtifact(context, options) {
        const signed = await deps.signer.signTransaction(
          {
            namespace: "eip155",
            chainRef: context.chainRef,
            origin: context.origin,
            from: context.from,
            request: context.request,
          },
          context.approvedPayload,
          options,
        );

        return {
          kind: "eip155.raw_transaction",
          payload: toBroadcastArtifactPayload(signed),
        };
      },
      async broadcast(context) {
        const broadcast = await deps.broadcaster.broadcast(
          {
            namespace: "eip155",
            chainRef: context.chainRef,
            origin: context.origin,
            from: context.from,
            request: context.request,
          },
          readSignedTransactionPayload(context.broadcastArtifact),
        );
        const txHash = broadcast.hash as `0x${string}`;
        const submitted = buildEip155SubmittedTransaction({
          hash: txHash,
          transaction: context.approvedPayload,
        });

        return {
          broadcastIdentity: { hash: txHash },
          submitted,
        };
      },
    },
    tracking: {
      inspectSubmittedTransaction: (context) => receiptService.inspectSubmittedTransaction(context),
      getInitialInspectionDelay: () => EIP155_INITIAL_INSPECTION_DELAY_MS,
      getPendingInspectionDelay: () => EIP155_PENDING_INSPECTION_DELAY_MS,
      getRetryInspectionDelay: (context) =>
        Math.min(EIP155_RETRY_MAX_DELAY_MS, EIP155_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, context.attempt - 1)),
    },
  };
};
