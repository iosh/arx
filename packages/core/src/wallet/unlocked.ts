import type { KeyringSecrets } from "../keyring/secrets.js";
import { WalletLockedError } from "./errors.js";
import type { WalletContext } from "./Wallet.js";

export const requireKeyringSecrets = (wallet: Pick<WalletContext, "keyring">): KeyringSecrets => {
  const secrets = wallet.keyring.getSecrets();
  if (!secrets) throw new WalletLockedError();
  return secrets;
};
