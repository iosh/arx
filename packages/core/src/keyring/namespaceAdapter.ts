import type { AccountId } from "../accounts/accountId.js";
import type { Namespace } from "../namespaces/types.js";

/** Derives namespace-specific account identities and keys without retaining private key material. */
export type KeyringNamespaceAdapter<TNamespace extends Namespace = Namespace> = Readonly<{
  namespace: TNamespace;
  parsePrivateKey(input: string): Uint8Array | null;
  formatPrivateKey(privateKey: Uint8Array): string;
  accountIdFromPrivateKey(privateKey: Uint8Array): AccountId;
  derivePrivateKey(params: { seed: Uint8Array; accountIndex: number }): Uint8Array;
}>;

export type KeyringNamespaceAdapters = Readonly<Record<Namespace, KeyringNamespaceAdapter>>;
