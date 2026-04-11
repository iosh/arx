import type { UiClient } from "./client/index.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "./protocol/index.js";

type UiActionArgs<M extends UiMethodName> =
  undefined extends UiMethodParams<M> ? [params?: UiMethodParams<M>] : [params: UiMethodParams<M>];

export const uiActions = (client: UiClient) => {
  const call =
    <M extends UiMethodName>(method: M) =>
    (...args: UiActionArgs<M>): Promise<UiMethodResult<M>> => {
      const [params] = args;
      return params === undefined ? client.call(method) : client.call(method, params);
    };

  const common = uiCommonActions(client);

  return {
    ...common,

    entry: {
      getLaunchContext: call("ui.entry.getLaunchContext"),
    },

    onboarding: {
      ...common.onboarding,
      openTab: call("ui.onboarding.openTab"),
    },

    approvals: {
      ...common.approvals,
    },
  };
};

export const uiCommonActions = (client: UiClient) => {
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

    balances: {
      getNative: call("ui.balances.getNative"),
    },

    session: {
      unlock: call("ui.session.unlock"),
      lock: call("ui.session.lock"),
      resetAutoLockTimer: call("ui.session.resetAutoLockTimer"),
      setAutoLockDuration: call("ui.session.setAutoLockDuration"),
    },

    onboarding: {
      generateMnemonic: call("ui.onboarding.generateMnemonic"),
      createWalletFromMnemonic: call("ui.onboarding.createWalletFromMnemonic"),
      importWalletFromMnemonic: call("ui.onboarding.importWalletFromMnemonic"),
      importWalletFromPrivateKey: call("ui.onboarding.importWalletFromPrivateKey"),
    },

    accounts: {
      switchActive: call("ui.accounts.switchActive"),
    },

    networks: {
      switchActive: call("ui.networks.switchActive"),
    },

    approvals: {
      resolve: call("ui.approvals.resolve"),
    },

    transactions: {
      requestSendTransactionApproval: call("ui.transactions.requestSendTransactionApproval"),
    },

    keyrings: {
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
