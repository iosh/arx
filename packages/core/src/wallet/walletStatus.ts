import type { SoftwareKeyStatus } from "../keyring/Keyring.js";
import type { WalletStatus } from "./Wallet.js";

export const getWalletStatus = (status: SoftwareKeyStatus, expired: boolean): WalletStatus =>
  status === "unlocked" && expired ? "locked" : status;
