import type { Unsubscribe } from "../../../messenger/index.js";
import type { AccountId, SettingsRecord } from "../../../storage/records.js";

export type SettingsChangedPayload = { next: SettingsRecord };

export type UpdateSettingsParams = {
  /**
   * Patch per-namespace selected account keys.
   * - value: AccountId => set selection for namespace
   * - value: null => clear selection for namespace
   */
  selectedAccountIdsByNamespace?: Record<string, AccountId | null>;
};

export type SettingsService = {
  subscribeChanged(handler: (payload: SettingsChangedPayload) => void): Unsubscribe;

  get(): Promise<SettingsRecord | null>;
  update(params: UpdateSettingsParams): Promise<SettingsRecord>;
};
