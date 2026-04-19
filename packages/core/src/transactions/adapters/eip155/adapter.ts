import type { ChainAddressCodecRegistry } from "../../../chains/registry.js";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import type { Eip155TransactionRequest } from "../../types.js";
import type { TransactionAdapter } from "../types.js";
import { buildEip155ApprovalReview } from "./approvalReview.js";
import type { Eip155Broadcaster } from "./broadcaster.js";
import { createEip155PrepareTransaction } from "./prepareTransaction.js";
import { createEip155ReceiptService } from "./receipt.js";
import { deriveEip155TransactionRequestForChain } from "./request.js";
import type { Eip155Signer } from "./signer.js";
import { createEip155RequestValidator } from "./validateRequest.js";

type AdapterDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcClient;
  chains: ChainAddressCodecRegistry;
  signer: Pick<Eip155Signer, "signTransaction">;
  broadcaster: Pick<Eip155Broadcaster, "broadcast">;
};

export const createEip155TransactionAdapter = (deps: AdapterDeps): TransactionAdapter => {
  const validateRequest = createEip155RequestValidator({ chains: deps.chains });
  const prepareTransaction = createEip155PrepareTransaction({
    rpcClientFactory: deps.rpcClientFactory,
    chains: deps.chains,
  });
  const receiptService = createEip155ReceiptService({ rpcClientFactory: deps.rpcClientFactory });

  return {
    deriveRequestForChain(request, chainRef) {
      if (request.namespace !== "eip155") {
        throw new Error(`EIP-155 adapter cannot derive request for namespace "${request.namespace}"`);
      }
      return deriveEip155TransactionRequestForChain(request as Eip155TransactionRequest, chainRef);
    },
    validateRequest,
    prepareTransaction,
    signTransaction: (context, prepared) => deps.signer.signTransaction(context, prepared),
    buildApprovalReview: ({ transaction, request }) => buildEip155ApprovalReview({ transaction, request }),
    async broadcastTransaction(context, signed) {
      const broadcast = await deps.broadcaster.broadcast(context, signed);
      return { hash: broadcast.hash };
    },
    receiptTracking: {
      fetchReceipt: (context, hash) => receiptService.fetchReceipt(context, hash),
      detectReplacement: (context) => receiptService.detectReplacement(context),
    },
  };
};
