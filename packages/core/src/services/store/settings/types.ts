import type { AccountId, SettingsRecord } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type SettingsChangedPayload = { next: SettingsRecord };

export type UpdateSettingsParams = {
  /**
   * Patch per-namespace selected account ids.
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
