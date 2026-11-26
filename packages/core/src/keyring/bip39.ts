import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { KeyringInvalidMnemonicError } from "./errors.js";

const GENERATED_MNEMONIC_STRENGTH = 128;

export const generateBip39Mnemonic = (): string => generateMnemonic(wordlist, GENERATED_MNEMONIC_STRENGTH);

/** Decodes imported BIP39 text before trusted core source commands use it. */
export const parseBip39Mnemonic = (input: string): string => {
  const mnemonic = input.normalize("NFKD").trim().split(/\s+/u).join(" ");
  if (!validateMnemonic(mnemonic, wordlist)) throw new KeyringInvalidMnemonicError();
  return mnemonic;
};

export const deriveBip39Seed = (mnemonic: string): Uint8Array => mnemonicToSeedSync(mnemonic);
