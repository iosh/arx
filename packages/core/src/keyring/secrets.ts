import type { KeySourceId } from "./persistence.js";

export type Bip39KeySourceSecret = Readonly<{
  keySourceId: KeySourceId;
  type: "bip39";
  mnemonic: string;
}>;

export type PrivateKeySourceSecret = Readonly<{
  keySourceId: KeySourceId;
  type: "private-key";
  privateKey: string;
}>;

export type KeySourceSecret = Bip39KeySourceSecret | PrivateKeySourceSecret;

export type KeyringSecrets = Readonly<{
  keySources: readonly KeySourceSecret[];
}>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const createKeyringSecrets = (keySources: readonly KeySourceSecret[]): KeyringSecrets => ({
  keySources: [...keySources],
});

export const findKeySourceSecret = (secrets: KeyringSecrets, keySourceId: KeySourceId): KeySourceSecret | undefined =>
  secrets.keySources.find((source) => source.keySourceId === keySourceId);

export const encodeKeyringSecrets = (secrets: KeyringSecrets): Uint8Array => encoder.encode(JSON.stringify(secrets));

export const decodeKeyringSecrets = (value: Uint8Array): KeyringSecrets =>
  JSON.parse(decoder.decode(value)) as KeyringSecrets;
