import type {
  UiAccountCodecsAccess,
  UiAccountsAccess,
  UiChainsAccess,
  UiHandlers,
  UiPlatformAdapter,
  UiWalletSetupAccess,
} from "../types.js";
import {
  parsePrivateKeyHex,
  resolveUiChainRefForNamespace,
  sanitizeMnemonicPhraseFromWords,
  validateBip39Mnemonic,
} from "./lib.js";

const buildCreateWalletRequest = (params: {
  password: string;
  mnemonic: string;
  alias: string | undefined;
  skipBackup: boolean | undefined;
  namespace: string | undefined;
}) => ({
  password: params.password,
  mnemonic: params.mnemonic,
  ...(params.alias !== undefined ? { alias: params.alias } : {}),
  ...(params.skipBackup !== undefined ? { skipBackup: params.skipBackup } : {}),
  ...(params.namespace !== undefined ? { namespace: params.namespace } : {}),
});

const buildImportWalletFromMnemonicRequest = (params: {
  password: string;
  mnemonic: string;
  alias: string | undefined;
  namespace: string | undefined;
}) => ({
  password: params.password,
  mnemonic: params.mnemonic,
  ...(params.alias !== undefined ? { alias: params.alias } : {}),
  ...(params.namespace !== undefined ? { namespace: params.namespace } : {}),
});

const buildImportWalletFromPrivateKeyRequest = (params: {
  password: string;
  privateKey: string;
  alias: string | undefined;
  namespace: string | undefined;
}) => ({
  password: params.password,
  privateKey: params.privateKey,
  ...(params.alias !== undefined ? { alias: params.alias } : {}),
  ...(params.namespace !== undefined ? { namespace: params.namespace } : {}),
});

export const createOnboardingHandlers = (deps: {
  accounts: Pick<UiAccountsAccess, "setActiveAccount">;
  chains: UiChainsAccess;
  accountCodecs: UiAccountCodecsAccess;
  walletSetup: UiWalletSetupAccess;
  platform: Pick<UiPlatformAdapter, "openOnboardingTab">;
}): Pick<
  UiHandlers,
  | "ui.onboarding.openTab"
  | "ui.onboarding.generateMnemonic"
  | "ui.onboarding.createWalletFromMnemonic"
  | "ui.onboarding.importWalletFromMnemonic"
  | "ui.onboarding.importWalletFromPrivateKey"
> => {
  return {
    "ui.onboarding.openTab": async ({ reason }) => {
      return await deps.platform.openOnboardingTab(reason);
    },

    "ui.onboarding.generateMnemonic": async (payload) => {
      const mnemonic = deps.walletSetup.generateMnemonic(payload?.wordCount ?? 12);
      return { words: mnemonic.split(" ") };
    },

    "ui.onboarding.createWalletFromMnemonic": async (params) => {
      const { password, words, ...keyringParams } = params;
      const mnemonic = sanitizeMnemonicPhraseFromWords(words);
      validateBip39Mnemonic(mnemonic);

      const request = buildCreateWalletRequest({
        password,
        mnemonic,
        alias: keyringParams.alias,
        skipBackup: keyringParams.skipBackup,
        namespace: keyringParams.namespace,
      });

      const { keyringId, address } = await deps.walletSetup.createWalletFromMnemonic(request);
      const namespace = params.namespace ?? deps.chains.getSelectedChainView().namespace;
      const chainRef = resolveUiChainRefForNamespace(deps.chains, namespace);
      await deps.accounts.setActiveAccount({
        namespace,
        chainRef,
        accountKey: deps.accountCodecs.toAccountKeyFromAddress({ chainRef, address }),
      });
      return { keyringId, address };
    },

    "ui.onboarding.importWalletFromMnemonic": async (params) => {
      const { password, words, ...keyringParams } = params;
      const mnemonic = sanitizeMnemonicPhraseFromWords(words);
      validateBip39Mnemonic(mnemonic);

      const request = buildImportWalletFromMnemonicRequest({
        password,
        mnemonic,
        alias: keyringParams.alias,
        namespace: keyringParams.namespace,
      });

      const { keyringId, address } = await deps.walletSetup.importWalletFromMnemonic(request);
      const namespace = params.namespace ?? deps.chains.getSelectedChainView().namespace;
      const chainRef = resolveUiChainRefForNamespace(deps.chains, namespace);
      await deps.accounts.setActiveAccount({
        namespace,
        chainRef,
        accountKey: deps.accountCodecs.toAccountKeyFromAddress({ chainRef, address }),
      });
      return { keyringId, address };
    },

    "ui.onboarding.importWalletFromPrivateKey": async (params) => {
      const { password, privateKey: privateKeyHex, ...keyringParams } = params;
      const privateKey = parsePrivateKeyHex(privateKeyHex);

      const request = buildImportWalletFromPrivateKeyRequest({
        password,
        privateKey,
        alias: keyringParams.alias,
        namespace: keyringParams.namespace,
      });

      const { keyringId, account } = await deps.walletSetup.importWalletFromPrivateKey(request);
      const namespace = params.namespace ?? deps.chains.getSelectedChainView().namespace;
      const chainRef = resolveUiChainRefForNamespace(deps.chains, namespace);
      await deps.accounts.setActiveAccount({
        namespace,
        chainRef,
        accountKey: deps.accountCodecs.toAccountKeyFromAddress({ chainRef, address: account.address }),
      });
      return { keyringId, account };
    },
  };
};
