import type { AccountId } from "../accounts/accountId.js";
import type { Namespace } from "../namespaces/types.js";
import { KeyringUnsupportedNamespaceError } from "./errors.js";

/** Derives namespace-specific account identities without retaining private key material. */
export type KeyringNamespaceAdapter<TNamespace extends Namespace = Namespace> = Readonly<{
  namespace: TNamespace;
  deriveHdAccountId(params: { seed: Uint8Array; derivationIndex: number }): AccountId;
  accountIdFromPrivateKey(privateKey: string): AccountId;
}>;

export type KeyringNamespaceAdapters = Readonly<Record<Namespace, KeyringNamespaceAdapter | undefined>>;

export const getKeyringNamespaceAdapter = (
  adapters: KeyringNamespaceAdapters,
  namespace: Namespace,
): KeyringNamespaceAdapter => {
  const adapter = adapters[namespace];
  if (!adapter) throw new KeyringUnsupportedNamespaceError(namespace);
  return adapter;
};
