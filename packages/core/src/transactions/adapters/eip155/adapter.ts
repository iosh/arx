import type { Eip155RpcCapabilities } from "../../../rpc/clients/eip155/eip155.js";
import type { TransactionAdapter } from "../types.js";
import type { Eip155Broadcaster } from "./broadcaster.js";
import { createEip155DraftBuilder } from "./draftBuilder.js";
import type { Eip155Signer } from "./signer.js";

type AdapterDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcCapabilities;
  signer: Pick<Eip155Signer, "signTransaction">;
  broadcaster: Pick<Eip155Broadcaster, "broadcast">;
};

export const createEip155TransactionAdapter = (deps: AdapterDeps): TransactionAdapter => {
  const buildDraft = createEip155DraftBuilder({ rpcClientFactory: deps.rpcClientFactory });

  return {
    buildDraft,
    signTransaction: (context, draft) => deps.signer.signTransaction(context, draft),
    async broadcastTransaction(context, signed) {
      const broadcast = await deps.broadcaster.broadcast(context, signed);
      return { hash: broadcast.hash };
    },
  };
};
