import { ArxReasons, arxError } from "@arx/errors";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as Hex from "ox/Hex";
import type { ChainNamespace } from "../../../controllers/account/types.js";
import { PermissionCapabilities } from "../../../controllers/permission/types.js";
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

export const resolveChainRefForNamespace = (controllers: UiRuntimeDeps["controllers"], namespace: string): string => {
  const active = controllers.network.getActiveChain();
  if (active.namespace === namespace) return active.chainRef;

  const known = controllers.network.getState().knownChains.find((chain) => chain.namespace === namespace);
  return known?.chainRef ?? active.chainRef;
};

export const extendConnectedOriginsToChain = async (
  controllers: UiRuntimeDeps["controllers"],
  params: { namespace: ChainNamespace; chainRef: string },
): Promise<void> => {
  const { namespace, chainRef } = params;
  const origins = controllers.permissions.listConnectedOrigins({ namespace });

  for (const origin of origins) {
    try {
      await controllers.permissions.grant(origin, PermissionCapabilities.Basic, { namespace, chainRef });
      await controllers.permissions.grant(origin, PermissionCapabilities.Accounts, { namespace, chainRef });
    } catch (error) {
      console.debug("[ui] failed to extend connected origin permissions to chain", {
        origin,
        namespace,
        chainRef,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

export const toUiAccountMeta = (record: AccountRecord) => ({
  accountId: record.accountId,
  address: `0x${record.payloadHex}`,
  keyringId: record.keyringId,
  derivationIndex: record.derivationIndex,
  alias: record.alias,
  createdAt: record.createdAt,
  hidden: record.hidden,
});

export const toUiKeyringMeta = (meta: KeyringMetaRecord) => ({
  id: meta.id,
  type: meta.type,
  createdAt: meta.createdAt,
  alias: meta.name,
  ...(meta.type === "hd" ? { backedUp: meta.needsBackup !== true, derivedCount: meta.nextDerivationIndex ?? 0 } : {}),
});
