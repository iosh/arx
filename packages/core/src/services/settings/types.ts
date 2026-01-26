import type { ChainRef } from "../../chains/ids.js";
import type { AccountId, SettingsRecord } from "../../db/records.js";

export type SettingsChangedHandler = () => void;

export type UpdateSettingsParams = {
  activeChainRef?: ChainRef;
  selectedAccountId?: AccountId;
};

export type SettingsService = {
  on(event: "changed", handler: SettingsChangedHandler): void;
  off(event: "changed", handler: SettingsChangedHandler): void;

  get(): Promise<SettingsRecord | null>;
  upsert(params: UpdateSettingsParams): Promise<SettingsRecord>;
};
