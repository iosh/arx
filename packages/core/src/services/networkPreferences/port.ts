import type { NetworkPreferencesRecord } from "../../storage/records.js";

export interface NetworkPreferencesPort {
  get(): Promise<NetworkPreferencesRecord | null>;
  put(record: NetworkPreferencesRecord): Promise<void>;
}
