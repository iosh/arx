import type { NetworkPreferencesRecord } from "../../db/records.js";

export interface NetworkPreferencesPort {
  get(): Promise<NetworkPreferencesRecord | null>;
  put(record: NetworkPreferencesRecord): Promise<void>;
}
