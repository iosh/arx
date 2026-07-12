export type Bip39KeySource = Readonly<{
  keySourceId: string;
  type: "bip39";
  mnemonic: string;
  passphrase?: string;
}>;

export type PrivateKeySource = Readonly<{
  keySourceId: string;
  type: "private-key";
  namespace: string;
  privateKey: string;
}>;

export type LocalKeySource = Bip39KeySource | PrivateKeySource;

/** Sensitive wallet material that must only be persisted through an encrypted vault record. */
export type VaultSecrets = Readonly<{
  keySources: readonly LocalKeySource[];
}>;

export const joinMnemonicWords = (mnemonic: string): string => mnemonic.trim().replace(/\s+/g, " ");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const encodeVaultSecrets = (secrets: VaultSecrets): Uint8Array => encoder.encode(JSON.stringify(secrets));

export const decodeVaultSecrets = (value: Uint8Array): VaultSecrets =>
  JSON.parse(decoder.decode(value)) as VaultSecrets;
