import type { UiClient } from "./client/index.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "./protocol.js";

type UiActionArgs<M extends UiMethodName> =
  undefined extends UiMethodParams<M> ? [params?: UiMethodParams<M>] : [params: UiMethodParams<M>];

export const uiActions = (client: UiClient) => {
  // Typed helper keeps inference strong without maintaining a full method→call mapping.
  const call =
    <M extends UiMethodName>(method: M) =>
    (...args: UiActionArgs<M>): Promise<UiMethodResult<M>> => {
      const [params] = args;
      return params === undefined ? client.call(method) : client.call(method, params);
    };

  return {
    snapshot: {
      get: call("ui.snapshot.get"),
    },

    vault: {
      init: call("ui.vault.init"),
      initAndUnlock: call("ui.vault.initAndUnlock"),
    },

    session: {
      unlock: call("ui.session.unlock"),
      lock: call("ui.session.lock"),
      resetAutoLockTimer: call("ui.session.resetAutoLockTimer"),
      setAutoLockDuration: call("ui.session.setAutoLockDuration"),
    },

    onboarding: {
      openTab: call("ui.onboarding.openTab"),
    },
    accounts: {
      switchActive: call("ui.accounts.switchActive"),
    },

    networks: {
      switchActive: call("ui.networks.switchActive"),
    },
    approvals: {
      approve: call("ui.approvals.approve"),
      reject: call("ui.approvals.reject"),
    },
    keyrings: {
      generateMnemonic: call("ui.keyrings.generateMnemonic"),

      confirmNewMnemonic: call("ui.keyrings.confirmNewMnemonic"),
      importMnemonic: call("ui.keyrings.importMnemonic"),
      importPrivateKey: call("ui.keyrings.importPrivateKey"),

      deriveAccount: call("ui.keyrings.deriveAccount"),

      list: call("ui.keyrings.list"),

      getAccountsByKeyring: call("ui.keyrings.getAccountsByKeyring"),
      renameKeyring: call("ui.keyrings.renameKeyring"),
      renameAccount: call("ui.keyrings.renameAccount"),

      markBackedUp: call("ui.keyrings.markBackedUp"),

      hideHdAccount: call("ui.keyrings.hideHdAccount"),
      unhideHdAccount: call("ui.keyrings.unhideHdAccount"),

      removePrivateKeyKeyring: call("ui.keyrings.removePrivateKeyKeyring"),

      exportMnemonic: call("ui.keyrings.exportMnemonic"),
      exportPrivateKey: call("ui.keyrings.exportPrivateKey"),
    },
  };
};
