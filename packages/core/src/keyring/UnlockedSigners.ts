import type { AccountId } from "../accounts/addressing/accountId.js";
import type { AccountRecord } from "../accounts/persistence.js";
import type { LocalKeySource } from "../vault/secrets.js";
import { KeyringNotFoundError, KeyringSourceNotFoundError } from "./errors.js";
import { getKeyringNamespaceAdapter, type KeyringNamespaceAdapters } from "./namespaceAdapter.js";
import type { HdKeyringRecord } from "./persistence.js";

export type UnlockedSigner = Readonly<{
  accountId: AccountId;
  sign(payload: Uint8Array): Promise<Uint8Array>;
  clear(): void;
}>;

export type UnlockedSignersDraft = Readonly<{
  signers: readonly UnlockedSigner[];
}>;

/** Owns the signing capabilities available during the current unlocked period. */
export class UnlockedSigners {
  #signers = new Map<AccountId, UnlockedSigner>();

  replace(draft: UnlockedSignersDraft): void {
    this.clear();
    this.#signers = new Map(draft.signers.map((signer) => [signer.accountId, signer]));
  }

  get(accountId: AccountId): UnlockedSigner | null {
    return this.#signers.get(accountId) ?? null;
  }

  add(signer: UnlockedSigner): void {
    this.#signers.set(signer.accountId, signer);
  }

  remove(accountIds: readonly AccountId[]): void {
    for (const accountId of accountIds) {
      this.#signers.get(accountId)?.clear();
      this.#signers.delete(accountId);
    }
  }

  clear(): void {
    for (const signer of this.#signers.values()) signer.clear();
    this.#signers.clear();
  }
}

const sourceById = (sources: readonly LocalKeySource[]): Map<string, LocalKeySource> =>
  new Map(sources.map((source) => [source.keySourceId, source]));

export const createUnlockedSignersDraft = (params: {
  sources: readonly LocalKeySource[];
  keyrings: readonly HdKeyringRecord[];
  accounts: readonly AccountRecord[];
  adapters: KeyringNamespaceAdapters;
}): UnlockedSignersDraft => {
  const sources = sourceById(params.sources);
  const keyrings = new Map(params.keyrings.map((keyring) => [keyring.keyringId, keyring]));
  const signers: UnlockedSigner[] = [];

  try {
    for (const record of params.accounts) {
      if (record.origin.type === "hd") {
        const keyring = keyrings.get(record.origin.keyringId);
        if (!keyring) throw new KeyringNotFoundError(record.origin.keyringId);
        const source = sources.get(keyring.keySourceId);
        if (!source || source.type !== "bip39") throw new KeyringSourceNotFoundError(keyring.keySourceId);
        signers.push(
          getKeyringNamespaceAdapter(params.adapters, keyring.namespace).deriveAccount({
            source,
            derivationProfileId: keyring.derivationProfileId,
            derivationIndex: record.origin.derivationIndex,
          }),
        );
        continue;
      }

      const source = sources.get(record.origin.keySourceId);
      if (!source || source.type !== "private-key") {
        throw new KeyringSourceNotFoundError(record.origin.keySourceId);
      }
      const namespace = record.accountId.slice(0, record.accountId.indexOf(":"));
      signers.push(getKeyringNamespaceAdapter(params.adapters, namespace).importPrivateKey(source));
    }
  } catch (error) {
    for (const signer of signers) signer.clear();
    throw error;
  }

  return { signers };
};
