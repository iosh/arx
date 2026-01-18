import type { UiClient } from "./client/index.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "./protocol.js";

type UiActionArgs<M extends UiMethodName> =
  undefined extends UiMethodParams<M> ? [params?: UiMethodParams<M>] : [params: UiMethodParams<M>];

type UiActionsByMethod = {
  [M in UiMethodName]: (...args: UiActionArgs<M>) => Promise<UiMethodResult<M>>;
};
export const uiActionsByMethod = (client: UiClient): UiActionsByMethod => ({
  // --- snapshot ---
  "ui.snapshot.get": () => client.call("ui.snapshot.get"),

  // --- vault ---
  "ui.vault.init": (params) => client.call("ui.vault.init", params),
  "ui.vault.initAndUnlock": (params) => client.call("ui.vault.initAndUnlock", params),

  // --- session ---
  "ui.session.unlock": (params) => client.call("ui.session.unlock", params),
  "ui.session.lock": (params) => client.call("ui.session.lock", params),
  "ui.session.resetAutoLockTimer": () => client.call("ui.session.resetAutoLockTimer"),
  "ui.session.setAutoLockDuration": (params) => client.call("ui.session.setAutoLockDuration", params),

  // --- onboarding ---
  "ui.onboarding.openTab": (params) => client.call("ui.onboarding.openTab", params),

  // --- accounts ---
  "ui.accounts.switchActive": (params) =>
    client.call("ui.accounts.switchActive", { ...params, address: params.address ?? null }),

  // --- networks ---
  "ui.networks.switchActive": (params) => client.call("ui.networks.switchActive", params),

  // --- approvals ---
  "ui.approvals.approve": (params) => client.call("ui.approvals.approve", params),
  "ui.approvals.reject": (params) => client.call("ui.approvals.reject", params),

  // --- keyrings ---
  "ui.keyrings.generateMnemonic": (params) => client.call("ui.keyrings.generateMnemonic", params),
  "ui.keyrings.confirmNewMnemonic": (params) => client.call("ui.keyrings.confirmNewMnemonic", params),
  "ui.keyrings.importMnemonic": (params) => client.call("ui.keyrings.importMnemonic", params),
  "ui.keyrings.importPrivateKey": (params) => client.call("ui.keyrings.importPrivateKey", params),
  "ui.keyrings.deriveAccount": (params) => client.call("ui.keyrings.deriveAccount", params),
  "ui.keyrings.list": () => client.call("ui.keyrings.list"),
  "ui.keyrings.getAccountsByKeyring": (params) => client.call("ui.keyrings.getAccountsByKeyring", params),
  "ui.keyrings.renameKeyring": (params) => client.call("ui.keyrings.renameKeyring", params),
  "ui.keyrings.renameAccount": (params) => client.call("ui.keyrings.renameAccount", params),
  "ui.keyrings.markBackedUp": (params) => client.call("ui.keyrings.markBackedUp", params),
  "ui.keyrings.hideHdAccount": (params) => client.call("ui.keyrings.hideHdAccount", params),
  "ui.keyrings.unhideHdAccount": (params) => client.call("ui.keyrings.unhideHdAccount", params),
  "ui.keyrings.removePrivateKeyKeyring": (params) => client.call("ui.keyrings.removePrivateKeyKeyring", params),
  "ui.keyrings.exportMnemonic": (params) => client.call("ui.keyrings.exportMnemonic", params),
  "ui.keyrings.exportPrivateKey": (params) => client.call("ui.keyrings.exportPrivateKey", params),
});

export const uiActions = (client: UiClient) => {
  const byMethod = uiActionsByMethod(client);
  return {
    snapshot: {
      get: byMethod["ui.snapshot.get"],
    },

    vault: {
      init: (password: string) => byMethod["ui.vault.init"]({ password }),
      initAndUnlock: (password: string) => byMethod["ui.vault.initAndUnlock"]({ password }),
    },

    session: {
      unlock: (password: string) => byMethod["ui.session.unlock"]({ password }),
      lock: byMethod["ui.session.lock"],
      resetAutoLockTimer: byMethod["ui.session.resetAutoLockTimer"],
      setAutoLockDuration: (durationMs: number) => byMethod["ui.session.setAutoLockDuration"]({ durationMs }),
    },

    onboarding: {
      openTab: (reason: string) => byMethod["ui.onboarding.openTab"]({ reason }),
    },
    accounts: {
      switchActiveAccount: (chainRef: string, address?: string | null) =>
        byMethod["ui.accounts.switchActive"]({ chainRef, address }),
    },

    networks: {
      switchActive: (chainRef: string) => byMethod["ui.networks.switchActive"]({ chainRef }),
    },
    approvals: {
      approve: (id: string) => byMethod["ui.approvals.approve"]({ id }),
      reject: (id: string, reason?: string) => byMethod["ui.approvals.reject"]({ id, reason }),
    },
    keyrings: {
      generateMnemonic: (wordCount?: 12 | 24) =>
        byMethod["ui.keyrings.generateMnemonic"](wordCount ? { wordCount } : undefined),

      confirmNewMnemonic: byMethod["ui.keyrings.confirmNewMnemonic"],
      importMnemonic: byMethod["ui.keyrings.importMnemonic"],
      importPrivateKey: byMethod["ui.keyrings.importPrivateKey"],

      deriveAccount: (keyringId: string) => byMethod["ui.keyrings.deriveAccount"]({ keyringId }),

      list: byMethod["ui.keyrings.list"],

      getAccountsByKeyring: byMethod["ui.keyrings.getAccountsByKeyring"],
      renameKeyring: byMethod["ui.keyrings.renameKeyring"],
      renameAccount: byMethod["ui.keyrings.renameAccount"],

      markBackedUp: (keyringId: string) => byMethod["ui.keyrings.markBackedUp"]({ keyringId }),

      hideHdAccount: (address: string) => byMethod["ui.keyrings.hideHdAccount"]({ address }),
      unhideHdAccount: (address: string) => byMethod["ui.keyrings.unhideHdAccount"]({ address }),

      removePrivateKeyKeyring: (keyringId: string) => byMethod["ui.keyrings.removePrivateKeyKeyring"]({ keyringId }),

      exportMnemonic: byMethod["ui.keyrings.exportMnemonic"],
      exportPrivateKey: byMethod["ui.keyrings.exportPrivateKey"],
    },
  };
};

export type UiActions = ReturnType<typeof uiActions>;
