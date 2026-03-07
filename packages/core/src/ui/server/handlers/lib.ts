import { ArxReasons, arxError } from "@arx/errors";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as Hex from "ox/Hex";
import { parseAccountId } from "../../../accounts/addressing/accountId.js";
import { keyringErrors } from "../../../keyring/errors.js";
import type { BackgroundSessionServices } from "../../../runtime/background/session.js";
import type { AccountRecord, KeyringMetaRecord } from "../../../storage/records.js";
import { zeroize } from "../../../utils/bytes.js";
import type { UiRuntimeDeps } from "../types.js";

export const assertUnlocked = (session: BackgroundSessionServices) => {
  if (!session.unlock.isUnlocked()) {
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

export const requireOnboardingPassword = (password: string | undefined): string => {
  if (!password || password.trim().length === 0) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Password cannot be empty",
    });
  }
  return password;
};

export const parsePrivateKeyHex = (value: string): string => {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw keyringErrors.invalidPrivateKey();
  }
  return normalized;
};

export const hasAnyAccounts = (controllers: UiRuntimeDeps["controllers"]): boolean => {
  const accountsState = controllers.accounts.getState();
  return Object.values(accountsState.namespaces).some((ns) => ns.accountIds.length > 0);
};

export const resolveChainRefForNamespace = (deps: Pick<UiRuntimeDeps, "chainViews">, namespace: string): string => {
  const active = deps.chainViews.getActiveChainView();
  if (active.namespace === namespace) return active.chainRef;

  const available = deps.chainViews.findAvailableChainView({ namespace });
  if (available) {
    return available.chainRef;
  }

  throw arxError({
    reason: ArxReasons.RpcInvalidParams,
    message: `No available chain for namespace "${namespace}"`,
    data: { namespace },
  });
};

export const toUiAccountMeta = (record: AccountRecord) => {
  const parsed = parseAccountId(record.accountId);
  const canonicalAddress = record.namespace === "eip155" ? `0x${parsed.payloadHex}` : record.accountId;

  return {
    accountId: record.accountId,
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
  alias: meta.name,
  ...(meta.type === "hd" ? { backedUp: meta.needsBackup !== true, derivedCount: meta.nextDerivationIndex ?? 0 } : {}),
});
