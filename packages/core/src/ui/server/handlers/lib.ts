import { ArxReasons, arxError } from "@arx/errors";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as Hex from "ox/Hex";
import { keyringErrors } from "../../../keyring/errors.js";
import type { AccountRecord, KeyringMetaRecord } from "../../../storage/records.js";
import { zeroize } from "../../../utils/bytes.js";
import type { UiAccountCodecsAccess, UiChainsAccess, UiSessionAccess } from "../types.js";

export const assertUnlocked = (session: Pick<UiSessionAccess, "isUnlocked">) => {
  if (!session.isUnlocked()) {
    throw arxError({ reason: ArxReasons.SessionLocked, message: "Wallet is locked" });
  }
};

export const withSensitiveBytes = <T>(secret: Uint8Array, transform: (bytes: Uint8Array) => T): T => {
  try {
    return transform(secret);
  } finally {
    zeroize(secret);
  }
};

export const toPlainHex = (bytes: Uint8Array): string => {
  const out = Hex.from(bytes);
  return out.startsWith("0x") ? out.slice(2) : out;
};

export const sanitizeMnemonicPhraseFromWords = (words: string[]): string =>
  words
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");

export const validateBip39Mnemonic = (mnemonic: string): void => {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw keyringErrors.invalidMnemonic();
  }
};

export const parsePrivateKeyHex = (value: string): string => {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw keyringErrors.invalidPrivateKey();
  }
  return normalized;
};

export const resolveUiChainRefForNamespace = (
  chains: Pick<UiChainsAccess, "getActiveChainViewForNamespace" | "getSelectedChainView">,
  namespace: string,
): string => {
  try {
    const selectedChain = chains.getSelectedChainView();
    if (selectedChain.namespace === namespace) {
      return selectedChain.chainRef;
    }
  } catch {
    // The UI edge still needs a namespace-specific active fallback even when the selected UI chain is unavailable.
  }

  return chains.getActiveChainViewForNamespace(namespace).chainRef;
};

export const toUiAccountMeta = (accountCodecs: UiAccountCodecsAccess, record: AccountRecord) => {
  const codec = accountCodecs.get(record.namespace);
  if (!codec) {
    throw new Error(`No account codec registered for namespace "${record.namespace}"`);
  }
  const canonical = codec.fromAccountKey(record.accountKey);
  const canonicalAddress = codec.toCanonicalString({ canonical });

  return {
    accountKey: record.accountKey,
    canonicalAddress,
    keyringId: record.keyringId,
    derivationIndex: record.derivationIndex,
    alias: record.alias,
    createdAt: record.createdAt,
    hidden: record.hidden,
  };
};

export const toUiKeyringMeta = (meta: KeyringMetaRecord) => ({
  id: meta.id,
  type: meta.type,
  createdAt: meta.createdAt,
  alias: meta.alias,
  ...(meta.type === "hd" ? { backedUp: meta.needsBackup !== true, derivedCount: meta.nextDerivationIndex ?? 0 } : {}),
});
