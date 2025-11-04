import type { Eip155RpcCapabilities } from "../../../rpc/clients/eip155/eip155.js";
import type { TransactionAdapter } from "../types.js";
import { createEip155DraftBuilder } from "./draftBuilder.js";
import type { Eip155Signer } from "./signer.js";

type AdapterDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcCapabilities;
  signer: Pick<Eip155Signer, "signTransaction">;
};

export const createEip155TransactionAdapter = (deps: AdapterDeps): TransactionAdapter => {
  const buildDraft = createEip155DraftBuilder({ rpcClientFactory: deps.rpcClientFactory });

  return {
    buildDraft,
    signTransaction: (context, draft) => deps.signer.signTransaction(context, draft),
    async broadcastTransaction(context, signed) {
      const client = deps.rpcClientFactory(context.chainRef);
      const hash = await client.sendRawTransaction(signed.raw);
      return { hash };
    },
  };
};
