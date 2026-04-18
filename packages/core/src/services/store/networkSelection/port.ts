import type { NetworkSelectionRecord } from "../../../storage/records.js";

export interface NetworkSelectionPort {
  get(): Promise<NetworkSelectionRecord | null>;
  put(record: NetworkSelectionRecord): Promise<void>;
}
