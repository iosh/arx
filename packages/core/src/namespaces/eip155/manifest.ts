import * as Hex from "ox/Hex";
import { eip155Codec } from "../../accounts/addressing/codec.js";
import { EIP155_CHAIN_METADATA } from "../../chains/chains.seed.js";
import { eip155AddressCodec } from "../../chains/eip155/addressCodec.js";
import { EvmHdKeyring, EvmPrivateKeyKeyring } from "../../keyring/index.js";
import { EIP155_NAMESPACE } from "../../rpc/handlers/namespaces/eip155/constants.js";
import type { Eip155RpcCapabilities, Eip155RpcClient } from "../../rpc/namespaceClients/eip155.js";
import { eip155Module } from "../../rpc/namespaces/eip155/module.js";
import { createEip155Broadcaster } from "../../transactions/namespace/eip155/broadcaster.js";
import { createEip155Signer, type Eip155Signer } from "../../transactions/namespace/eip155/signer.js";
import { createEip155Transaction } from "../../transactions/namespace/eip155/transaction.js";
import type { NamespaceManifest } from "../types.js";
import { defineNamespaceManifest } from "../validation.js";

const DEFAULT_EIP155_CHAIN_REF = EIP155_CHAIN_METADATA[0]?.chainRef;
const EIP155_CLIENT_FACTORY = eip155Module.clientFactory;

if (!DEFAULT_EIP155_CHAIN_REF) {
  throw new Error("EIP155_CHAIN_METADATA must include at least one chain");
}

if (!EIP155_CLIENT_FACTORY) {
  throw new Error("eip155Module must provide a clientFactory");
}

const toEip155AccountKey = (params: { chainRef: string; address: string }) => {
  const canonical = eip155Codec.toCanonicalAddress({ chainRef: params.chainRef, value: params.address });
  return eip155Codec.toAccountKey(canonical);
};

export const eip155NamespaceManifest = defineNamespaceManifest({
  namespace: EIP155_NAMESPACE,
  core: {
    namespace: EIP155_NAMESPACE,
    rpc: eip155Module,
    chainAddressCodec: eip155AddressCodec,
    accountCodec: eip155Codec,
    keyring: {
      namespace: EIP155_NAMESPACE,
      defaultChainRef: DEFAULT_EIP155_CHAIN_REF,
      codec: eip155Codec,
      factories: {
        hd: () => new EvmHdKeyring(),
        "private-key": () => new EvmPrivateKeyKeyring(),
      },
    },
    chainSeeds: EIP155_CHAIN_METADATA,
  },
  runtime: {
    clientFactory: EIP155_CLIENT_FACTORY,
    createSigner: ({ accountSigning }) => createEip155Signer({ accountSigning }),
    createApprovalBindings: ({ signer }) => {
      const typedSigner = signer as Pick<Eip155Signer, "signPersonalMessage" | "signTypedData">;
      return {
        signMessage: async ({ chainRef, address, message }) =>
          await typedSigner.signPersonalMessage({
            accountKey: toEip155AccountKey({ chainRef, address }),
            message,
          }),
        signTypedData: async ({ chainRef, address, typedData }) =>
          await typedSigner.signTypedData({
            accountKey: toEip155AccountKey({ chainRef, address }),
            typedData,
          }),
      };
    },
    createUiBindings: ({ rpcClients }) => ({
      getNativeBalance: async ({ chainRef, address }) => {
        const rpc = rpcClients.getClient<Eip155RpcCapabilities>(EIP155_NAMESPACE, chainRef) as Eip155RpcClient;
        const balanceHex = await rpc.getBalance(address, { blockTag: "latest", timeoutMs: 15_000 });
        Hex.assert(balanceHex as Hex.Hex, { strict: false });
        return Hex.toBigInt(balanceHex as Hex.Hex);
      },
      createSendTransactionRequest: ({ chainRef, to, valueWei }) => ({
        namespace: EIP155_NAMESPACE,
        chainRef,
        payload: {
          to,
          value: Hex.fromNumber(valueWei),
        },
      }),
    }),
    createTransaction: ({ rpcClients, chains, signer }) => {
      const typedSigner = signer as Pick<Eip155Signer, "signTransaction">;
      const rpcClientFactory = (chainRef: string) =>
        rpcClients.getClient<Eip155RpcCapabilities>(EIP155_NAMESPACE, chainRef) as Eip155RpcClient;
      const broadcaster = createEip155Broadcaster({ rpcClientFactory });

      return createEip155Transaction({
        rpcClientFactory,
        signer: typedSigner,
        broadcaster,
        chains,
      });
    },
  },
} satisfies NamespaceManifest);
