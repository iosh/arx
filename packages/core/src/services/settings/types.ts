import type { AccountId, SettingsRecord } from "../../storage/records.js";

export type SettingsChangedHandler = () => void;

export type UpdateSettingsParams = {
  /**
   * Patch per-namespace selected account ids.
   * - value: AccountId => set selection for namespace
   * - value: null => clear selection for namespace
   */
  selectedAccountIdsByNamespace?: Record<string, AccountId | null>;
};

export type SettingsService = {
  on(event: "changed", handler: SettingsChangedHandler): void;
  off(event: "changed", handler: SettingsChangedHandler): void;

  get(): Promise<SettingsRecord | null>;
  upsert(params: UpdateSettingsParams): Promise<SettingsRecord>;
};
