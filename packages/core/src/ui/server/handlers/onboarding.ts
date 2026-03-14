import { ArxReasons, arxError } from "@arx/errors";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";
import {
  hasAnyAccounts,
  parsePrivateKeyHex,
  requireOnboardingPassword,
  resolveChainRefForNamespace,
  sanitizeMnemonicPhraseFromWords,
  validateBip39Mnemonic,
} from "./lib.js";

export const createOnboardingHandlers = (
  deps: Pick<UiRuntimeDeps, "controllers" | "chainViews" | "accountCodecs" | "session" | "keyring" | "platform">,
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
      const mnemonic = deps.keyring.generateMnemonic(payload?.wordCount ?? 12);
      return { words: mnemonic.split(" ") };
    },

    "ui.onboarding.createWalletFromMnemonic": async (params) => {
      const mnemonic = sanitizeMnemonicPhraseFromWords(params.words);
      validateBip39Mnemonic(mnemonic);

      const opts: { alias?: string; skipBackup?: boolean; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.skipBackup !== undefined) opts.skipBackup = params.skipBackup;
      if (params.namespace !== undefined) opts.namespace = params.namespace;

      return await deps.session.withVaultMetaPersistHold(async () => {
        const status = deps.session.vault.getStatus();
        if (status.hasEnvelope && hasAnyAccounts(deps.controllers)) {
          throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Vault already initialized" });
        }

        if (!status.hasEnvelope) {
          const password = requireOnboardingPassword(params.password);
          await deps.session.vault.initialize({ password });
          await deps.session.unlock.unlock({ password });
        } else if (!deps.session.unlock.isUnlocked()) {
          const password = requireOnboardingPassword(params.password);
          await deps.session.unlock.unlock({ password });
        }

        await deps.keyring.waitForReady();

        const { keyringId, address } = await deps.keyring.importMnemonic(mnemonic, opts);
        const namespace = opts.namespace ?? deps.chainViews.getSelectedChainView().namespace;
        const chainRef = resolveChainRefForNamespace(deps, namespace);
        await deps.controllers.accounts.setActiveAccount({
          namespace,
          chainRef,
          accountId: deps.accountCodecs.toAccountIdFromAddress({ chainRef, address }),
        });
        return { keyringId, address };
      });
    },

    "ui.onboarding.importWalletFromMnemonic": async (params) => {
      const mnemonic = sanitizeMnemonicPhraseFromWords(params.words);
      validateBip39Mnemonic(mnemonic);

      const opts: { alias?: string; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.namespace !== undefined) opts.namespace = params.namespace;

      return await deps.session.withVaultMetaPersistHold(async () => {
        const status = deps.session.vault.getStatus();
        if (status.hasEnvelope && hasAnyAccounts(deps.controllers)) {
          throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Vault already initialized" });
        }

        if (!status.hasEnvelope) {
          const password = requireOnboardingPassword(params.password);
          await deps.session.vault.initialize({ password });
          await deps.session.unlock.unlock({ password });
        } else if (!deps.session.unlock.isUnlocked()) {
          const password = requireOnboardingPassword(params.password);
          await deps.session.unlock.unlock({ password });
        }

        await deps.keyring.waitForReady();

        const { keyringId, address } = await deps.keyring.importMnemonic(mnemonic, opts);
        const namespace = opts.namespace ?? deps.chainViews.getSelectedChainView().namespace;
        const chainRef = resolveChainRefForNamespace(deps, namespace);
        await deps.controllers.accounts.setActiveAccount({
          namespace,
          chainRef,
          accountId: deps.accountCodecs.toAccountIdFromAddress({ chainRef, address }),
        });
        return { keyringId, address };
      });
    },

    "ui.onboarding.importWalletFromPrivateKey": async (params) => {
      const privateKey = parsePrivateKeyHex(params.privateKey);

      const opts: { alias?: string; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.namespace !== undefined) opts.namespace = params.namespace;

      return await deps.session.withVaultMetaPersistHold(async () => {
        const status = deps.session.vault.getStatus();
        if (status.hasEnvelope && hasAnyAccounts(deps.controllers)) {
          throw arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Vault already initialized" });
        }

        if (!status.hasEnvelope) {
          const password = requireOnboardingPassword(params.password);
          await deps.session.vault.initialize({ password });
          await deps.session.unlock.unlock({ password });
        } else if (!deps.session.unlock.isUnlocked()) {
          const password = requireOnboardingPassword(params.password);
          await deps.session.unlock.unlock({ password });
        }

        await deps.keyring.waitForReady();

        const { keyringId, account } = await deps.keyring.importPrivateKey(privateKey, opts);
        const namespace = opts.namespace ?? deps.chainViews.getSelectedChainView().namespace;
        const chainRef = resolveChainRefForNamespace(deps, namespace);
        await deps.controllers.accounts.setActiveAccount({
          namespace,
          chainRef,
          accountId: deps.accountCodecs.toAccountIdFromAddress({ chainRef, address: account.address }),
        });
        return { keyringId, account };
      });
    },
  };
};
