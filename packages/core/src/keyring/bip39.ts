import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { KeyringInvalidMnemonicError } from "./errors.js";
import type { KeySourceId } from "./persistence.js";
import type { Bip39KeySourceSecret } from "./secrets.js";

const GENERATED_MNEMONIC_STRENGTH = 128;

const canonicalizeBip39Mnemonic = (mnemonic: string): string => {
  // BIP39 uses NFKD text; imported words are stored with one ASCII space separator.
  const nfkd = mnemonic.normalize("NFKD").trim();
  return nfkd.split(/\s+/u).join(" ");
};

export const generateBip39Mnemonic = (): string => generateMnemonic(wordlist, GENERATED_MNEMONIC_STRENGTH);

export const importBip39KeySourceSecret = (params: {
  keySourceId: KeySourceId;
  mnemonic: string;
}): Bip39KeySourceSecret => {
  const mnemonic = canonicalizeBip39Mnemonic(params.mnemonic);
  if (!validateMnemonic(mnemonic, wordlist)) throw new KeyringInvalidMnemonicError();

  return {
    keySourceId: params.keySourceId,
    type: "bip39",
    mnemonic,
  };
};

export const deriveBip39Seed = (source: Bip39KeySourceSecret): Promise<Uint8Array> => mnemonicToSeed(source.mnemonic);
