import type {
  UiConfirmNewMnemonicParams,
  UiImportMnemonicParams,
  UiImportPrivateKeyParams,
} from "../keyringsAccess.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";
import {
  assertUnlocked,
  resolveChainRefForNamespace,
  toPlainHex,
  toUiAccountMeta,
  toUiKeyringMeta,
  withSensitiveBytes,
} from "./lib.js";

export const createKeyringsHandlers = (
  deps: Pick<UiRuntimeDeps, "accounts" | "chains" | "accountCodecs" | "session" | "keyrings">,
): Pick<
  UiHandlers,
  | "ui.keyrings.confirmNewMnemonic"
  | "ui.keyrings.importMnemonic"
  | "ui.keyrings.importPrivateKey"
  | "ui.keyrings.deriveAccount"
  | "ui.keyrings.list"
  | "ui.keyrings.getAccountsByKeyring"
  | "ui.keyrings.renameKeyring"
  | "ui.keyrings.renameAccount"
  | "ui.keyrings.markBackedUp"
  | "ui.keyrings.hideHdAccount"
  | "ui.keyrings.unhideHdAccount"
  | "ui.keyrings.removePrivateKeyKeyring"
  | "ui.keyrings.exportMnemonic"
  | "ui.keyrings.exportPrivateKey"
> => {
  const selectAccount = async (params: { namespace: string | undefined; accountKey: string }) => {
    const namespace = params.namespace ?? deps.chains.getSelectedChainView().namespace;
    const chainRef = resolveChainRefForNamespace(deps, namespace);
    await deps.accounts.setActiveAccount({ namespace, chainRef, accountKey: params.accountKey });
  };

  return {
    "ui.keyrings.confirmNewMnemonic": async (params) => {
      assertUnlocked(deps.session);
      const { words, ...keyringParams } = params;
      const result = await deps.keyrings.confirmNewMnemonic({
        mnemonic: words.join(" "),
        ...keyringParams,
      } as UiConfirmNewMnemonicParams);
      const namespace = params.namespace ?? deps.chains.getSelectedChainView().namespace;
      await selectAccount({
        accountKey: deps.accountCodecs.toAccountKeyFromAddress({
          chainRef: resolveChainRefForNamespace(deps, namespace),
          address: result.address,
        }),
        namespace: params.namespace,
      });
      return result;
    },

    "ui.keyrings.importMnemonic": async (params) => {
      assertUnlocked(deps.session);
      const { words, ...keyringParams } = params;
      const result = await deps.keyrings.importMnemonic({
        mnemonic: words.join(" "),
        ...keyringParams,
      } as UiImportMnemonicParams);
      const namespace = params.namespace ?? deps.chains.getSelectedChainView().namespace;
      await selectAccount({
        accountKey: deps.accountCodecs.toAccountKeyFromAddress({
          chainRef: resolveChainRefForNamespace(deps, namespace),
          address: result.address,
        }),
        namespace: params.namespace,
      });
      return result;
    },

    "ui.keyrings.importPrivateKey": async (params) => {
      assertUnlocked(deps.session);
      const result = await deps.keyrings.importPrivateKey(params as UiImportPrivateKeyParams);
      const namespace = params.namespace ?? deps.chains.getSelectedChainView().namespace;
      await selectAccount({
        accountKey: deps.accountCodecs.toAccountKeyFromAddress({
          chainRef: resolveChainRefForNamespace(deps, namespace),
          address: result.account.address,
        }),
        namespace: params.namespace,
      });
      return result;
    },

    "ui.keyrings.deriveAccount": async (params) => {
      assertUnlocked(deps.session);
      return await deps.keyrings.deriveAccount(params.keyringId);
    },

    "ui.keyrings.list": async () => {
      assertUnlocked(deps.session);
      const metas = deps.keyrings.getKeyrings();
      return metas.map(toUiKeyringMeta);
    },

    "ui.keyrings.getAccountsByKeyring": async (params) => {
      assertUnlocked(deps.session);
      const records = deps.keyrings.getAccountsByKeyring(params.keyringId, params.includeHidden ?? false);
      return records.map((record) => toUiAccountMeta(deps, record));
    },

    "ui.keyrings.renameKeyring": async (params) => {
      assertUnlocked(deps.session);
      await deps.keyrings.renameKeyring(params.keyringId, params.alias);
      return null;
    },

    "ui.keyrings.renameAccount": async (params) => {
      assertUnlocked(deps.session);
      await deps.keyrings.renameAccount(params.accountKey, params.alias);
      return null;
    },

    "ui.keyrings.markBackedUp": async (params) => {
      assertUnlocked(deps.session);
      await deps.keyrings.markBackedUp(params.keyringId);
      return null;
    },

    "ui.keyrings.hideHdAccount": async (params) => {
      assertUnlocked(deps.session);
      await deps.keyrings.hideHdAccount(params.accountKey);
      return null;
    },

    "ui.keyrings.unhideHdAccount": async (params) => {
      assertUnlocked(deps.session);
      await deps.keyrings.unhideHdAccount(params.accountKey);
      return null;
    },

    "ui.keyrings.removePrivateKeyKeyring": async (params) => {
      assertUnlocked(deps.session);
      await deps.keyrings.removePrivateKeyKeyring(params.keyringId);
      return null;
    },

    "ui.keyrings.exportMnemonic": async (params) => {
      return { words: (await deps.keyrings.exportMnemonic(params.keyringId, params.password)).split(" ") };
    },

    "ui.keyrings.exportPrivateKey": async (params) => {
      const secret = await deps.keyrings.exportPrivateKeyByAccountKey(params.accountKey, params.password);
      const privateKey = withSensitiveBytes(secret, (bytes) => toPlainHex(bytes));
      return { privateKey };
    },
  };
};
