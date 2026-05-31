import type { ChainAddressCodecRegistry } from "../../../chains/registry.js";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import { Eip155SubmittedTransactionSchema, Eip155TransactionReceiptSchema } from "../../../storage/schemas.js";
import type { Eip155TransactionRequest } from "../../types.js";
import type { NamespaceTransaction } from "../types.js";
import { applyEip155TransactionDraftEdit } from "./applyDraftEdit.js";
import { buildEip155ApprovalReview } from "./approvalReview.js";
import type { Eip155Broadcaster } from "./broadcaster.js";
import { createEip155PrepareTransaction } from "./prepareTransaction.js";
import { createEip155ReceiptService } from "./receipt.js";
import { deriveEip155TransactionRequestForChain } from "./request.js";
import type { Eip155Signer } from "./signer.js";
import type { Eip155SubmittedTransaction, Eip155TransactionReceipt } from "./transactionTypes.js";
import type {
  Eip155ApprovalReviewContext,
  Eip155DraftEditContext,
  Eip155PrepareContext,
  Eip155SignContext,
  Eip155TrackingContext,
} from "./types.js";
import { buildEip155TransactionConflictKey, type Eip155UnsignedTransaction } from "./unsignedTransaction.js";
import { createEip155RequestValidator } from "./validateRequest.js";

type AdapterDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcClient;
  chains: ChainAddressCodecRegistry;
  signer: Pick<Eip155Signer, "signTransaction">;
  broadcaster: Pick<Eip155Broadcaster, "broadcast">;
};

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

const deriveEip155ReplacementKey = (params: { chainRef: string; submitted: Eip155SubmittedTransaction }) => {
  return {
    scope: "eip155.nonce",
    value: `${params.chainRef}:${params.submitted.from.toLowerCase()}:${params.submitted.nonce.toLowerCase()}`,
  };
};

const toBroadcastInputPayload = (signed: { raw: string }) => ({
  raw: signed.raw,
});

const readSignedTransactionPayload = (broadcastInput: { kind: string; payload: Record<string, unknown> }) => {
  const raw = broadcastInput.payload.raw;
  if (typeof raw !== "string" || !raw.startsWith("0x")) {
    throw new Error(`EIP-155 broadcast input "${broadcastInput.kind}" is missing a raw transaction payload.`);
  }

  return {
    raw,
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
      deriveConflictKey(context) {
        return buildEip155TransactionConflictKey({
          chainRef: context.chainRef,
          accountKey: context.accountKey,
          nonce: context.approvedPayload.nonce,
        });
      },
    },
    execution: {
      sign: (context: Eip155SignContext, prepared, options) => deps.signer.signTransaction(context, prepared, options),
      async broadcast(context: Eip155PrepareContext, signed, prepared: Eip155UnsignedTransaction) {
        const broadcast = await deps.broadcaster.broadcast(context, signed);
        const txHash = broadcast.hash as `0x${string}`;
        const submitted = buildEip155SubmittedTransaction({
          hash: txHash,
          transaction: prepared,
        });
        return {
          submitted,
        };
      },
    },
    submission: {
      async createBroadcastInput(context, options) {
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
          payload: toBroadcastInputPayload(signed),
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
          readSignedTransactionPayload(context.broadcastInput),
        );
        const txHash = broadcast.hash as `0x${string}`;
        const submitted = buildEip155SubmittedTransaction({
          hash: txHash,
          transaction: context.approvedPayload,
        });

        return {
          broadcastIdentity: { hash: txHash },
          submitted,
          conflictKey: buildEip155TransactionConflictKey({
            chainRef: context.chainRef,
            accountKey: context.accountKey,
            nonce: submitted.nonce,
          }),
        };
      },
    },
    tracking: {
      fetchReceipt: (context: Eip155TrackingContext) => receiptService.fetchReceipt(context),
      inspectSubmittedTransaction: (context: Eip155TrackingContext) =>
        receiptService.inspectSubmittedTransaction(context),
      detectReplacement: (context: Eip155TrackingContext) => receiptService.detectReplacement(context),
      deriveReplacementKey(context: Eip155TrackingContext) {
        return deriveEip155ReplacementKey({
          chainRef: context.chainRef,
          submitted: context.submitted,
        });
      },
    },
    record: {
      parseSubmitted(submitted: Eip155SubmittedTransaction) {
        return Eip155SubmittedTransactionSchema.parse(submitted) as Eip155SubmittedTransaction;
      },
      parseReceipt(receipt: Eip155TransactionReceipt) {
        return Eip155TransactionReceiptSchema.parse(receipt) as Eip155TransactionReceipt;
      },
    },
  };
};
