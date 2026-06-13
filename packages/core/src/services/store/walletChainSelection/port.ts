import type { WalletChainSelectionRecord } from "../../../storage/records.js";

export interface WalletChainSelectionPort {
  get(): Promise<WalletChainSelectionRecord | null>;
  put(record: WalletChainSelectionRecord): Promise<void>;
}
