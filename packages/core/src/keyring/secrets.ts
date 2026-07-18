export type Bip39KeySourceSecret = Readonly<{
  keySourceId: string;
  type: "bip39";
  mnemonic: string;
  passphrase?: string;
}>;

export type PrivateKeySourceSecret = Readonly<{
  keySourceId: string;
  type: "private-key";
  privateKey: string;
}>;

export type KeySourceSecret = Bip39KeySourceSecret | PrivateKeySourceSecret;

export type KeyringSecrets = Readonly<{
  keySources: readonly KeySourceSecret[];
}>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const canonicalizeMnemonicWords = (mnemonic: string): string => mnemonic.trim().replace(/\s+/g, " ");

export const createKeyringSecrets = (keySources: readonly KeySourceSecret[]): KeyringSecrets => ({
  keySources: [...keySources],
});

export const findKeySourceSecret = (secrets: KeyringSecrets, keySourceId: string): KeySourceSecret | undefined =>
  secrets.keySources.find((source) => source.keySourceId === keySourceId);

export const encodeKeyringSecrets = (secrets: KeyringSecrets): Uint8Array => encoder.encode(JSON.stringify(secrets));

export const decodeKeyringSecrets = (value: Uint8Array): KeyringSecrets =>
  JSON.parse(decoder.decode(value)) as KeyringSecrets;
