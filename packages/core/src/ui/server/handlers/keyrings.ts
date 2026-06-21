import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiHandlers } from "../types.js";

const buildAccountsByKeyringInput = (input: { keyringId: string; includeHidden?: boolean | undefined }) => ({
  keyringId: input.keyringId,
  ...(input.includeHidden !== undefined ? { includeHidden: input.includeHidden } : {}),
});

export const createKeyringsHandlers = (deps: {
  wallet: TrustedWalletApi;
}): Pick<
  UiHandlers,
  | "ui.keyrings.confirmNewMnemonic"
  | "ui.keyrings.importMnemonic"
  | "ui.keyrings.importPrivateKey"
  | "ui.keyrings.deriveAccount"
  | "ui.keyrings.list"
  | "ui.keyrings.getAccountsByKeyring"
  | "ui.keyrings.getBackupStatus"
  | "ui.keyrings.renameKeyring"
  | "ui.keyrings.renameAccount"
  | "ui.keyrings.markBackedUp"
  | "ui.keyrings.hideHdAccount"
  | "ui.keyrings.unhideHdAccount"
  | "ui.keyrings.removePrivateKeyKeyring"
  | "ui.keyrings.exportMnemonic"
  | "ui.keyrings.exportPrivateKey"
> => {
  return {
    "ui.keyrings.confirmNewMnemonic": async (input) => await deps.wallet.keyrings.confirmNewMnemonic(input),
    "ui.keyrings.importMnemonic": async (input) => await deps.wallet.keyrings.importMnemonic(input),
    "ui.keyrings.importPrivateKey": async (input) => await deps.wallet.keyrings.importPrivateKey(input),
    "ui.keyrings.deriveAccount": async (input) => await deps.wallet.keyrings.deriveAccount(input),
    "ui.keyrings.list": async () => await deps.wallet.keyrings.list(),
    "ui.keyrings.getAccountsByKeyring": async (input) =>
      await deps.wallet.keyrings.getAccountsByKeyring(buildAccountsByKeyringInput(input)),
    "ui.keyrings.getBackupStatus": async () => deps.wallet.keyrings.getBackupStatus(),
    "ui.keyrings.renameKeyring": async (input) => await deps.wallet.keyrings.renameKeyring(input),
    "ui.keyrings.renameAccount": async (input) => await deps.wallet.keyrings.renameAccount(input),
    "ui.keyrings.markBackedUp": async (input) => await deps.wallet.keyrings.markBackedUp(input),
    "ui.keyrings.hideHdAccount": async (input) => await deps.wallet.keyrings.hideHdAccount(input),
    "ui.keyrings.unhideHdAccount": async (input) => await deps.wallet.keyrings.unhideHdAccount(input),
    "ui.keyrings.removePrivateKeyKeyring": async (input) => await deps.wallet.keyrings.removePrivateKeyKeyring(input),
    "ui.keyrings.exportMnemonic": async (input) => await deps.wallet.keyrings.exportMnemonic(input),
    "ui.keyrings.exportPrivateKey": async (input) => await deps.wallet.keyrings.exportPrivateKey(input),
  };
};
