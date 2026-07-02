import { eventTopic } from "../../../messenger/index.js";
import type { WalletChainSelectionChangedPayload } from "./types.js";

export const WALLET_CHAIN_SELECTION_STORE_CHANGED = eventTopic<WalletChainSelectionChangedPayload>(
  "store:walletChainSelection:changed",
);
