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
      getBootstrap: call("ui.entry.getBootstrap"),
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
    balances: {
      getNative: call("ui.balances.getNative"),
    },

    session: {
      getStatus: call("ui.session.getStatus"),
      unlock: call("ui.session.unlock"),
      lock: call("ui.session.lock"),
      resetAutoLockTimer: call("ui.session.resetAutoLockTimer"),
      setAutoLockDuration: call("ui.session.setAutoLockDuration"),
    },

    onboarding: {
      getStatus: call("ui.onboarding.getStatus"),
      generateMnemonic: call("ui.onboarding.generateMnemonic"),
      createWalletFromMnemonic: call("ui.onboarding.createWalletFromMnemonic"),
      importWalletFromMnemonic: call("ui.onboarding.importWalletFromMnemonic"),
      importWalletFromPrivateKey: call("ui.onboarding.importWalletFromPrivateKey"),
    },

    accounts: {
      listCurrentChain: call("ui.accounts.listCurrentChain"),
      switchActive: call("ui.accounts.switchActive"),
    },

    networks: {
      getSelectedChain: call("ui.networks.getSelectedChain"),
      list: call("ui.networks.list"),
      switchActive: call("ui.networks.switchActive"),
    },

    approvals: {
      listPending: call("ui.approvals.listPending"),
      getDetail: call("ui.approvals.getDetail"),
      resolve: call("ui.approvals.resolve"),
    },

    transactions: {
      listHistory: call("ui.transactions.listHistory"),
      getDetail: call("ui.transactions.getDetail"),
      requestSendTransactionApproval: call("ui.transactions.requestSendTransactionApproval"),
      rerunPrepare: call("ui.transactions.rerunPrepare"),
      applyDraftEdit: call("ui.transactions.applyDraftEdit"),
    },

    keyrings: {
      confirmNewMnemonic: call("ui.keyrings.confirmNewMnemonic"),
      importMnemonic: call("ui.keyrings.importMnemonic"),
      importPrivateKey: call("ui.keyrings.importPrivateKey"),
      deriveAccount: call("ui.keyrings.deriveAccount"),
      list: call("ui.keyrings.list"),
      getAccountsByKeyring: call("ui.keyrings.getAccountsByKeyring"),
      getBackupStatus: call("ui.keyrings.getBackupStatus"),
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
