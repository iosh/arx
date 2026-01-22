import type { ChainRegistryEntity } from "../storage/index.js";
import type { ChainRef } from "./ids.js";

export interface ChainRegistryPort {
  get(chainRef: ChainRef): Promise<ChainRegistryEntity | null>;
  getAll(): Promise<ChainRegistryEntity[]>;
  put(entity: ChainRegistryEntity): Promise<void>;
  putMany(entities: ChainRegistryEntity[]): Promise<void>;
  delete(chainRef: ChainRef): Promise<void>;
  clear(): Promise<void>;
}
