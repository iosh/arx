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
  const selectAccount = async (params: { namespace?: string; accountId: string }) => {
    const namespace = params.namespace ?? deps.chains.getSelectedChainView().namespace;
    const chainRef = resolveChainRefForNamespace(deps, namespace);
    await deps.accounts.setActiveAccount({ namespace, chainRef, accountId: params.accountId });
  };

  return {
    "ui.keyrings.confirmNewMnemonic": async (params) => {
      assertUnlocked(deps.session);
      const opts: { alias?: string; skipBackup?: boolean; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.skipBackup !== undefined) opts.skipBackup = params.skipBackup;
      if (params.namespace !== undefined) opts.namespace = params.namespace;
      const result = await deps.keyrings.confirmNewMnemonic(params.words.join(" "), opts);
      await selectAccount({
        accountId: deps.accountCodecs.toAccountIdFromAddress({
          chainRef: resolveChainRefForNamespace(deps, opts.namespace ?? deps.chains.getSelectedChainView().namespace),
          address: result.address,
        }),
        ...(opts.namespace ? { namespace: opts.namespace } : {}),
      });
      return result;
    },

    "ui.keyrings.importMnemonic": async (params) => {
      assertUnlocked(deps.session);
      const opts: { alias?: string; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.namespace !== undefined) opts.namespace = params.namespace;
      const result = await deps.keyrings.importMnemonic(params.words.join(" "), opts);
      await selectAccount({
        accountId: deps.accountCodecs.toAccountIdFromAddress({
          chainRef: resolveChainRefForNamespace(deps, opts.namespace ?? deps.chains.getSelectedChainView().namespace),
          address: result.address,
        }),
        ...(opts.namespace ? { namespace: opts.namespace } : {}),
      });
      return result;
    },

    "ui.keyrings.importPrivateKey": async (params) => {
      assertUnlocked(deps.session);
      const opts: { alias?: string; namespace?: string } = {};
      if (params.alias !== undefined) opts.alias = params.alias;
      if (params.namespace !== undefined) opts.namespace = params.namespace;
      const result = await deps.keyrings.importPrivateKey(params.privateKey, opts);
      await selectAccount({
        accountId: deps.accountCodecs.toAccountIdFromAddress({
          chainRef: resolveChainRefForNamespace(deps, opts.namespace ?? deps.chains.getSelectedChainView().namespace),
          address: result.account.address,
        }),
        ...(opts.namespace ? { namespace: opts.namespace } : {}),
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
      await deps.keyrings.renameAccount(params.accountId, params.alias);
      return null;
    },

    "ui.keyrings.markBackedUp": async (params) => {
      assertUnlocked(deps.session);
      await deps.keyrings.markBackedUp(params.keyringId);
      return null;
    },

    "ui.keyrings.hideHdAccount": async (params) => {
      assertUnlocked(deps.session);
      await deps.keyrings.hideHdAccount(params.accountId);
      return null;
    },

    "ui.keyrings.unhideHdAccount": async (params) => {
      assertUnlocked(deps.session);
      await deps.keyrings.unhideHdAccount(params.accountId);
      return null;
    },

    "ui.keyrings.removePrivateKeyKeyring": async (params) => {
      assertUnlocked(deps.session);
      await deps.keyrings.removePrivateKeyKeyring(params.keyringId);
      return null;
    },

    "ui.keyrings.exportMnemonic": async (params) => {
      assertUnlocked(deps.session);
      return { words: (await deps.keyrings.exportMnemonic(params.keyringId, params.password)).split(" ") };
    },

    "ui.keyrings.exportPrivateKey": async (params) => {
      assertUnlocked(deps.session);
      const secret = await deps.keyrings.exportPrivateKeyByAccountId(params.accountId, params.password);
      const privateKey = withSensitiveBytes(secret, (bytes) => toPlainHex(bytes));
      return { privateKey };
    },
  };
};
