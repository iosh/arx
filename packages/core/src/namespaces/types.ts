import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainAddressCodecRegistry } from "../chains/registry.js";
import type { ChainAddressCodec } from "../chains/types.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type { RpcClientFactory, RpcClientRegistry } from "../rpc/RpcClientRegistry.js";
import type { KeyringService } from "../runtime/keyring/KeyringService.js";
import type { NamespaceConfig } from "../runtime/keyring/namespaces.js";
import type { TransactionAdapter } from "../transactions/adapters/types.js";

export type NamespaceCoreManifest = {
  namespace: string;
  rpc: RpcNamespaceModule;
  chainAddressCodec: ChainAddressCodec;
  accountCodec: AccountCodec;
  keyring: NamespaceConfig;
  chainSeeds?: readonly ChainMetadata[];
};

export type NamespaceRuntimeManifest = {
  clientFactory?: RpcClientFactory;
  createSigner?: (params: {
    keyring: Pick<KeyringService, "waitForReady" | "hasAccountId" | "signDigestByAccountId">;
  }) => unknown;
  createTransactionAdapter?: (params: {
    rpcClients: Pick<RpcClientRegistry, "getClient">;
    chains: ChainAddressCodecRegistry;
    signer: unknown;
  }) => TransactionAdapter;
};

export type NamespaceManifest = {
  namespace: string;
  core: NamespaceCoreManifest;
  runtime?: NamespaceRuntimeManifest;
};
