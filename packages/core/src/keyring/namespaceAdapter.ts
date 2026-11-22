import type { AccountId } from "../accounts/accountId.js";
import type { Namespace } from "../namespaces/types.js";

/** Derives namespace-specific account identities and keys without retaining private key material. */
export type KeyringNamespaceAdapter<TNamespace extends Namespace = Namespace> = Readonly<{
  namespace: TNamespace;
  deriveHdAccountId(params: { seed: Uint8Array; derivationIndex: number }): AccountId;
  deriveHdPrivateKey(params: { seed: Uint8Array; derivationIndex: number }): string;
  accountIdFromPrivateKey(privateKey: string): AccountId;
}>;

export type KeyringNamespaceAdapters = Readonly<Record<Namespace, KeyringNamespaceAdapter>>;
