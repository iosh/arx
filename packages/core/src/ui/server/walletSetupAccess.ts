import { ArxReasons, arxError } from "@arx/errors";
import type { AccountController } from "../../controllers/account/types.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type {
  ConfirmNewMnemonicParams,
  ImportMnemonicParams,
  ImportPrivateKeyParams,
  KeyringService,
} from "../../runtime/keyring/KeyringService.js";

export type UiCreateWalletFromMnemonicParams = ConfirmNewMnemonicParams & {
  password: string;
};

export type UiImportWalletFromMnemonicParams = ImportMnemonicParams & {
  password: string;
};

export type UiImportWalletFromPrivateKeyParams = ImportPrivateKeyParams & {
  password: string;
};

export type UiWalletSetupAccess = {
  generateMnemonic: (wordCount?: 12 | 24) => string;
  createWalletFromMnemonic: (
    params: UiCreateWalletFromMnemonicParams,
  ) => ReturnType<KeyringService["confirmNewMnemonic"]>;
  importWalletFromMnemonic: (params: UiImportWalletFromMnemonicParams) => ReturnType<KeyringService["importMnemonic"]>;
  importWalletFromPrivateKey: (
    params: UiImportWalletFromPrivateKeyParams,
  ) => ReturnType<KeyringService["importPrivateKey"]>;
};

export type CreateUiWalletSetupAccessDeps = {
  accounts: Pick<AccountController, "getState">;
  session: BackgroundSessionServices;
  keyring: KeyringService;
};

const hasAnyOwnedAccounts = (accounts: CreateUiWalletSetupAccessDeps["accounts"]): boolean => {
  const state = accounts.getState();
  return Object.values(state.namespaces).some((namespace) => namespace.accountKeys.length > 0);
};

export const createUiWalletSetupAccess = ({
  accounts,
  session,
  keyring,
}: CreateUiWalletSetupAccessDeps): UiWalletSetupAccess => {
  const waitForReady = async () => {
    await keyring.waitForReady();
  };

  const unlockForSetup = async (password: string) => {
    await session.unlock.unlock({ password });
    await waitForReady();
  };

  const runWalletSetupFlow = async <T>(password: string, run: () => Promise<T>): Promise<T> => {
    return await session.withVaultMetaPersistHold(async () => {
      const status = session.vault.getStatus();
      if (status.hasEnvelope && hasAnyOwnedAccounts(accounts)) {
        throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Vault already initialized" });
      }

      if (!status.hasEnvelope) {
        await session.createVault({ password });
        await unlockForSetup(password);
      } else if (!session.unlock.isUnlocked()) {
        await unlockForSetup(password);
      } else {
        await waitForReady();
      }

      return await run();
    });
  };

  return {
    generateMnemonic: (wordCount) => keyring.generateMnemonic(wordCount),
    createWalletFromMnemonic: async ({ password, ...keyringParams }) =>
      await runWalletSetupFlow(password, async () => await keyring.confirmNewMnemonic(keyringParams)),
    importWalletFromMnemonic: async ({ password, ...keyringParams }) =>
      await runWalletSetupFlow(password, async () => await keyring.importMnemonic(keyringParams)),
    importWalletFromPrivateKey: async ({ password, ...keyringParams }) =>
      await runWalletSetupFlow(password, async () => await keyring.importPrivateKey(keyringParams)),
  };
};
