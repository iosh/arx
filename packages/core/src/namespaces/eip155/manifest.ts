import * as Hex from "ox/Hex";
import { accountIdFromChainAddress } from "../../accounts/addressing/accountId.js";
import { eip155AccountAddressing } from "../../accounts/addressing/addressing.js";
import { EIP155_CHAIN_DEFINITION_SEEDS } from "../../chains/chains.seed.js";
import { eip155ChainAddressing } from "../../chains/eip155/chainAddressing.js";
import { EvmHdKeyring, EvmPrivateKeyKeyring } from "../../keyring/index.js";
import { EIP155_NAMESPACE } from "../../rpc/handlers/namespaces/eip155/constants.js";
import {
  createEip155RpcClientFactory,
  type Eip155RpcCapabilities,
  type Eip155RpcClient,
} from "../../rpc/namespaceClients/eip155.js";
import { eip155Module } from "../../rpc/namespaces/eip155/module.js";
import { createEip155Broadcaster } from "../../transactions/namespace/eip155/broadcaster.js";
import { createEip155Signer, type Eip155Signer } from "../../transactions/namespace/eip155/signer.js";
import { createEip155Transaction } from "../../transactions/namespace/eip155/transaction.js";
import { defineNamespaceManifest } from "../types.js";

const DEFAULT_EIP155_CHAIN_SEED = EIP155_CHAIN_DEFINITION_SEEDS[0] as (typeof EIP155_CHAIN_DEFINITION_SEEDS)[number];
const DEFAULT_EIP155_CHAIN_REF = DEFAULT_EIP155_CHAIN_SEED.definition.chainRef;
const EIP155_CLIENT_FACTORY = createEip155RpcClientFactory();
const EIP155_ACCOUNT_ADDRESSING = { [EIP155_NAMESPACE]: eip155AccountAddressing };

const toEip155AccountId = (params: { chainRef: string; address: string }) => {
  return accountIdFromChainAddress({
    chainRef: params.chainRef,
    address: params.address,
    accountAddressing: EIP155_ACCOUNT_ADDRESSING,
  });
};

export const eip155NamespaceManifest = defineNamespaceManifest({
  namespace: EIP155_NAMESPACE,
  core: {
    rpc: eip155Module,
    chainAddressing: eip155ChainAddressing,
    accountAddressing: eip155AccountAddressing,
    keyring: {
      namespace: EIP155_NAMESPACE,
      defaultChainRef: DEFAULT_EIP155_CHAIN_REF,
      accountAddressing: eip155AccountAddressing,
      factories: {
        hd: () => new EvmHdKeyring(),
        "private-key": () => new EvmPrivateKeyKeyring(),
      },
    },
    chainSeeds: EIP155_CHAIN_DEFINITION_SEEDS,
  },
  runtime: {
    clientFactory: EIP155_CLIENT_FACTORY,
    createSigner: ({ accountSigning }) => createEip155Signer({ accountSigning }),
    createApprovalBindings: ({ signer }) => {
      const typedSigner = signer as Pick<Eip155Signer, "signPersonalMessage" | "signTypedData">;
      return {
        signMessage: async ({ chainRef, address, message }) =>
          await typedSigner.signPersonalMessage({
            accountId: toEip155AccountId({ chainRef, address }),
            message,
          }),
        signTypedData: async ({ chainRef, address, typedData }) =>
          await typedSigner.signTypedData({
            accountId: toEip155AccountId({ chainRef, address }),
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
});
