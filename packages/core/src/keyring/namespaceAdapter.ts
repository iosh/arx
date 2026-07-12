import type { Bip39KeySource, PrivateKeySource } from "../vault/secrets.js";
import { KeyringUnsupportedNamespaceError } from "./errors.js";
import type { UnlockedSigner } from "./UnlockedSigners.js";

/** Derives namespace-specific signers without exposing keyring implementations to the wallet. */
export interface KeyringNamespaceAdapter {
  namespace: string;
  defaultDerivationProfileId: string;
  deriveAccount(params: {
    source: Bip39KeySource;
    derivationProfileId: string;
    derivationIndex: number;
  }): UnlockedSigner;
  importPrivateKey(source: PrivateKeySource): UnlockedSigner;
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
