import type { AccountKey, SettingsRecord } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type SettingsChangedPayload = { next: SettingsRecord };

export type UpdateSettingsParams = {
  /**
   * Patch per-namespace selected account keys.
   * - value: AccountKey => set selection for namespace
   * - value: null => clear selection for namespace
   */
  selectedAccountKeysByNamespace?: Record<string, AccountKey | null>;
};

export type SettingsService = {
  subscribeChanged(handler: (payload: SettingsChangedPayload) => void): Unsubscribe;

  get(): Promise<SettingsRecord | null>;
  update(params: UpdateSettingsParams): Promise<SettingsRecord>;
};
