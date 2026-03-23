import { ArxReasons, arxError } from "@arx/errors";
import type {
  UiCreateWalletFromMnemonicParams,
  UiImportWalletFromMnemonicParams,
  UiImportWalletFromPrivateKeyParams,
} from "../sessionAccess.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";
import {
  hasAnyAccounts,
  parsePrivateKeyHex,
  resolveChainRefForNamespace,
  sanitizeMnemonicPhraseFromWords,
  validateBip39Mnemonic,
} from "./lib.js";

export const createOnboardingHandlers = (
  deps: Pick<UiRuntimeDeps, "accounts" | "chains" | "accountCodecs" | "session" | "keyrings" | "platform">,
): Pick<
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
      const mnemonic = deps.keyrings.generateMnemonic(payload?.wordCount ?? 12);
      return { words: mnemonic.split(" ") };
    },

    "ui.onboarding.createWalletFromMnemonic": async (params) => {
      const { password, words, ...keyringParams } = params;
      const mnemonic = sanitizeMnemonicPhraseFromWords(words);
      validateBip39Mnemonic(mnemonic);

      if (deps.session.hasInitializedVault() && hasAnyAccounts(deps.accounts)) {
        throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Vault already initialized" });
      }

      const { keyringId, address } = await deps.session.createWalletFromMnemonic({
        password,
        mnemonic,
        ...keyringParams,
      } as UiCreateWalletFromMnemonicParams);
      const namespace = params.namespace ?? deps.chains.getSelectedChainView().namespace;
      const chainRef = resolveChainRefForNamespace(deps, namespace);
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

      if (deps.session.hasInitializedVault() && hasAnyAccounts(deps.accounts)) {
        throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Vault already initialized" });
      }

      const { keyringId, address } = await deps.session.importWalletFromMnemonic({
        password,
        mnemonic,
        ...keyringParams,
      } as UiImportWalletFromMnemonicParams);
      const namespace = params.namespace ?? deps.chains.getSelectedChainView().namespace;
      const chainRef = resolveChainRefForNamespace(deps, namespace);
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

      if (deps.session.hasInitializedVault() && hasAnyAccounts(deps.accounts)) {
        throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Vault already initialized" });
      }

      const { keyringId, account } = await deps.session.importWalletFromPrivateKey({
        password,
        privateKey,
        ...keyringParams,
      } as UiImportWalletFromPrivateKeyParams);
      const namespace = params.namespace ?? deps.chains.getSelectedChainView().namespace;
      const chainRef = resolveChainRefForNamespace(deps, namespace);
      await deps.accounts.setActiveAccount({
        namespace,
        chainRef,
        accountKey: deps.accountCodecs.toAccountKeyFromAddress({ chainRef, address: account.address }),
      });
      return { keyringId, account };
    },
  };
};
