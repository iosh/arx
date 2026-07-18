import type { AccountId } from "../accounts/accountId.js";
import { KeyringUnsupportedNamespaceError } from "./errors.js";
import type { Bip39KeySourceSecret, PrivateKeySourceSecret } from "./secrets.js";

export type KeyringAccountIdentity = Readonly<{ accountId: AccountId }>;

/** Derives namespace-specific account identities without retaining private key material. */
export interface KeyringNamespaceAdapter {
  namespace: string;
  defaultDerivationProfileId: string;
  deriveAccount(params: {
    source: Bip39KeySourceSecret;
    derivationProfileId: string;
    derivationIndex: number;
  }): KeyringAccountIdentity;
  importPrivateKey(source: PrivateKeySourceSecret): KeyringAccountIdentity;
}

export type KeyringNamespaceAdapters = ReadonlyMap<string, KeyringNamespaceAdapter>;

export const getKeyringNamespaceAdapter = (
  adapters: KeyringNamespaceAdapters,
  namespace: string,
): KeyringNamespaceAdapter => {
  const adapter = adapters.get(namespace);
  if (!adapter) throw new KeyringUnsupportedNamespaceError(namespace);
  return adapter;
};
