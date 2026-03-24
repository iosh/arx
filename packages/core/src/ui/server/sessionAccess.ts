import { ArxReasons, arxError } from "@arx/errors";
import type { AccountController } from "../../controllers/account/types.js";
import type { UnlockReason, UnlockState } from "../../controllers/unlock/types.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { SessionStatus, SessionStatusService } from "../../services/runtime/sessionStatus.js";
import type { UiConfirmNewMnemonicParams, UiImportMnemonicParams, UiImportPrivateKeyParams } from "./keyringsAccess.js";

export type UiCreateWalletFromMnemonicParams = UiConfirmNewMnemonicParams & {
  password: string;
};

export type UiImportWalletFromMnemonicParams = UiImportMnemonicParams & {
  password: string;
};

export type UiImportWalletFromPrivateKeyParams = UiImportPrivateKeyParams & {
  password: string;
};

export type UiSessionAccess = {
  getStatus: () => SessionStatus;
  getUnlockState: () => UnlockState;
  isUnlocked: () => boolean;
  hasInitializedVault: () => boolean;
  unlock: (params: { password: string }) => Promise<UnlockState>;
  lock: (reason: UnlockReason) => UnlockState;
  resetAutoLockTimer: () => UnlockState;
  setAutoLockDuration: (durationMs: number) => { autoLockDurationMs: number; nextAutoLockAt: number | null };
  onStateChanged: (listener: () => void) => () => void;
  createWalletFromMnemonic: (
    params: UiCreateWalletFromMnemonicParams,
  ) => ReturnType<KeyringService["confirmNewMnemonic"]>;
  importWalletFromMnemonic: (params: UiImportWalletFromMnemonicParams) => ReturnType<KeyringService["importMnemonic"]>;
  importWalletFromPrivateKey: (
    params: UiImportWalletFromPrivateKeyParams,
  ) => ReturnType<KeyringService["importPrivateKey"]>;
  persistVaultMeta: BackgroundSessionServices["persistVaultMeta"];
};

export type CreateUiSessionAccessDeps = {
  accounts: Pick<AccountController, "getState">;
  session: BackgroundSessionServices;
  sessionStatus: SessionStatusService;
  keyring: KeyringService;
};

const hasAnyOwnedAccounts = (accounts: CreateUiSessionAccessDeps["accounts"]): boolean => {
  const state = accounts.getState();
  return Object.values(state.namespaces).some((namespace) => namespace.accountKeys.length > 0);
};

export const createUiSessionAccess = ({
  accounts,
  session,
  sessionStatus,
  keyring,
}: CreateUiSessionAccessDeps): UiSessionAccess => {
  const getStatus: UiSessionAccess["getStatus"] = () => sessionStatus.getStatus();
  const getUnlockState: UiSessionAccess["getUnlockState"] = () => session.unlock.getState();

  const waitForReady = async () => {
    await keyring.waitForReady();
  };

  const unlock: UiSessionAccess["unlock"] = async ({ password }) => {
    await session.unlock.unlock({ password });
    await waitForReady();
    return getUnlockState();
  };

  const runOnboardingWalletFlow = async <T>(password: string, run: () => Promise<T>): Promise<T> => {
    return await session.withVaultMetaPersistHold(async () => {
      const status = session.vault.getStatus();
      if (status.hasEnvelope && hasAnyOwnedAccounts(accounts)) {
        throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Vault already initialized" });
      }

      if (!status.hasEnvelope) {
        await session.vault.initialize({ password });
        await unlock({ password });
      } else if (!session.unlock.isUnlocked()) {
        await unlock({ password });
      } else {
        await waitForReady();
      }

      return await run();
    });
  };

  return {
    getStatus,
    getUnlockState,
    isUnlocked: () => sessionStatus.isUnlocked(),
    hasInitializedVault: () => sessionStatus.hasInitializedVault(),
    unlock,
    lock: (reason) => {
      session.unlock.lock(reason);
      return getUnlockState();
    },
    resetAutoLockTimer: () => {
      session.unlock.scheduleAutoLock();
      return getUnlockState();
    },
    setAutoLockDuration: (durationMs) => {
      session.unlock.setAutoLockDuration(durationMs);
      const state = getUnlockState();
      return { autoLockDurationMs: state.timeoutMs, nextAutoLockAt: state.nextAutoLockAt };
    },
    onStateChanged: (listener) => session.onStateChanged(listener),
    createWalletFromMnemonic: async ({ password, ...keyringParams }) =>
      await runOnboardingWalletFlow(password, async () => await keyring.confirmNewMnemonic(keyringParams)),
    importWalletFromMnemonic: async ({ password, ...keyringParams }) =>
      await runOnboardingWalletFlow(password, async () => await keyring.importMnemonic(keyringParams)),
    importWalletFromPrivateKey: async ({ password, ...keyringParams }) =>
      await runOnboardingWalletFlow(password, async () => await keyring.importPrivateKey(keyringParams)),
    persistVaultMeta: session.persistVaultMeta,
  };
};
