import type { ChainRef } from "../../chains/ids.js";
import type { ChainRecord } from "../../db/records.js";

export type ChainsChangedHandler = () => void;

export type ChainsService = {
  on(event: "changed", handler: ChainsChangedHandler): void;
  off(event: "changed", handler: ChainsChangedHandler): void;

  get(chainRef: ChainRef): Promise<ChainRecord | null>;
  list(): Promise<ChainRecord[]>;
  upsert(record: ChainRecord): Promise<void>;
  upsertMany(records: ChainRecord[]): Promise<void>;
  remove(chainRef: ChainRef): Promise<void>;
};
