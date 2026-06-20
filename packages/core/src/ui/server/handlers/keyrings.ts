import type { CoreReadApi } from "../../../read/types.js";
import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiHandlers } from "../types.js";

const buildAccountsByKeyringInput = (input: { keyringId: string; includeHidden?: boolean | undefined }) => ({
  keyringId: input.keyringId,
  ...(input.includeHidden !== undefined ? { includeHidden: input.includeHidden } : {}),
});

export const createKeyringsHandlers = (deps: {
  wallet: TrustedWalletApi;
  read: CoreReadApi;
}): Pick<
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
  return {
    "ui.keyrings.confirmNewMnemonic": async (input) => await deps.wallet.confirmNewMnemonic(input),
    "ui.keyrings.importMnemonic": async (input) => await deps.wallet.importMnemonic(input),
    "ui.keyrings.importPrivateKey": async (input) => await deps.wallet.importPrivateKey(input),
    "ui.keyrings.deriveAccount": async (input) => await deps.wallet.deriveAccount(input),
    "ui.keyrings.list": async () => await deps.read.listKeyrings(),
    "ui.keyrings.getAccountsByKeyring": async (input) =>
      await deps.read.getAccountsByKeyring(buildAccountsByKeyringInput(input)),
    "ui.keyrings.renameKeyring": async (input) => await deps.wallet.renameKeyring(input),
    "ui.keyrings.renameAccount": async (input) => await deps.wallet.renameAccount(input),
    "ui.keyrings.markBackedUp": async (input) => await deps.wallet.markBackedUp(input),
    "ui.keyrings.hideHdAccount": async (input) => await deps.wallet.hideHdAccount(input),
    "ui.keyrings.unhideHdAccount": async (input) => await deps.wallet.unhideHdAccount(input),
    "ui.keyrings.removePrivateKeyKeyring": async (input) => await deps.wallet.removePrivateKeyKeyring(input),
    "ui.keyrings.exportMnemonic": async (input) => await deps.wallet.exportMnemonic(input),
    "ui.keyrings.exportPrivateKey": async (input) => await deps.wallet.exportPrivateKey(input),
  };
};
